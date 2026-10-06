import { describe, expect, it } from "vitest";

import { getBill, listCustomerHandovers, listCustomerOpenBills, recordSelection } from "~/backend/bills";
import { listCounts } from "~/backend/counts";
import { listRecentAdjustments } from "~/backend/inventory";
import { stockOf } from "~/backend/stock";

import { as, landing, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";

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

const billIdIn = (html: string) => /data-bill-id="([^"]+)"/.exec(html)![1]!;

describe("Vender", () => {
  it("records a Cobrar sent twice once, answers both alike, and gives the next form a new key", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ price: 2500, startingStock: 10, by: ana.user }));
    const key = keyIn(await (await beto.fetch("/")).text());
    const sale = {
      intent: "cobrar",
      selection: JSON.stringify([{ itemId: cafe.id, quantity: 2 }]),
      method: "cash",
      amount: "",
      submissionKey: key,
    };

    const first = await answer(beto, await post(beto, "/?index", sale));
    const second = await answer(beto, await post(beto, "/?index", sale));

    expect(first.location).toBe("/");
    expect(first.message).toBe("Cuenta pagada: $50.00.");
    expect([second.location, second.message]).toEqual([first.location, first.message]);
    expect(billIdIn(second.html)).toBe(billIdIn(first.html));
    const bill = await runTest(getBill(billIdIn(first.html)).pipe(as(ana.user)));
    expect(bill).toMatchObject({ total: 5000, paid: 5000, state: "paid" });
    expect(bill.lines).toHaveLength(1);
    expect(bill.payments).toHaveLength(1);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(8);

    // The page the sale lands on renders a new form: the same Items sell again.
    const nextKey = keyIn(first.html);
    expect(nextKey).not.toBe(key);
    const next = await answer(beto, await post(beto, "/?index", { ...sale, submissionKey: nextKey }));
    expect(billIdIn(next.html)).not.toBe(billIdIn(first.html));
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
      submissionKey: keyIn(await (await beto.fetch("/")).text()),
    };

    const responses = await Promise.all([post(beto, "/?index", sale), post(beto, "/?index", sale)]);
    const [first, second] = await Promise.all(responses.map((response) => answer(beto, response)));

    expect(first!.message).toBe("Se dejó abierta la cuenta de Lupita de dos toques por $75.00.");
    expect(second!.message).toBe(first!.message);
    expect(await runTest(listCustomerOpenBills(lupita.id).pipe(as(ana.user)))).toMatchObject([{ total: 7500 }]);
    expect(await runTest(stockOf(cafe.id).pipe(as(ana.user)))).toBe(7);
  });
});

describe("Cuenta", () => {
  it("records a Payment sent twice once and answers both alike", async () => {
    const ana = await signedIn("admin", "Ana");
    const cafe = await runTest(seedItem({ price: 2500, by: ana.user }));
    const bill = await runTest(recordSelection({ items: [{ itemId: cafe.id, quantity: 4 }] }).pipe(as(ana.user)));
    const path = `/cuentas/${bill.id}`;
    const payment = {
      intent: "pagar",
      amount: "30.00",
      method: "cash",
      revision: String(bill.revision),
      submissionKey: keyIn(await (await ana.fetch(path)).text()),
    };

    const first = await answer(ana, await post(ana, path, payment));
    const second = await answer(ana, await post(ana, path, payment));

    expect(first.message).toBe("Abono de $30.00 registrado. Debe $70.00.");
    expect([second.location, second.message]).toEqual([first.location, first.message]);
    const after = await runTest(getBill(bill.id).pipe(as(ana.user)));
    expect(after).toMatchObject({ paid: 3000, owed: 7000 });
    expect(after.payments).toHaveLength(1);

    // The page renders the next form with a new key and the new revision.
    expect(keyIn(first.html)).not.toBe(payment.submissionKey);
  });

  it("sends a Worker whose full Payment arrives twice to Cuentas abiertas both times", async () => {
    const beto = await signedIn("worker", "Beto");
    const cafe = await runTest(seedItem({ price: 2500 }));
    const bill = await runTest(recordSelection({ items: [{ itemId: cafe.id, quantity: 1 }] }).pipe(as(beto.user)));
    const path = `/cuentas/${bill.id}`;
    const payment = {
      intent: "pagar",
      amount: "",
      method: "transfer",
      revision: String(bill.revision),
      submissionKey: keyIn(await (await beto.fetch(path)).text()),
    };

    const responses = [await post(beto, path, payment), await post(beto, path, payment)];

    expect(responses.map((response) => [response.status, response.headers.get("Location")])).toEqual([
      [302, "/cuentas-abiertas"],
      [302, "/cuentas-abiertas"],
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
