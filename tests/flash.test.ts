import { describe, expect, it } from "vitest";

import { recordSelection } from "~/backend/bills";

import { as, landing, signedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";
import { saleForm } from "./support/sales";

// A form that records something answers with a redirect, and what the screen
// says afterwards travels with it in a short-lived cookie that the next page
// reads and clears (spec §3.4). Abonar on a Customer's page stands for every
// such form here; each route's own tests cover its own messages. A sale the
// browser's router sends to Vender is answered with its words in that answer
// itself instead (ticket 33), so a second tab has nothing to take.

/** A Customer who owes $50.00 on one Open Bill, and the Abonar form for it. */
async function owing(name: string) {
  const beto = await signedIn("worker", `Beto de ${name}`);
  const customer = await savedCustomer(name, { by: beto.user });
  const item = await runTest(seedItem({ name: `Café de ${name}`, price: 5000 }));
  await runTest(
    recordSelection({ items: [{ itemId: item.id, quantity: 1 }], customerId: customer.id }).pipe(as(beto.user)),
  );
  const path = `/clientes/${customer.id}`;
  // The Bill and its revision, as the page's own form carries them.
  const [, bill] = /name="bill" value="([^"]+)"/.exec(await (await beto.fetch(path)).text())!;
  const abonar = (amount: string) =>
    beto.fetch(path, {
      method: "POST",
      body: new URLSearchParams({ intent: "abonar", method: "cash", amount, bill: bill! }),
    });
  return { beto, path, abonar };
}

describe("a sale the browser sends", () => {
  it("is answered with its own words, and leaves no cookie another tab could take", async () => {
    const beto = await signedIn("worker", "Beto del navegador");
    const item = await runTest(seedItem({ name: "Café del navegador", price: 2000 }));

    const answer = await beto.fetch("/_.data?index", {
      method: "POST",
      body: saleForm({ itemId: item.id, submissionKey: "venta-a" }),
    });

    expect(answer.status).toBe(200);
    // The words travel in the answer itself: nothing waits in a cookie.
    expect(answer.headers.getSetCookie()).toEqual([]);
    expect(await answer.text()).toContain("Se dejó abierta una cuenta por $20.00.");

    // The page the router loads next does not show them again.
    const page = await beto.fetch("/_.data?_routes=routes%2Fhome");
    expect(await page.text()).not.toContain("Se dejó abierta");
  });

  it("carries each sale's own words, not the other's", async () => {
    const beto = await signedIn("worker", "Beto de dos ventas");
    const item = await runTest(seedItem({ name: "Agua de dos ventas", price: 1850 }));

    const [first, second] = await Promise.all([
      beto.fetch("/_.data?index", {
        method: "POST",
        body: saleForm({ itemId: item.id, submissionKey: "venta-una" }),
      }),
      beto.fetch("/_.data?index", {
        method: "POST",
        body: saleForm({ itemId: item.id, quantity: 2, submissionKey: "venta-dos" }),
      }),
    ]);
    const [firstText, secondText] = await Promise.all([first.text(), second.text()]);

    expect(firstText).toContain("$18.50");
    expect(firstText).not.toContain("$37.00");
    expect(secondText).toContain("$37.00");
    expect(secondText).not.toContain("$18.50");
  });

  it("still answers a document POST with a redirect and the cookie, once", async () => {
    const beto = await signedIn("worker", "Beto del documento");
    const item = await runTest(seedItem({ name: "Café del documento", price: 2000 }));

    const response = await beto.fetch("/?index", {
      method: "POST",
      body: saleForm({ itemId: item.id, submissionKey: "venta-doc" }),
    });

    expect(response.status).toBe(302);
    expect(await (await landing(beto, response)).text()).toContain("Se dejó abierta una cuenta por $20.00.");
  });
});

describe("a recorded form", () => {
  it("answers with a redirect, and the page it lands on shows the message", async () => {
    const { beto, path, abonar } = await owing("Familia del aviso");

    const response = await abonar("20.00");

    expect(response.status).toBe(302);
    // The message is not in the URL.
    expect(response.headers.get("Location")).toBe(path);

    const page = await landing(beto, response);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Abono de $20.00 registrado.");
  });

  it("shows the message once: the page that showed it clears it", async () => {
    const { beto, path, abonar } = await owing("Familia de una vez");

    const page = await landing(beto, await abonar("20.00"));

    // The landing page tells the browser to forget the message...
    const cleared = page.headers.getSetCookie().filter((cookie) => cookie.includes("Max-Age=0"));
    expect(cleared).toHaveLength(1);
    // ...so a reload, which no longer carries it, does not repeat it.
    const reloaded = await (await beto.fetch(path)).text();
    expect(reloaded).not.toContain("registrado.");
    expect(reloaded).toContain("Debe $30.00");
  });

  it("keeps the message for the page it was meant for", async () => {
    const { beto, abonar } = await owing("Familia de otra página");

    const response = await abonar("20.00");
    const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]!);

    // Another page neither shows the message nor clears it.
    const other = await beto.fetch("/clientes", { headers: { Cookie: [beto.cookie, ...cookies].join("; ") } });
    expect(await other.text()).not.toContain("registrado.");
    expect(other.headers.getSetCookie().filter((cookie) => cookie.includes("Max-Age=0"))).toEqual([]);

    expect(await (await landing(beto, response)).text()).toContain("Abono de $20.00 registrado.");
  });

  it("is a cookie the page's scripts cannot read and that lasts a minute", async () => {
    const { abonar } = await owing("Familia de la galleta");

    const cookies = (await abonar("20.00")).headers.getSetCookie();

    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("Secure");
    expect(cookies[0]).toContain("SameSite=Lax");
    expect(cookies[0]).toContain("Max-Age=60");
  });

  it("still answers a refusal with 400 and its message, and no redirect", async () => {
    const { abonar } = await owing("Familia rechazada");

    const response = await abonar("80.00");

    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.text()).toContain("El abono no puede ser mayor que lo que debe el cliente.");
  });
});
