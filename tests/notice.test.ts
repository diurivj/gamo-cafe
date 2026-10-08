import { describe, expect, it } from "vitest";

import { recordSelection } from "~/backend/bills";

import { as, landing, signedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";

// A recorded form answers the request that sent it with a notice: what that
// screen must say (spec §3.4, tickets 33 and 34). Two paths reach it. The
// browser's router sends the form as a data request, and the notice travels
// in the action's own answer; a document POST is answered with a redirect
// whose cookie the page it lands on reads and clears. Cuenta's **Cliente y
// nota** stands for both here. A sale, a Payment, a correction and an Abonar
// are not among them: each is answered by its own route, in JSON
// (tests/vender.test.ts, tests/abonar-routes.test.ts). Each route's own tests
// cover its own messages.

const SAVED = "Se guardaron los cambios de la cuenta.";

/** An Open Bill with no Payment, and the form that changes its note. */
async function billOf(name: string) {
  const beto = await signedIn("worker", `Beto de ${name}`);
  const customer = await savedCustomer(name, { by: beto.user });
  const item = await runTest(seedItem({ name: `Café de ${name}`, price: 5000 }));
  const bill = await runTest(
    recordSelection({ items: [{ itemId: item.id, quantity: 1 }], customerId: customer.id }).pipe(as(beto.user)),
  );
  const path = `/cuentas/${bill.id}`;
  // The first form carries the revision the Bill was recorded with.
  const saveNote = (note: string, to = path) =>
    beto.fetch(to, {
      method: "POST",
      body: new URLSearchParams({
        intent: "editar",
        revision: String(bill.revision),
        customerId: customer.id,
        note,
      }),
    });
  return { beto, path, saveNote };
}

describe("a recorded form", () => {
  it("answers the browser's request with the notice itself, and no cookie", async () => {
    const { beto, path, saveNote } = await billOf("Familia del navegador");

    const answer = await saveNote("Mesa 4", `${path}.data`);

    expect(answer.status).toBe(200);
    // The words travel in the answer: no cookie waits for another tab.
    expect(answer.headers.getSetCookie()).toEqual([]);
    expect(await answer.text()).toContain(SAVED);

    // The page the router loads next does not show them again.
    const page = await beto.fetch(`${path}.data`);
    expect(await page.text()).not.toContain(SAVED);
  });

  it("answers with a redirect, and the page it lands on shows the message", async () => {
    const { beto, path, saveNote } = await billOf("Familia del aviso");

    const response = await saveNote("Mesa 4");

    expect(response.status).toBe(302);
    // The message is not in the URL.
    expect(response.headers.get("Location")).toBe(path);

    const page = await landing(beto, response);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(SAVED);
  });

  it("shows the message once: the page that showed it clears it", async () => {
    const { beto, path, saveNote } = await billOf("Familia de una vez");

    const page = await landing(beto, await saveNote("Mesa 4"));

    // The landing page tells the browser to forget the message...
    const cleared = page.headers.getSetCookie().filter((cookie) => cookie.includes("Max-Age=0"));
    expect(cleared).toHaveLength(1);
    // ...so a reload, which no longer carries it, does not repeat it.
    const reloaded = await (await beto.fetch(path)).text();
    expect(reloaded).not.toContain(SAVED);
    expect(reloaded).toContain("Mesa 4");
  });

  it("keeps the message for the page it was meant for", async () => {
    const { beto, saveNote } = await billOf("Familia de otra página");

    const response = await saveNote("Mesa 4");
    const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]!);

    // Another page neither shows the message nor clears it.
    const other = await beto.fetch("/clientes", { headers: { Cookie: [beto.cookie, ...cookies].join("; ") } });
    expect(await other.text()).not.toContain(SAVED);
    expect(other.headers.getSetCookie().filter((cookie) => cookie.includes("Max-Age=0"))).toEqual([]);

    expect(await (await landing(beto, response)).text()).toContain(SAVED);
  });

  it("is a cookie the page's scripts cannot read and that lasts a minute", async () => {
    const { saveNote } = await billOf("Familia de la galleta");

    const cookies = (await saveNote("Mesa 4")).headers.getSetCookie();

    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("Secure");
    expect(cookies[0]).toContain("SameSite=Lax");
    expect(cookies[0]).toContain("Max-Age=60");
  });

  it("still answers a refusal with 400 and its message, and no redirect", async () => {
    const { saveNote } = await billOf("Familia rechazada");

    const response = await saveNote("x".repeat(81));

    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.text()).toContain("La nota no puede pasar de 80 caracteres.");
  });
});
