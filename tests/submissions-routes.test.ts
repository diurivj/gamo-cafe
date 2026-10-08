import { describe, expect, it } from "vitest";

import { getBill, listCustomerHandovers, listCustomerOpenBills, listOpenBills, recordSelection } from "~/backend/bills";
import { listCounts } from "~/backend/counts";
import { listRecentAdjustments } from "~/backend/inventory";
import { stockOf } from "~/backend/stock";
import { paymentMessages } from "~/shared/payment-messages";

import { as, landing, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";
import { recordHandover, recordPayment, recordSale, recordStockChange, sendCount } from "./support/sales";

// One submission per form, through the Worker (spec §3.4): the screen makes a
// key at the tap, and the same form sent
// twice — a double tap, a retry after a lost response — records once and is
// answered twice alike. The operations are tested in submissions.test.ts.

const post = (who: SignedIn, path: string, fields: Record<string, string>) =>
  who.fetch(path, { method: "POST", body: new URLSearchParams(fields) });

describe("a used key with changed content", () => {
  it("records the changed sale sent under a used key, not the earlier answer", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ price: 2500, startingStock: 10, by: ana.user }));
    const sale = {
      intent: "dejar-abierta",
      selection: JSON.stringify([{ itemId: cafe.id, quantity: 2 }]),
      note: "primera",
      submissionKey: "llave-usada",
    };

    const first = await recordSale(beto, sale);
    // Vender makes a key per sale, so only a hand-made request does this: the
    // key is used, and what it carries now is another selection.
    const changed = await recordSale(beto, {
      ...sale,
      selection: JSON.stringify([{ itemId: cafe.id, quantity: 3 }]),
      note: "segunda",
    });

    expect(first.sale).toMatchObject({ total: 5000 });
    expect(changed.sale).toMatchObject({ total: 7500 });
    expect(changed.sale!.billId).not.toBe(first.sale!.billId);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(5);
    expect((await runTest(listOpenBills().pipe(as(ana.user)))).bills).toHaveLength(2);

    // The unchanged sale sent twice is still one sale, answered alike.
    const repeat = await recordSale(beto, sale);
    expect(repeat.sale).toEqual(first.sale);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(5);
  });

  it("refuses a changed Cuenta Payment visibly, and answers the unchanged Payment alike", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ price: 2500, by: ana.user }));
    const bill = await runTest(recordSelection({ items: [{ itemId: cafe.id, quantity: 4 }] }).pipe(as(ana.user)));
    // The key is the browser's, made at the tap (`billPaymentSnapshot`).
    const payment = { amount: "30.00", method: "cash", revision: String(bill.revision), submissionKey: "llave-de-cuenta" };

    const first = await recordPayment(ana, bill.id, payment);
    expect(first.payment).toEqual({ amount: 3000, total: 10000, owed: 7000, paid: false, canOpen: true });

    // The same key with another amount: the first Payment moved the Bill, so
    // this is refused visibly, not answered as the first.
    const changed = await recordPayment(ana, bill.id, { ...payment, amount: "20.00" });
    expect(changed.response.status).toBe(400);
    expect(changed.error).toBe(paymentMessages.BillChanged);
    expect((await runTest(getBill(bill.id).pipe(as(ana.user)))).payments).toHaveLength(1);

    const repeat = await recordPayment(ana, bill.id, payment);
    expect(repeat.payment).toEqual(first.payment);
    expect((await runTest(getBill(bill.id).pipe(as(ana.user)))).payments).toHaveLength(1);
  });

  it("refuses a changed Abonar visibly, and answers the unchanged form alike", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ price: 2500, by: ana.user }));
    const lupita = await savedCustomer("Lupita key cambiada", { by: ana.user });
    const bill = await runTest(
      recordSelection({ items: [{ itemId: cafe.id, quantity: 4 }], customerId: lupita.id }).pipe(as(ana.user)),
    );
    // The key is the browser's, made at the tap (`customerPaymentSnapshot`).
    const handover = { amount: "40.00", bills: [`${bill.id}:${bill.revision}`], submissionKey: "llave-de-abono" };

    const first = await recordHandover(ana, lupita.id, handover);
    expect(first.handover).toEqual({ amount: 4000, bills: 1, owed: 6000 });

    // The same key with another amount: the first Abonar moved the Bill, so
    // this is refused visibly, not answered as the first.
    const changed = await recordHandover(ana, lupita.id, { ...handover, amount: "30.00" });
    expect([changed.response.status, changed.error]).toEqual([400, paymentMessages.CustomerBillsChanged]);
    expect(await runTest(listCustomerHandovers(lupita.id).pipe(as(ana.user)))).toHaveLength(1);

    const repeat = await recordHandover(ana, lupita.id, handover);
    expect(repeat.handover).toEqual(first.handover);
    expect(await runTest(listCustomerHandovers(lupita.id).pipe(as(ana.user)))).toHaveLength(1);
  });

  it("records a changed Adjustment sent under a used key, and answers the first content alike", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ by: ana.user }));
    // The key is the browser's, made at the tap (`adjustmentSnapshot`).
    const restock = { intent: "registrar", itemId: cafe.id, reason: "restock", units: "12", submissionKey: "llave-de-ajuste" };

    const first = await recordStockChange(ana, restock);
    const changed = await recordStockChange(ana, { ...restock, units: "5" });

    expect([first.change, changed.change]).toEqual([{ stock: 12 }, { stock: 17 }]);
    const recorded = (await runTest(listRecentAdjustments().pipe(as(ana.user)))).filter(
      (row) => row.itemId === cafe.id,
    );
    expect(recorded.map((row) => row.units).sort((a, b) => a - b)).toEqual([5, 12]);

    // The repeat records nothing; it answers the Stock as it is now.
    const repeat = await recordStockChange(ana, restock);
    expect(repeat.change).toEqual({ stock: 17 });
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(17);
  });

  it("records a changed Count sent under a used key, and answers the first content alike", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ startingStock: 10, by: ana.user }));
    const sent = { note: "", submissionKey: "llave-de-conteo-usada" };

    const first = await sendCount(ana, "registrar", { [cafe.id]: "7" }, sent);
    // Conteo makes a key per Count, so only a hand-made request does this.
    const changed = await sendCount(ana, "registrar", { [cafe.id]: "9" }, sent);

    expect([first.response.status, changed.response.status]).toEqual([200, 200]);
    expect(changed.count!.id).not.toBe(first.count!.id);
    const counts = (await runTest(listCounts().pipe(as(ana.user)))).counts.filter((count) =>
      count.lines.some((line) => line.itemId === cafe.id),
    );
    expect(counts).toHaveLength(2);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(9);

    const repeat = await sendCount(ana, "registrar", { [cafe.id]: "7" }, sent);
    expect(repeat.count).toEqual(first.count);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(9);
  });
});

