import { env, exports } from "cloudflare:workers";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { Db } from "~/backend/db";
import { addUser, issueSignInCode } from "~/backend/sign-in";
import { formatSignInCode } from "~/shared/secret";

import { APP_ORIGIN, appFetch, signedIn } from "./support/auth";

// Through the whole Worker, on the real clock.

/** A User with a fresh code, as after the command line or an Admin issued it. */
function userWithCode(name: string, role: "admin" | "worker" = "worker") {
  return Effect.runPromise(
    Effect.gen(function* () {
      const user = yield* addUser(name, role);
      return { user, code: yield* issueSignInCode(user.id, null) };
    }).pipe(Effect.provide(Db.layer(env.DB))),
  );
}

function enterCode(code: string, init: RequestInit = {}) {
  return appFetch("/entrar", { method: "POST", body: new URLSearchParams({ code }), ...init });
}

/** The `name=value` pair of a `Set-Cookie` header, to send back as `Cookie`. */
function cookieFrom(response: Response): string {
  return response.headers.get("Set-Cookie")!.split(";")[0]!;
}

describe("Entrar", () => {
  it("is shown to a signed-out visitor, in Spanish, with one field for the code", async () => {
    const response = await appFetch("/entrar");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<html lang="es-MX">');
    expect(html).toContain("Entrar");
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toContain('name="code"');
  });

  it("signs the phone in with a valid code and sends it home", async () => {
    const { code } = await userWithCode("Carla");

    const response = await enterCode(formatSignInCode(code));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    const home = await appFetch("/", { headers: { Cookie: cookieFrom(response) } });
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("Carla");
  });

  it("keeps the session in an HttpOnly, Secure, SameSite=Lax cookie for the whole site", async () => {
    const { code } = await userWithCode("Dora");

    const response = await enterCode(code);

    const attributes = response.headers.get("Set-Cookie")!.split("; ").slice(1);
    expect(attributes).toContain("HttpOnly");
    expect(attributes).toContain("Secure");
    expect(attributes).toContain("SameSite=Lax");
    expect(attributes).toContain("Path=/");
  });

  it("answers a wrong code in Spanish and signs nobody in", async () => {
    const response = await enterCode("WRNG WRNG");

    expect(response.status).toBe(400);
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(await response.text()).toContain("Ese código no es válido");
  });

  // What the browser's router sends once the page's script has loaded.
  it("is reachable by a signed-out visitor through the router's data requests too", async () => {
    const { code } = await userWithCode("Dalia");

    const shown = await appFetch("/entrar.data");
    expect(shown.status).toBe(200);
    expect(await shown.text()).not.toContain("redirect");

    const entered = await appFetch("/entrar.data", { method: "POST", body: new URLSearchParams({ code }) });
    expect(await entered.text()).toContain('"redirect","/"');
    const home = await appFetch("/", { headers: { Cookie: cookieFrom(entered) } });
    expect(await home.text()).toContain("Dalia");
  });

  it("sends a phone that is already signed in home", async () => {
    const ana = await signedIn("admin");

    const response = await ana.fetch("/entrar");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
  });
});

describe("a signed-out visitor", () => {
  it("is sent to Entrar", async () => {
    const response = await appFetch("/");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/entrar");
  });

  it("is sent to Entrar when the cookie holds a token the app never handed out", async () => {
    const response = await appFetch("/", { headers: { Cookie: "__Host-gamo-session=forged" } });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/entrar");
  });
});

describe("the signed-in shell", () => {
  it("shows a Worker their name and the sections every User has, and no Admin section", async () => {
    const beto = await signedIn("worker", "Beto");

    const html = await (await beto.fetch("/")).text();

    expect(html).toContain("Beto");
    for (const section of ["Vender", "Cuentas abiertas", "Clientes", "Mi día"]) {
      expect(html).toContain(section);
    }
    for (const section of ["Inventario", "Historial", "Usuarios", "Por cobrar"]) {
      expect(html).not.toContain(section);
    }
  });

  it("shows an Admin the Admin sections as well", async () => {
    const ana = await signedIn("admin", "Ana");

    const html = await (await ana.fetch("/")).text();

    for (const section of [
      "Vender", "Cuentas abiertas", "Clientes", "Mi día",
      "Día", "Cuentas", "Por cobrar", "Inventario", "Diferencias", "Historial", "Productos", "Usuarios",
    ]) {
      expect(html).toContain(section);
    }
  });
});

