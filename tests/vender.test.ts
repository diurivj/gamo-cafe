import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { getBill } from "~/backend/bills";
import { retireItem } from "~/backend/catalog";
import { Db } from "~/backend/db";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";
import { recordSale } from "./support/sales";

// Vender through the Worker: what its screen carries, how the route a sale is
// sent to reads it, and what it answers (UI redesign §6). The rules
// themselves are tested in bills.test.ts, the screen's state in sale.test.ts.

const selection = (items: ReadonlyArray<{ itemId: string; quantity: number }>) => JSON.stringify(items);

const post = (who: SignedIn, fields: Record<string, string>) => recordSale(who, fields);

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

    const { response, sale } = await post(beto, {
      intent: "dejar-abierta",
      selection: selection([{ itemId: agua.id, quantity: 2 }]),
      customerId: "",
      note: "Para la mesa 2",
    });

    expect(response.status).toBe(200);
    // Answered to the request that sent it, and nothing left in a cookie.
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(sale).toEqual({
      billId: expect.any(String),
      customerName: null,
      total: 3700,
      owed: 3700,
      state: "open",
      canOpen: true,
    });
    const bill = await runTest(getBill(sale!.billId).pipe(as(beto.user)));
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
    expect(first.sale).toMatchObject({ customerName: "Familia del turno", total: 2000, owed: 2000 });

    const second = await post(beto, fields);
    expect(second.sale).toMatchObject({ billId: first.sale!.billId, total: 4000, owed: 4000, state: "open" });
  });

  it("answers a Payment of the new selection with what the Customer's Bill still owes from before", async () => {
    const beto = await signedIn("worker", "Beto");
    const lupita = await savedCustomer("Lupita con deuda", { by: beto.user });
    const item = await runTest(seedItem({ name: "Café con deuda", price: 2000 }));
    const one = selection([{ itemId: item.id, quantity: 1 }]);
    const earlier = await post(beto, { intent: "dejar-abierta", selection: one, customerId: lupita.id });

    // Paid in full, and the Bill it joined is not Paid: the earlier $20.00 is still owed.
    const paid = await post(beto, { intent: "cobrar", selection: one, customerId: lupita.id, method: "cash", amount: "" });

    expect(paid.sale).toEqual({
      billId: earlier.sale!.billId,
      customerName: "Lupita con deuda",
      total: 4000,
      owed: 2000,
      state: "partial",
      canOpen: true,
    });
  });

  it("answers two sales sent together each with its own Bill", async () => {
    const beto = await signedIn("worker", "Beto de dos ventas");
    const item = await runTest(seedItem({ name: "Agua de dos ventas", price: 1850 }));

    const [first, second] = await Promise.all([
      post(beto, { intent: "dejar-abierta", selection: selection([{ itemId: item.id, quantity: 1 }]) }),
      post(beto, { intent: "dejar-abierta", selection: selection([{ itemId: item.id, quantity: 2 }]) }),
    ]);

    expect(first.sale).toMatchObject({ total: 1850 });
    expect(second.sale).toMatchObject({ total: 3700 });
    expect(second.sale!.billId).not.toBe(first.sale!.billId);
  });

  it("is told in Spanish which Items are retired, so the screen can take them out", async () => {
    const ana = await signedIn("admin");
    const item = await runTest(seedItem({ name: "Retirado de Vender", price: 1000, by: ana.user }));
    await runTest(retireItem(item.id).pipe(as(ana.user)));

    const { response, error, unavailable } = await post(ana, {
      intent: "dejar-abierta",
      selection: selection([{ itemId: item.id, quantity: 1 }]),
    });

    expect(response.status).toBe(400);
    expect(error).toBe("Un producto ya no está disponible y se quitó de la selección. Revísala y vuelve a registrar.");
    expect(unavailable).toEqual([item.id]);
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
      await post(ana, { intent: "dejar-abierta", selection: one, billId: "no-existe" }),
    ];

    expect(requests.map(({ response }) => response.status)).toEqual([400, 400, 400, 400, 400, 400]);
    expect(requests.map(({ error }) => error)).toEqual([
      "Agrega al menos un producto.",
      "Ese cliente no existe o está retirado.",
      "La nota no puede pasar de 80 caracteres.",
      "No pudimos leer la selección. Recarga la página.",
      "No entendimos esa acción. Recarga la página e intenta de nuevo.",
      "Esa cuenta ya no existe. Registra los productos en una cuenta nueva.",
    ]);
  });

  it("Cobrar records the selection and the Payment together and leaves the Bill Pagada, which a Worker cannot open", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const item = await runTest(seedItem({ name: "Cobrado en Vender", price: 1850, startingStock: 3 }));
    const fields = {
      intent: "cobrar",
      selection: selection([{ itemId: item.id, quantity: 2 }]),
      method: "cash",
      amount: "$37.00",
    };

    const { sale } = await post(beto, fields);

    expect(sale).toMatchObject({ total: 3700, owed: 0, state: "paid", canOpen: false });
    // A Worker may not open the Paid Bill (§4.1): read it as an Admin.
    const bill = await runTest(getBill(sale!.billId).pipe(as(ana.user)));
    expect(bill).toMatchObject({ total: 3700, paid: 3700, owed: 0, state: "paid" });
    expect(bill.payments).toMatchObject([
      { amount: 3700, method: "cash", by: beto.user.id, byName: "Beto", day: bill.day },
    ]);
    expect(bill.lines).toMatchObject([{ itemId: item.id, quantity: 2, by: beto.user.id }]);

    // The same sale by an Admin may be opened.
    expect((await post(ana, fields)).sale).toMatchObject({ state: "paid", canOpen: true });
  });

  it("Cobrar with less than the total leaves the Bill Pago parcial", async () => {
    const ana = await signedIn("admin", "Ana");
    const item = await runTest(seedItem({ name: "Abonado en Vender", price: 1850, by: ana.user }));

    const { sale } = await post(ana, {
      intent: "cobrar",
      selection: selection([{ itemId: item.id, quantity: 2 }]),
      method: "transfer",
      amount: "10.00",
    });

    expect(sale).toMatchObject({ total: 3700, owed: 2700, state: "partial" });
    const bill = await runTest(getBill(sale!.billId).pipe(as(ana.user)));
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

    expect(requests.map(({ response }) => response.status)).toEqual([400, 400, 400, 400]);
    expect(requests.map(({ error }) => error)).toEqual([
      "El pago debe ser mayor que cero.",
      "El pago no puede ser mayor que el total de la selección.",
      "El monto no es válido. Escríbelo como 18.50.",
      "Elige cómo se pagó.",
    ]);

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

  it("has no form of its own any more: the screen's address takes no POST", async () => {
    const beto = await signedIn("worker", "Beto");

    const response = await beto.fetch("/?index", { method: "POST", body: new URLSearchParams({ intent: "cobrar" }) });

    expect(response.status).toBe(405);
  });
});
