import { describe, expect, it } from "vitest";

import { appFetch, landing, signedIn, type SignedIn } from "./support/auth";

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
    // Staff, not Customers; and no form is on the list.
    expect(html).toContain("Los clientes se anotan en");
    expect(html).toContain('href="/usuarios?paso=nuevo"');
    expect(html).toContain(`href="/usuarios?paso=usuario&amp;id=${ana.user.id}"`);
    expect(html).not.toContain('name="intent"');
  });

  it("keeps the deactivated Users apart, said in words", async () => {
    const ana = await signedIn("admin", "Ana Aparte");
    const beto = await signedIn("worker", "Beto Aparte");
    await post(ana, { intent: "deactivate", userId: beto.user.id });

    const html = await (await ana.fetch("/usuarios")).text();

    expect(html).toContain("Usuarios desactivados");
    expect(html.indexOf("Beto Aparte")).toBeGreaterThan(html.indexOf("Usuarios desactivados"));
    expect(html.indexOf("Ana Aparte")).toBeLessThan(html.indexOf("Usuarios desactivados"));
  });

  it("adds a User in a step of its own, which says what each role may do and lands on the code", async () => {
    const ana = await signedIn("admin", "Ana Paso");

    const step = await (await ana.fetch("/usuarios?paso=nuevo")).text();
    expect(step).toContain("Agregar usuario");
    expect(step).toContain("Vende, cobra y ve su propio día.");
    expect(step).toContain("administra productos y usuarios");

    const response = await ana.fetch("/usuarios?paso=nuevo", {
      method: "POST",
      body: new URLSearchParams({ intent: "add", name: "Beto Paso", role: "worker" }),
    });
    expect(response.headers.get("Location")).toBe("/usuarios?paso=nuevo");
    const html = await (await landing(ana, response)).text();
    expect(html).toContain("Código de acceso para");
    expect(html).toContain("Sirve una sola vez y dura 10 minutos.");
    expect(html).toContain("Entrar");
    expect(await signInWith(codeShownOn(html))).toBeDefined();
  });

  it("shows one User in a step of their own, with what each action does", async () => {
    const ana = await signedIn("admin", "Ana Detalle");
    const beto = await signedIn("worker", "Beto Detalle");

    const html = await (await ana.fetch(`/usuarios?paso=usuario&id=${beto.user.id}`)).text();

    expect(html).toContain("Beto Detalle");
    for (const intent of ["new-code", "change-role", "sign-out-everywhere", "deactivate"]) {
      expect(html, intent).toContain(`value="${intent}"`);
    }
    expect(html).toContain("Sus otros teléfonos siguen con su sesión.");
    expect(html).toContain("Podrá ver el día de todos");
    expect(html).toContain("Para volver a entrar necesitará un código.");
    expect(html).toContain("Lo que registró se conserva");
    expect((await ana.fetch("/usuarios?paso=usuario&id=nadie")).status).toBe(404);
  });

  it("offers a deactivated User no code and no sessions to close, only the way back in", async () => {
    const ana = await signedIn("admin", "Ana Sin Código");
    const beto = await signedIn("worker", "Beto Sin Código");
    await post(ana, { intent: "deactivate", userId: beto.user.id });

    const html = await (await ana.fetch(`/usuarios?paso=usuario&id=${beto.user.id}`)).text();

    expect(html).toContain("Desactivado");
    expect(html).toContain('value="reactivate"');
    for (const intent of ["new-code", "sign-out-everywhere", "deactivate"]) {
      expect(html, intent).not.toContain(`value="${intent}"`);
    }
  });

  it("adds a User and shows a code that signs them in", async () => {
    const ana = await signedIn("admin", "Ana Alta");

    const response = await post(ana, { intent: "add", name: "Beto Alta", role: "worker" });

    const cookie = await signInWith(codeShownOn(await (await landing(ana, response)).text()));
    const home = await appFetch("/", { headers: { Cookie: cookie! } });
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("Beto Alta");
  });

  it("answers a new code with a redirect, and shows the code once", async () => {
    const ana = await signedIn("admin", "Ana Una Vez");

    const response = await post(ana, { intent: "add", name: "Beto Una Vez", role: "worker" });

    expect(response.status).toBe(302);
    // The code is not in the URL.
    expect(response.headers.get("Location")).toBe("/usuarios");
    expect(await (await landing(ana, response)).text()).toContain("Código de acceso para");
    // A reload shows no code and issues none.
    expect(await (await ana.fetch("/usuarios")).text()).not.toContain("Código de acceso para");
  });

  it("answers a name that is missing or taken in Spanish, and adds nobody", async () => {
    const ana = await signedIn("admin", "Ana Nombre");

    const add = (name: string) =>
      ana.fetch("/usuarios?paso=nuevo", { method: "POST", body: new URLSearchParams({ intent: "add", name, role: "worker" }) });
    const missing = await add(" ");
    const taken = await add("ana nombre");

    expect(missing.status).toBe(400);
    const missingHtml = await missing.text();
    expect(missingHtml).toContain("Escribe el nombre");
    // Said on the field it is about.
    expect(missingHtml).toContain('aria-invalid="true"');
    expect(taken.status).toBe(400);
    expect(await taken.text()).toContain("Ya hay un usuario con ese nombre");
  });

  it("issues a new code for an existing User, for a second phone", async () => {
    const ana = await signedIn("admin", "Ana Código");
    const beto = await signedIn("worker", "Beto Código");

    const response = await post(ana, { intent: "new-code", userId: beto.user.id });

    const cookie = await signInWith(codeShownOn(await (await landing(ana, response)).text()));
    expect((await appFetch("/", { headers: { Cookie: cookie! } })).status).toBe(200);
    expect((await beto.fetch("/")).status).toBe(200);
  });

  it("signs a User out everywhere: they lose access on their next request", async () => {
    const ana = await signedIn("admin", "Ana Fuera");
    const beto = await signedIn("worker", "Beto Fuera");
    expect((await beto.fetch("/")).status).toBe(200);

    const response = await post(ana, { intent: "sign-out-everywhere", userId: beto.user.id });

    expect(await (await landing(ana, response)).text()).toContain("Se cerró su sesión en todos los teléfonos. Para volver a entrar necesita un código.");
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

    const html = await (await landing(ana, response)).text();
    expect(html).toContain("Usuario desactivado. Ya no puede entrar.");
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
    expect(await signInWith(codeShownOn(await (await landing(ana, issued)).text()))).toBeDefined();
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

    const ana = await signedIn("admin", "Ana Oculta Dos");
    const step = `paso=usuario&id=${ana.user.id}`;
    for (const path of ["/usuarios", "/usuarios.data", "/usuarios?paso=nuevo", `/usuarios?${step}`, `/usuarios.data?${step}`]) {
      const response = await beto.fetch(path);

      expect(response.status, path).toBe(403);
      expect(await response.text(), path).not.toContain("Ana Oculta");
    }
  });

  it("is refused before a form is read: one nobody understands is a 403 too", async () => {
    const beto = await signedIn("worker", "Beto Raro");

    const response = await post(beto, { intent: "delete" });

    expect(response.status).toBe(403);
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

    expect(await (await ana.fetch("/mas")).text()).toContain('href="/usuarios"');
    for (const path of ["/", "/mas"]) {
      expect(await (await beto.fetch(path)).text(), path).not.toContain("/usuarios");
    }
  });
});
