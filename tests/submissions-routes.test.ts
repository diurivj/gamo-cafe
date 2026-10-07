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
import { recordPayment, recordSale } from "./support/sales";

// One submission per rendered form, through the Worker (spec §3.4): each page
// renders its form with a key, and the same form sent twice — a double tap, a
// retry after a lost response — records once and is answered twice alike. The
// operations are tested in submissions.test.ts.

/** The key the page rendered its form with. */
const keyIn = (html: string) => {
  const key = /name="submissionKey" value="([^"]+)"/.exec(html)?.[1];
  expect(key, "the form carries a submission key").toBeTruthy();
  return key!;
};

const post = (who: SignedIn, path: string, fields: Record<string, string>) =>
  who.fetch(path, { method: "POST", body: new URLSearchParams(fields) });

/** Where a recorded form redirected, and what the page it lands on says. */
async function answer(who: SignedIn, response: Response) {
  const location = response.headers.get("Location");
  const html = await (await landing(who, response)).text();
  return { location, message: /role="status"[^>]*>([^<]*)</.exec(html)?.[1], html };
}


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
    const path = `/clientes/${lupita.id}`;
    const handover = {
      intent: "abonar",
      method: "cash",
      amount: "40.00",
      bill: `${bill.id}:${bill.revision}`,
      submissionKey: keyIn(await (await ana.fetch(path)).text()),
    };

    const first = await answer(ana, await post(ana, path, handover));
    expect(first.message).toBe("Abono de $40.00 registrado.");

    const changed = await post(ana, path, { ...handover, amount: "30.00" });
    expect(changed.status).toBe(400);
    expect(await changed.text()).toContain("Las cuentas del cliente cambiaron");
    expect(await runTest(listCustomerHandovers(lupita.id).pipe(as(ana.user)))).toHaveLength(1);

    const repeat = await answer(ana, await post(ana, path, handover));
    expect(repeat.message).toBe(first.message);
    expect(await runTest(listCustomerHandovers(lupita.id).pipe(as(ana.user)))).toHaveLength(1);
  });

  it("records a changed Adjustment sent under a used key, and answers the first content alike", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ by: ana.user }));
    const restock = {
      intent: "record-adjustment",
      itemId: cafe.id,
      reason: "restock",
      units: "12",
      submissionKey: keyIn(await (await ana.fetch("/inventario")).text()),
    };

    const first = await post(ana, "/inventario", restock);
    const changed = await post(ana, "/inventario", { ...restock, units: "5" });

    expect([first.status, changed.status]).toEqual([302, 302]);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(17);
    const recorded = (await runTest(listRecentAdjustments().pipe(as(ana.user)))).filter(
      (row) => row.itemId === cafe.id,
    );
    expect(recorded.map((row) => row.units).sort((a, b) => a - b)).toEqual([5, 12]);

    const repeat = await post(ana, "/inventario", restock);
    expect(repeat.status).toBe(302);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(17);
  });

  it("records a changed Count sent under a used key, and answers the first content alike", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ startingStock: 10, by: ana.user }));
    const counted = { [`units.${cafe.id}`]: "7", note: "" };
    // The review step renders the form that confirms, with its key.
    const review = await post(ana, "/inventario/conteo", { intent: "review", ...counted });
    const confirm = { intent: "confirm", ...counted, submissionKey: keyIn(await review.text()) };

    const first = await post(ana, "/inventario/conteo", confirm);
    const changed = await post(ana, "/inventario/conteo", {
      ...confirm,
      [`units.${cafe.id}`]: "9",
    });

    expect([first.status, changed.status]).toEqual([302, 302]);
    const counts = (await runTest(listCounts().pipe(as(ana.user)))).counts.filter((count) =>
      count.lines.some((line) => line.itemId === cafe.id),
    );
    expect(counts).toHaveLength(2);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(9);

    const repeat = await post(ana, "/inventario/conteo", confirm);
    expect(repeat.status).toBe(302);
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
    const path = `/clientes/${lupita.id}`;
    const handover = {
      intent: "abonar",
      method: "cash",
      amount: "40.00",
      bill: `${bill.id}:${bill.revision}`,
      submissionKey: keyIn(await (await ana.fetch(path)).text()),
    };

    const first = await answer(ana, await post(ana, path, handover));
    const second = await answer(ana, await post(ana, path, handover));

    expect(first.message).toContain("$40.00");
    expect([second.location, second.message]).toEqual([first.location, first.message]);
    expect(await runTest(listCustomerOpenBills(lupita.id).pipe(as(ana.user)))).toMatchObject([{ owed: 6000 }]);
    expect(await runTest(listCustomerHandovers(lupita.id).pipe(as(ana.user)))).toHaveLength(1);
    expect(keyIn(first.html)).not.toBe(handover.submissionKey);
  });
});

describe("Inventario", () => {
  it("records an Adjustment sent twice once", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ by: ana.user }));
    const restock = {
      intent: "record-adjustment",
      itemId: cafe.id,
      reason: "restock",
      units: "12",
      submissionKey: keyIn(await (await ana.fetch("/inventario")).text()),
    };

    const first = await post(ana, "/inventario", restock);
    const second = await post(ana, "/inventario", restock);

    expect([first.status, second.status]).toEqual([302, 302]);
    expect(second.headers.get("Location")).toBe(first.headers.get("Location"));
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(12);
    const recorded = await runTest(listRecentAdjustments().pipe(as(ana.user)));
    expect(recorded.filter((row) => row.itemId === cafe.id)).toHaveLength(1);
    expect(keyIn(await (await landing(ana, first)).text())).not.toBe(restock.submissionKey);
  });
});

describe("Conteo", () => {
  it("records a confirmed Count sent twice once", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ startingStock: 10, by: ana.user }));
    const counted = { [`units.${cafe.id}`]: "7", note: "" };
    // The review step renders the form that confirms, with its key.
    const review = await post(ana, "/inventario/conteo", { intent: "review", ...counted });
    const confirm = { intent: "confirm", ...counted, submissionKey: keyIn(await review.text()) };

    const first = await post(ana, "/inventario/conteo", confirm);
    const second = await post(ana, "/inventario/conteo", confirm);

    expect([first.status, second.status]).toEqual([302, 302]);
    expect(second.headers.get("Location")).toBe(first.headers.get("Location"));
    const counts = (await runTest(listCounts().pipe(as(ana.user)))).counts.filter((count) =>
      count.lines.some((line) => line.itemId === cafe.id),
    );
    expect(counts).toMatchObject([{ lines: [{ expected: 10, found: 7 }] }]);
  });
});
