import { describe, expect, it } from "vitest";

import { appFetch, signedIn, type SignedIn } from "./support/auth";

// Usuarios through the whole Worker, on the real clock. The tests share one
// D1, so names are unique per test. The last-Admin rule is in
// last-admin.test.ts, which starts each test from an empty database.

function post(phone: SignedIn, fields: Record<string, string>) {
  return phone.fetch("/usuarios", { method: "POST", body: new URLSearchParams(fields) });
}

/** The code on a page that shows one, as the User would type it. */
function codeShownOn(html: string): string {
  const code = /<output[^>]*>([A-Z2-9]{4} [A-Z2-9]{4})<\/output>/.exec(html)?.[1];
  if (!code) throw new Error("the page shows no sign-in code");
  return code;
}

/** Enters a code on Entrar and gives the `Cookie` of the phone it signed in. */
async function signInWith(code: string): Promise<string | undefined> {
  const response = await appFetch("/entrar", { method: "POST", body: new URLSearchParams({ code }) });
  return response.headers.get("Set-Cookie")?.split(";")[0];
}

describe("Usuarios, for an Admin", () => {
  it("lists every User with their role, in Spanish", async () => {
    const ana = await signedIn("admin", "Ana Lista");
    await signedIn("worker", "Beto Lista");

    const response = await ana.fetch("/usuarios");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Usuarios");
    expect(html).toContain("Ana Lista");
    expect(html).toContain("Beto Lista");
    expect(html).toContain("Administrador");
    expect(html).toContain("Empleado");
  });

  it("adds a User and shows a code that signs them in", async () => {
    const ana = await signedIn("admin", "Ana Alta");

    const response = await post(ana, { intent: "add", name: "Beto Alta", role: "worker" });

    expect(response.status).toBe(200);
    const cookie = await signInWith(codeShownOn(await response.text()));
    const home = await appFetch("/", { headers: { Cookie: cookie! } });
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("Beto Alta");
  });

  it("answers a name that is missing or taken in Spanish, and adds nobody", async () => {
    const ana = await signedIn("admin", "Ana Nombre");

    const missing = await post(ana, { intent: "add", name: " ", role: "worker" });
    const taken = await post(ana, { intent: "add", name: "ana nombre", role: "worker" });

    expect(missing.status).toBe(400);
    expect(await missing.text()).toContain("Escribe el nombre");
    expect(taken.status).toBe(400);
    expect(await taken.text()).toContain("Ya hay un usuario con ese nombre");
  });

  it("issues a new code for an existing User, for a second phone", async () => {
    const ana = await signedIn("admin", "Ana Código");
    const beto = await signedIn("worker", "Beto Código");

    const response = await post(ana, { intent: "new-code", userId: beto.user.id });

    const cookie = await signInWith(codeShownOn(await response.text()));
    expect((await appFetch("/", { headers: { Cookie: cookie! } })).status).toBe(200);
    expect((await beto.fetch("/")).status).toBe(200);
  });

  it("signs a User out everywhere: they lose access on their next request", async () => {
    const ana = await signedIn("admin", "Ana Fuera");
    const beto = await signedIn("worker", "Beto Fuera");
    expect((await beto.fetch("/")).status).toBe(200);

    const response = await post(ana, { intent: "sign-out-everywhere", userId: beto.user.id });

    expect(response.status).toBe(200);
    const next = await beto.fetch("/");
    expect(next.status).toBe(302);
    expect(next.headers.get("Location")).toBe("/entrar");
    expect((await ana.fetch("/")).status).toBe(200);
  });

  it("deactivates a User: they lose access on their next request, and stay on the list", async () => {
    const ana = await signedIn("admin", "Ana Baja");
    const beto = await signedIn("worker", "Beto Baja");
    expect((await beto.fetch("/")).status).toBe(200);

    const response = await post(ana, { intent: "deactivate", userId: beto.user.id });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Beto Baja");
    expect(html).toContain("Desactivado");
    const next = await beto.fetch("/");
    expect(next.status).toBe(302);
    expect(next.headers.get("Location")).toBe("/entrar");
  });

  it("reactivates a User, who then signs in with a new code", async () => {
    const ana = await signedIn("admin", "Ana Vuelta");
    const beto = await signedIn("worker", "Beto Vuelta");
    await post(ana, { intent: "deactivate", userId: beto.user.id });
    const refused = await post(ana, { intent: "new-code", userId: beto.user.id });
    expect(refused.status).toBe(400);

    await post(ana, { intent: "reactivate", userId: beto.user.id });

    const issued = await post(ana, { intent: "new-code", userId: beto.user.id });
    expect(await signInWith(codeShownOn(await issued.text()))).toBeDefined();
    // The phone that was signed in before stays out.
    expect((await beto.fetch("/")).status).toBe(302);
  });

  it("changes a role: the User reaches Usuarios as an Admin and not as a Worker", async () => {
    const ana = await signedIn("admin", "Ana Rol");
    const beto = await signedIn("worker", "Beto Rol");

    await post(ana, { intent: "change-role", userId: beto.user.id, role: "admin" });
    expect((await beto.fetch("/usuarios")).status).toBe(200);

    await post(ana, { intent: "change-role", userId: beto.user.id, role: "worker" });
    expect((await beto.fetch("/usuarios")).status).toBe(403);
  });

  it("answers a request it does not understand with 400", async () => {
    const ana = await signedIn("admin", "Ana Rara");

    expect((await post(ana, { intent: "delete", userId: ana.user.id })).status).toBe(400);
    expect((await post(ana, { intent: "add", name: "Zoe Rara", role: "owner" })).status).toBe(400);
    expect((await post(ana, { intent: "change-role", userId: ana.user.id, role: "owner" })).status).toBe(400);
    expect(await (await ana.fetch("/usuarios")).text()).not.toContain("Zoe Rara");
  });
});

