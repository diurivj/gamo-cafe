import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { recordSelection } from "~/backend/bills";
import { retireItem, updateItem } from "~/backend/catalog";

import { as, seedUser, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { measured } from "./support/d1";
import { runTest } from "./support/effect";
import { saleForm } from "./support/sales";

// Spec §3.4: what is not about money is not fetched again after every sale.
// These are the requests the browser's router sends (e2e/reuse.spec.ts checks
// that it sends exactly these): a page's data lives at its path plus `.data`,
// and `_routes` names the loaders to run when some are skipped.

/** The loaders of Vender that run after a sale: the page's own, nothing above it. */
const AFTER_A_SALE = "/_.data?_routes=routes%2Fhome";
/** Every loader of Vender, as when it is opened. */
const OPENING_VENDER = "/_.data";

/** The `Cookie` header of a phone that sent `sent` and got this response: a cookie set again replaces its old value. */
function cookies(sent: string, response: Response): string {
  const jar = new Map(sent.split("; ").map((pair) => [pair.split("=")[0]!, pair]));
  for (const set of response.headers.getSetCookie()) {
    const pair = set.split(";")[0]!;
    jar.set(pair.split("=")[0]!, pair);
  }
  return [...jar.values()].join("; ");
}

/** One sale as Vender's form sends it from the browser, and what its own answer said. */
async function sell(who: Pick<SignedIn, "cookie" | "fetch">, itemId: string, message: string) {
  const sale = await measured(() =>
    who.fetch("/_.data?index", {
      method: "POST",
      headers: { Cookie: who.cookie },
      body: saleForm({ itemId, intent: "cobrar" }),
    }),
  );
  // The screen that sent the sale is answered with its words (ticket 33),
  // and no cookie is set for a later load to read.
  expect(sale.body, "the sale answered the screen that sent it").toContain(message);
  expect(sale.response.headers.getSetCookie()).toEqual([]);
  return { ...sale, cookie: cookies(who.cookie, sale.response) };
}

describe("after a sale on Vender", () => {
  it("runs no catalog read and no shell loader: the session's read is the only statement", async () => {
    const beto = await signedIn("worker", "Beto");
    const cafe = await runTest(seedItem({ name: "Café que no se vuelve a leer", price: 2500 }));

    const opened = await measured(() => beto.fetch(OPENING_VENDER));
    expect(opened.body).toContain("Café que no se vuelve a leer");
    expect(opened.body).toContain("Beto");
    // The phone now holds the cookie that says whose shell it shows.
    const phone = { ...beto, cookie: cookies(beto.cookie, opened.response) };

    for (const _sale of ["first", "second"]) {
      const { cookie } = await sell(phone, cafe.id, "Cuenta pagada: $25.00.");
      const after = await measured(() => beto.fetch(AFTER_A_SALE, { headers: { Cookie: cookie } }));

      expect(after.response.status).toBe(200);
      expect(after.body, "the words are not fetched again").not.toContain("Cuenta pagada: $25.00.");
      expect(after.body, "the catalog").not.toContain("Café que no se vuelve a leer");
      expect(after.body, "the shell").not.toContain("Beto");
      expect(after.statements).toBe(1);
      expect(after.rowsWritten).toBe(0);
    }
  });

  it("reads the Items again when Vender is opened: one added, repriced or retired meanwhile is right", async () => {
    const beto = await signedIn("worker", "Beto del menú");
    const ana = await runTest(seedUser("admin", "Ana del menú"));
    const pan = await runTest(seedItem({ name: "Pan de ayer", price: 1200, by: ana }));
    const jugo = await runTest(seedItem({ name: "Jugo que se retira", price: 3000, by: ana }));
    expect((await measured(() => beto.fetch(OPENING_VENDER))).body).toContain("Jugo que se retira");

    await runTest(
      Effect.gen(function* () {
        yield* seedItem({ name: "Té recién agregado", price: 1500, by: ana });
        yield* updateItem(pan.id, { ...pan, price: 1350 }).pipe(as(ana));
        yield* retireItem(jugo.id).pipe(as(ana));
      }),
    );

    const opened = await measured(() => beto.fetch(OPENING_VENDER));
    expect(opened.body).toContain("Té recién agregado");
    expect(opened.body).toContain("1350");
    expect(opened.body).not.toContain("Jugo que se retira");
  });
});

describe("a User whose role an Admin changed", () => {
  const changeRole = (admin: SignedIn, userId: string, role: "admin" | "worker") =>
    admin.fetch("/usuarios", {
      method: "POST",
      body: new URLSearchParams({ intent: "change-role", userId, role }),
    });

  it("gets the whole page again on their next navigation, and with it the right navigation", async () => {
    const ana = await signedIn("admin", "Ana que cambia roles");
    const beto = await signedIn("worker", "Beto por ascender");

    // Beto's phone has the shell on screen, and navigates without asking for it.
    const first = await beto.fetch("/");
    expect(await first.text()).not.toContain("Inventario");
    const phone = cookies(beto.cookie, first);
    const navigation = "/cuentas-abiertas.data?_routes=routes%2Fopen-bills";
    expect(await (await beto.fetch(navigation, { headers: { Cookie: phone } })).text()).toContain("routes/open-bills");

    expect((await changeRole(ana, beto.user.id, "admin")).status).toBe(302);

    // No data under the old shell: a reload of the page that was asked for.
    const next = await beto.fetch(navigation, { headers: { Cookie: phone } });
    const answer = await next.text();
    expect(next.status).toBe(202);
    expect(answer).toContain('"/cuentas-abiertas"');
    expect(answer).toContain('"reload",true');
    expect(answer).not.toContain("routes/");

    // The reload shows an Admin's navigation, and navigating works again.
    const reloaded = await beto.fetch("/cuentas-abiertas", { headers: { Cookie: phone } });
    expect(await reloaded.text()).toContain("Inventario");
    const after = await beto.fetch(navigation, { headers: { Cookie: cookies(phone, reloaded) } });
    expect(after.status).toBe(200);
    expect(await after.text()).toContain("routes/open-bills");
  });

  it("is not reloaded by a navigation that asks for the shell anyway", async () => {
    const ana = await signedIn("admin", "Ana otra vez");
    const beto = await signedIn("worker", "Beto otra vez");
    const phone = cookies(beto.cookie, await beto.fetch("/"));
    await changeRole(ana, beto.user.id, "admin");

    const whole = await beto.fetch("/cuentas-abiertas.data", { headers: { Cookie: phone } });

    expect(whole.status).toBe(200);
    expect(await whole.text()).toContain("Inventario");
  });
});

describe("what is about Bills, Payments or Stock", () => {
  it("is never to be stored: every answer carries Cache-Control: no-store", async () => {
    const ana = await signedIn("admin", "Ana sin caché");
    const item = await runTest(seedItem({ name: "Café sin caché", price: 2000, startingStock: 5, by: ana.user }));
    const customer = await savedCustomer("Familia sin caché", { by: ana.user });
    const bill = await runTest(
      recordSelection({ items: [{ itemId: item.id, quantity: 1 }], customerId: customer.id }).pipe(as(ana.user)),
    );
    const phone = cookies(ana.cookie, await ana.fetch("/"));

    const pages = [
      "/",
      `/?billId=${bill.id}`,
      "/cuentas-abiertas",
      "/cuentas",
      `/cuentas/${bill.id}`,
      "/clientes",
      `/clientes/${customer.id}`,
      "/mi-dia",
      "/dia",
      "/por-cobrar",
      "/inventario",
      "/inventario/conteo",
      "/diferencias",
      "/historial",
      "/productos",
      `/productos/${item.id}`,
    ];
    for (const page of pages) {
      const [path, search = ""] = page.split("?");
      const data = `${path === "/" ? "/_" : path}.data${search ? `?${search}` : ""}`;
      for (const url of [page, data, AFTER_A_SALE]) {
        const response = await ana.fetch(url, { headers: { Cookie: phone } });
        expect(response.status, url).toBe(200);
        expect(response.headers.get("Cache-Control"), url).toBe("no-store");
      }
    }

    // A recorded form's redirect, and a refused one.
    const sale = await sell({ ...ana, cookie: phone }, item.id, "Cuenta pagada: $20.00.");
    expect(sale.response.headers.get("Cache-Control")).toBe("no-store");
    const refused = await ana.fetch("/?index", { method: "POST", body: new URLSearchParams({ intent: "cobrar" }) });
    expect(refused.status).toBe(400);
    expect(refused.headers.get("Cache-Control")).toBe("no-store");
  });
});