describe("Vender", () => {
  it("records a Cobrar sent twice once and answers both alike: a retry is safe", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ price: 2500, startingStock: 10, by: ana.user }));
    const sale = {
      intent: "cobrar",
      selection: JSON.stringify([{ itemId: cafe.id, quantity: 2 }]),
      method: "cash",
      amount: "$50.00",
      submissionKey: "venta-repetida",
    };

    const first = await recordSale(beto, sale);
    const second = await recordSale(beto, sale);

    expect(first.response.status).toBe(200);
    expect(first.sale).toMatchObject({ total: 5000, owed: 0, state: "paid" });
    expect([second.response.status, second.sale]).toEqual([200, first.sale]);
    const bill = await runTest(getBill(first.sale!.billId).pipe(as(ana.user)));
    expect(bill).toMatchObject({ total: 5000, paid: 5000, state: "paid" });
    expect(bill.lines).toHaveLength(1);
    expect(bill.payments).toHaveLength(1);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(8);

    // The next sale carries a key of its own: the same Items sell again.
    const next = await recordSale(beto, { ...sale, submissionKey: "venta-siguiente" });
    expect(next.sale!.billId).not.toBe(first.sale!.billId);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(6);
  });

  it("records one of two sales that arrive together with the same key", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ price: 2500, startingStock: 10, by: ana.user }));
    const lupita = await savedCustomer("Lupita de dos toques", { by: ana.user });
    const sale = {
      intent: "dejar-abierta",
      selection: JSON.stringify([{ itemId: cafe.id, quantity: 3 }]),
      customerId: lupita.id,
      submissionKey: "dos-toques",
    };

    const [first, second] = await Promise.all([recordSale(beto, sale), recordSale(beto, sale)]);

    expect(first.sale).toMatchObject({ customerName: "Lupita de dos toques", total: 7500 });
    expect(second.sale).toEqual(first.sale);
    expect(await runTest(listCustomerOpenBills(lupita.id).pipe(as(ana.user)))).toMatchObject([{ total: 7500 }]);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(7);
  });
});

