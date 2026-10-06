import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { codeForUser, findActiveUsers, firstAdmin } from "~/backend/command-line";

import { appFetch } from "./support/auth";

// scripts/sign-in-code.ts hands these statements to `wrangler d1 execute`,
// which takes SQL text and no parameters. Here they run against the test D1,
// and the code they stand for is then typed into the real Entrar.

async function execute(statements: ReadonlyArray<string>) {
  const results = [];
  for (const sql of statements) results.push((await env.DB.prepare(sql).all()).results);
  return results;
}

async function signInWith(code: string) {
  const response = await appFetch("/entrar", { method: "POST", body: new URLSearchParams({ code }) });
  const cookie = response.headers.get("Set-Cookie")?.split(";")[0];
  return { response, home: cookie ? await appFetch("/", { headers: { Cookie: cookie } }) : undefined };
}

describe("the command line", () => {
  it("creates the first Admin with a code that signs them in", async () => {
    const { code, statements } = await firstAdmin("Diego", Date.now());
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);

    await execute(statements);

    const { response, home } = await signInWith(code);
    expect(response.status).toBe(302);
    const html = await home!.text();
    expect(html).toContain("Diego");
    expect(html).toContain("Administrador");
  });

  it("issues a code for an existing User, found by name", async () => {
    await execute((await firstAdmin("Sofía", Date.now())).statements);

    const [found] = await execute([findActiveUsers("Sofía")]);
    expect(found).toEqual([{ id: expect.any(String), name: "Sofía", role: "admin" }]);
    const { id } = found![0] as { id: string };
    const { code, statements } = await codeForUser(id, Date.now());
    await execute(statements);

    expect((await signInWith(code)).response.status).toBe(302);
  });

  it("issues codes that expire after 10 minutes like any other", async () => {
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    const { code, statements } = await firstAdmin("Tarde", elevenMinutesAgo);
    await execute(statements);

    expect((await signInWith(code)).response.status).toBe(400);
  });

  it("takes a name with a quote in it as a name and not as SQL", async () => {
    const name = "D'Angelo'); DROP TABLE users; --";

    await execute((await firstAdmin(name, Date.now())).statements);

    const [found] = await execute([findActiveUsers(name)]);
    expect(found).toEqual([{ id: expect.any(String), name, role: "admin" }]);
  });

  it("does not find a deactivated User", async () => {
    await execute((await firstAdmin("Inactiva", Date.now())).statements);
    await env.DB.prepare("UPDATE users SET active = 0 WHERE name = ?").bind("Inactiva").run();

    expect(await execute([findActiveUsers("Inactiva")])).toEqual([[]]);
  });

  it("never puts the code itself in what it sends to D1", async () => {
    const { code, statements } = await firstAdmin("Diego", Date.now());
    expect(statements.join("\n")).not.toContain(code);
  });
});