describe("losing access", () => {
  it("happens on the next request after signing out, on that phone only", async () => {
    const phone = await signedIn("worker", "Elena");
    const { code } = await Effect.runPromise(
      Effect.map(issueSignInCode(phone.user.id, null), (code) => ({ code })).pipe(
        Effect.provide(Db.layer(env.DB)),
      ),
    );
    const otherPhone = cookieFrom(await enterCode(code));

    const response = await phone.fetch("/salir", { method: "POST" });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/entrar");
    // The browser is told to forget the cookie...
    expect(response.headers.get("Set-Cookie")).toMatch(/^__Host-gamo-session=;.*Max-Age=0/);
    // ...and the token is worthless to anyone who kept it.
    expect((await phone.fetch("/")).headers.get("Location")).toBe("/entrar");
    expect((await appFetch("/", { headers: { Cookie: otherPhone } })).status).toBe(200);
  });

  it("happens on the next request after the User is deactivated", async () => {
    const phone = await signedIn("worker", "Fabio");
    expect((await phone.fetch("/")).status).toBe(200);

    // Deactivating is ticket 03's operation; until it exists, this is its effect.
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(phone.user.id).run();

    const response = await phone.fetch("/");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/entrar");
  });

  it("happens on the next request after the session is revoked", async () => {
    const phone = await signedIn("worker", "Gina");

    // Signing a User out everywhere is ticket 03's operation; this is its effect.
    await env.DB.prepare("UPDATE sessions SET revoked_at = 1 WHERE user_id = ?").bind(phone.user.id).run();

    expect((await phone.fetch("/")).headers.get("Location")).toBe("/entrar");
  });

  it("means a deactivated User's code signs nobody in", async () => {
    const { user, code } = await userWithCode("Hugo");
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(user.id).run();

    const response = await enterCode(code);

    expect(response.status).toBe(400);
    expect(response.headers.has("Set-Cookie")).toBe(false);
  });
});

describe("a request that changes something", () => {
  it("is rejected when it comes from another origin, even with a valid session", async () => {
    const phone = await signedIn("worker", "Iris");

    const response = await phone.fetch("/salir", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    // Nothing happened: the session still works.
    expect((await phone.fetch("/")).status).toBe(200);
  });

  it("is rejected when it does not say where it comes from", async () => {
    const { code } = await userWithCode("Julia");

    const response = await exportsFetchWithoutOrigin("/entrar", code);

    expect(response.status).toBe(403);
    // The code was not consumed.
    expect((await enterCode(code)).status).toBe(302);
  });

  it("is accepted from the app's own origin", async () => {
    const { code } = await userWithCode("Karen");

    const response = await enterCode(code, { headers: { Origin: APP_ORIGIN } });

    expect(response.status).toBe(302);
  });
});

function exportsFetchWithoutOrigin(path: string, code: string) {
  return exports.default.fetch(
    new Request(new URL(path, APP_ORIGIN), {
      method: "POST",
      body: new URLSearchParams({ code }),
      redirect: "manual",
    }),
  );
}

describe("what D1 holds", () => {
  it("never includes a code or a session token in clear", async () => {
    const { code } = await userWithCode("Laura");
    const unused = await userWithCode("Marta");
    const cookie = cookieFrom(await enterCode(code));
    const token = cookie.split("=")[1]!;
    await enterCode("WRNG WRNG");

    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'",
    ).all<{ name: string }>();
    let everything = "";
    for (const { name } of tables.results) {
      everything += JSON.stringify((await env.DB.prepare(`SELECT * FROM ${name}`).all()).results);
    }

    expect(everything).toContain("Laura"); // the dump is real
    expect(everything).not.toContain(code);
    expect(everything).not.toContain(unused.code);
    expect(everything).not.toContain(token);
    expect(everything).not.toContain("WRNGWRNG");
  });
});