describe("Usuarios, for a Worker", () => {
  it("is refused, as a page and as the router's data request, and shows no User", async () => {
    await signedIn("admin", "Ana Oculta");
    const beto = await signedIn("worker", "Beto Curioso");

    for (const path of ["/usuarios", "/usuarios.data"]) {
      const response = await beto.fetch(path);

      expect(response.status, path).toBe(403);
      expect(await response.text(), path).not.toContain("Ana Oculta");
    }
  });

  it("is refused every action, and nothing changes", async () => {
    const ana = await signedIn("admin", "Ana Firme");
    const beto = await signedIn("worker", "Beto Audaz");
    const attempts: ReadonlyArray<Record<string, string>> = [
      { intent: "add", name: "Carla Colada", role: "admin" },
      { intent: "new-code", userId: ana.user.id },
      { intent: "sign-out-everywhere", userId: ana.user.id },
      { intent: "deactivate", userId: ana.user.id },
      { intent: "reactivate", userId: ana.user.id },
      { intent: "change-role", userId: beto.user.id, role: "admin" },
      { intent: "change-role", userId: ana.user.id, role: "worker" },
    ];

    for (const fields of attempts) {
      for (const path of ["/usuarios", "/usuarios.data"]) {
        const response = await beto.fetch(path, { method: "POST", body: new URLSearchParams(fields) });

        expect(response.status, `${fields.intent} ${path}`).toBe(403);
        expect(await response.text(), `${fields.intent} ${path}`).not.toMatch(/[A-Z2-9]{4} [A-Z2-9]{4}/);
      }
    }

    // Ana is still signed in, still an Admin, and nobody was added.
    const usuarios = await ana.fetch("/usuarios");
    expect(usuarios.status).toBe(200);
    expect(await usuarios.text()).not.toContain("Carla Colada");
    expect((await beto.fetch("/usuarios")).status).toBe(403);
  });

  it("shows no link to Usuarios, while an Admin has one", async () => {
    const ana = await signedIn("admin", "Ana Menú");
    const beto = await signedIn("worker", "Beto Menú");

    expect(await (await ana.fetch("/")).text()).toContain('href="/usuarios"');
    expect(await (await beto.fetch("/")).text()).not.toContain("/usuarios");
  });
});