describe("Cuenta", () => {
  it("records a Payment sent twice once and answers both alike", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ price: 2500, by: ana.user }));
    const bill = await runTest(recordSelection({ items: [{ itemId: cafe.id, quantity: 4 }] }).pipe(as(ana.user)));
    const payment = { amount: "30.00", method: "cash", revision: String(bill.revision), submissionKey: "llave-doble" };

    const first = await recordPayment(ana, bill.id, payment);
    const second = await recordPayment(ana, bill.id, payment);

    expect(first.payment).toEqual({ amount: 3000, total: 10000, owed: 7000, paid: false, canOpen: true });
    expect(second.response.status).toBe(200);
    expect(second.payment).toEqual(first.payment);
    const after = await runTest(getBill(bill.id).pipe(as(ana.user)));
    expect(after).toMatchObject({ paid: 3000, owed: 7000 });
    expect(after.payments).toHaveLength(1);

    // The next Payment carries the Bill's new revision and a key of its own.
    const next = await recordPayment(ana, bill.id, { ...payment, revision: String(after.revision), submissionKey: "otra" });
    expect(next.payment).toMatchObject({ amount: 3000, owed: 4000 });
  });

  it("answers a Worker whose full Payment arrives twice alike, and never with a way into the Paid Bill", async () => {
    const beto = await signedIn("worker", "Beto");
    const cafe = await runTest(seedItem({ price: 2500 }));
    const bill = await runTest(recordSelection({ items: [{ itemId: cafe.id, quantity: 1 }] }).pipe(as(beto.user)));
    const payment = { amount: "", method: "transfer", revision: String(bill.revision), submissionKey: "llave-de-beto" };

    const answers = [await recordPayment(beto, bill.id, payment), await recordPayment(beto, bill.id, payment)];

    expect(answers.map(({ response, payment: recorded }) => [response.status, recorded])).toEqual([
      [200, { amount: 2500, total: 2500, owed: 0, paid: true, canOpen: false }],
      [200, { amount: 2500, total: 2500, owed: 0, paid: true, canOpen: false }],
    ]);
  });
});

describe("Abonar", () => {
  it("records an Abonar sent twice once and answers both alike", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ price: 2500, by: ana.user }));
    const lupita = await savedCustomer("Lupita abona dos veces", { by: ana.user });
    const bill = await runTest(
      recordSelection({ items: [{ itemId: cafe.id, quantity: 4 }], customerId: lupita.id }).pipe(as(ana.user)),
    );
    // One snapshot, sent twice: a double tap, or a retry after a lost answer.
    const handover = { amount: "40.00", bills: [`${bill.id}:${bill.revision}`], submissionKey: "llave-de-abono-doble" };

    const answers = [await recordHandover(ana, lupita.id, handover), await recordHandover(ana, lupita.id, handover)];

    expect(answers.map(({ response, handover: recorded }) => [response.status, recorded])).toEqual([
      [200, { amount: 4000, bills: 1, owed: 6000 }],
      [200, { amount: 4000, bills: 1, owed: 6000 }],
    ]);
    expect(await runTest(listCustomerOpenBills(lupita.id).pipe(as(ana.user)))).toMatchObject([{ owed: 6000 }]);
    expect(await runTest(listCustomerHandovers(lupita.id).pipe(as(ana.user)))).toHaveLength(1);
  });
});

describe("Inventario", () => {
  it("records an Adjustment sent twice once, alone or at the same moment", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ by: ana.user }));
    const restock = { intent: "registrar", itemId: cafe.id, reason: "restock", units: "12", submissionKey: "llave-doble" };

    const [first, second] = await Promise.all([recordStockChange(ana, restock), recordStockChange(ana, restock)]);
    const third = await recordStockChange(ana, restock);

    expect([first, second, third].map((sent) => [sent.response.status, sent.change])).toEqual([
      [200, { stock: 12 }],
      [200, { stock: 12 }],
      [200, { stock: 12 }],
    ]);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(12);
    const recorded = await runTest(listRecentAdjustments().pipe(as(ana.user)));
    expect(recorded.filter((row) => row.itemId === cafe.id)).toHaveLength(1);
  });
});

describe("Conteo", () => {
  it("records a Count sent twice once and answers both alike: a retry is safe", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ startingStock: 10, by: ana.user }));
    // The key Conteo made at the tap, sent again after a lost answer.
    const send = () => sendCount(ana, "registrar", { [cafe.id]: "7" }, { note: "", submissionKey: "llave-de-conteo" });

    const first = await send();
    const second = await send();

    expect([first.response.status, second.response.status]).toEqual([200, 200]);
    expect(second.count).toEqual(first.count);
    const counts = (await runTest(listCounts().pipe(as(ana.user)))).counts.filter((count) =>
      count.lines.some((line) => line.itemId === cafe.id),
    );
    expect(counts).toMatchObject([{ lines: [{ expected: 10, found: 7 }] }]);
  });
});
