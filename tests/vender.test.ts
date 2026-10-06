import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { getBill } from "~/backend/bills";
import { retireItem } from "~/backend/catalog";
import { Db } from "~/backend/db";

import { as, landing, signedIn, type SignedIn } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";

// Vender through the Worker: what the route lets in, how it reads the form,
// and what it answers. The rules themselves are tested in bills.test.ts.

const selection = (items: ReadonlyArray<{ itemId: string; quantity: number }>) => JSON.stringify(items);

const post = (who: SignedIn, fields: Record<string, string>) =>
  // `?index` aims the POST at the index route's action, not the layout's.
  who.fetch("/?index", { method: "POST", body: new URLSearchParams(fields) });
/** The Bill the recorded answer points at, so a test can read it back. */
const billIdIn = (html: string) => {
  const billId = /data-bill-id="([^"]+)"/.exec(html)?.[1];
  expect(billId, "the answer carried the Bill it recorded").toBeTruthy();
  return billId!;
};

describe("Vender", () => {
  it("shows a Worker the menu and leaves the recorded selection Open, with its note", async () => {
    const beto = await signedIn("worker", "Beto");
    const bebidas = await runTest(seedCategory("Bebidas del turno"));
    const agua = await runTest(
      seedItem({ name: "Agua del turno", price: 1850, categoryId: bebidas.id, startingStock: 4 }),
    );

    const menu = await (await beto.fetch("/")).text();
    expect(menu).toContain("Vender");
    expect(menu).toContain("Bebidas del turno");
    expect(menu).toContain("Agua del turno");
    expect(menu).toContain("$18.50");

    const response = await post(beto, {
      intent: "dejar-abierta",
      selection: selection([{ itemId: agua.id, quantity: 2 }]),
      customerId: "",
      note: "Para la mesa 2",
    });

    expect(response.headers.get("Location")).toBe("/");
    const html = await (await landing(beto, response)).text();
    expect(html).toContain("Se dejó abierta una cuenta por $37.00.");
    const bill = await runTest(getBill(billIdIn(html)).pipe(as(beto.user)));
    expect(bill).toMatchObject({ total: 3700, paid: 0, state: "open", note: "Para la mesa 2", customer: null });
    expect(bill.lines).toMatchObject([
      { itemId: agua.id, itemName: "Agua del turno", quantity: 2, unitPrice: 1850, by: beto.user.id },
    ]);
  });

  it("records a Customer's two selections onto one Open Bill of the Day", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia del turno", { by: beto.user });
    const item = await runTest(seedItem({ name: "Café del turno", price: 2000 }));
    const fields = {
      intent: "dejar-abierta",
      selection: selection([{ itemId: item.id, quantity: 1 }]),
      customerId: ruiz.id,
      note: "",
    };

    const first = await post(beto, fields);
    const firstHtml = await (await landing(beto, first)).text();
    expect(firstHtml).toContain("Se dejó abierta la cuenta de Familia del turno por $20.00.");

    const second = await post(beto, fields);
    const secondHtml = await (await landing(beto, second)).text();
    expect(secondHtml).toContain("Se dejó abierta la cuenta de Familia del turno por $40.00.");

    expect(billIdIn(secondHtml)).toBe(billIdIn(firstHtml));
    expect(await runTest(getBill(billIdIn(secondHtml)).pipe(as(beto.user)))).toMatchObject({ total: 4000, state: "open" });
  });

  it("is told in Spanish when the selection has a retired Item", async () => {
    const ana = await signedIn("admin");
    const item = await runTest(seedItem({ name: "Retirado de Vender", price: 1000, by: ana.user }));
    await runTest(retireItem(item.id).pipe(as(ana.user)));

    const response = await post(ana, {
      intent: "dejar-abierta",
      selection: selection([{ itemId: item.id, quantity: 1 }]),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "Un producto de la selección ya no está disponible. Quítalo y vuelve a intentar.",
    );
  });

  it("is told in Spanish when the Customer is retired, the selection is empty or the note is too long", async () => {
    const ana = await signedIn("admin");
    const item = await runTest(seedItem({ name: "Con nota larga", price: 1000, by: ana.user }));
    const gone = await savedCustomer("Cliente fuera de Vender", { by: ana.user, retired: true });
    const one = selection([{ itemId: item.id, quantity: 1 }]);

    const requests = [
      await post(ana, { intent: "dejar-abierta", selection: "[]" }),
      await post(ana, { intent: "dejar-abierta", selection: one, customerId: gone.id }),
      await post(ana, { intent: "dejar-abierta", selection: one, note: "x".repeat(81) }),
      await post(ana, { intent: "dejar-abierta", selection: "no es json" }),
      await post(ana, { intent: "otra-cosa", selection: one }),
    ];

    expect(requests.map((response) => response.status)).toEqual([400, 400, 400, 400, 400]);
    const messages = await Promise.all(requests.map((response) => response.text()));
    expect(messages[0]).toContain("Agrega al menos un producto.");
    expect(messages[1]).toContain("Ese cliente no existe o está retirado.");
    expect(messages[2]).toContain("La nota no puede pasar de 80 caracteres.");
    expect(messages[3]).toContain("No pudimos leer la selección. Recarga la página.");
    expect(messages[4]).toContain("No entendimos esa acción.");
  });

  it("Cobrar records the selection and the Payment together and leaves the Bill Pagada", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const item = await runTest(seedItem({ name: "Cobrado en Vender", price: 1850, startingStock: 3 }));

    const response = await post(beto, {
      intent: "cobrar",
      selection: selection([{ itemId: item.id, quantity: 2 }]),
      method: "cash",
      amount: "",
    });

    const html = await (await landing(beto, response)).text();
    expect(html).toContain("Cuenta pagada: $37.00.");
    // A Worker may not open the Paid Bill (§4.1): read it as an Admin.
    const bill = await runTest(getBill(billIdIn(html)).pipe(as(ana.user)));
    expect(bill).toMatchObject({ total: 3700, paid: 3700, owed: 0, state: "paid" });
    expect(bill.payments).toMatchObject([
      { amount: 3700, method: "cash", by: beto.user.id, byName: "Beto", day: bill.day },
    ]);
    expect(bill.lines).toMatchObject([{ itemId: item.id, quantity: 2, by: beto.user.id }]);
  });

  it("Cobrar with less than the total leaves the Bill Pago parcial", async () => {
    const ana = await signedIn("admin", "Ana");
    const item = await runTest(seedItem({ name: "Abonado en Vender", price: 1850, by: ana.user }));

    const response = await post(ana, {
      intent: "cobrar",
      selection: selection([{ itemId: item.id, quantity: 2 }]),
      method: "transfer",
      amount: "10.00",
    });

    const html = await (await landing(ana, response)).text();
    expect(html).toContain("Abono registrado. Debe $27.00.");
    const bill = await runTest(getBill(billIdIn(html)).pipe(as(ana.user)));
    expect(bill).toMatchObject({ total: 3700, paid: 1000, owed: 2700, state: "partial" });
    expect(bill.payments).toMatchObject([{ amount: 1000, method: "transfer" }]);
  });

  it("is told in Spanish about a Payment of zero, too large or unreadable, and records nothing", async () => {
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "Pago rechazado al vender", price: 1000 }));
    const one = selection([{ itemId: item.id, quantity: 1 }]);

    const requests = [
      await post(beto, { intent: "cobrar", selection: one, method: "cash", amount: "0" }),
      await post(beto, { intent: "cobrar", selection: one, method: "cash", amount: "10.01" }),
      await post(beto, { intent: "cobrar", selection: one, method: "cash", amount: "no es un monto" }),
      await post(beto, { intent: "cobrar", selection: one, amount: "" }),
    ];

    expect(requests.map((request) => request.status)).toEqual([400, 400, 400, 400]);
    const messages = await Promise.all(requests.map((request) => request.text()));
    expect(messages[0]).toContain("El pago debe ser mayor que cero.");
    expect(messages[1]).toContain("El pago no puede ser mayor que el total de la selección.");
    expect(messages[2]).toContain("El monto no es válido. Escríbelo como 18.50.");
    expect(messages[3]).toContain("Elige cómo se pagó.");

    // All or nothing: no Line of the refused sales exists (spec §7.3).
    const lines = await runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const counted = yield* db.first(
          Schema.Struct({ lines: Schema.Int }),
          "SELECT COUNT(*) AS lines FROM lines WHERE item_id = ?",
          item.id,
        );
        return counted!.lines;
      }),
    );
    expect(lines).toBe(0);
  });
});
