import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  getBill,
  listCustomerHandovers,
  listCustomerOpenBills,
  recordSelection,
  takeCustomerPayment,
  takePayment,
} from "~/backend/bills";
import { retireItem } from "~/backend/catalog";
import { listCounts, recordCount } from "~/backend/counts";
import { listRecentAdjustments, recordAdjustment } from "~/backend/inventory";
import { stockOf } from "~/backend/stock";
import { newId } from "~/shared/id";

import { as, seedUser } from "./support/auth";
import { seedItem } from "./support/catalog";
import { seedCustomer } from "./support/customers";
import { advanceClock, runTest, setClock } from "./support/effect";

// One submission per rendered form (spec §3.4): a form that creates a Bill, a
// Payment, an Adjustment or a Count carries a key, and the operation records
// one submission per key. The routes are tested in submissions-routes.test.ts.

describe("recordSelection with a submission key", () => {
  it("records a sale sent twice once, and answers the second as the first", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const cafe = yield* seedItem({ price: 2500, startingStock: 10, by: ana });
        const lupita = yield* seedCustomer("Lupita Doble", { by: ana });
        const sale = {
          items: [{ itemId: cafe.id, quantity: 2 }],
          customerId: lupita.id,
          payment: { method: "cash" as const, amount: 2000 },
          submissionKey: newId(),
        };

        const first = yield* recordSelection(sale).pipe(as(ana));
        const second = yield* recordSelection(sale).pipe(as(ana));

        expect(second).toEqual(first);
        expect(yield* listCustomerOpenBills(lupita.id).pipe(as(ana))).toMatchObject([
          { id: first.id, total: 5000, owed: 3000 },
        ]);
        const bill = yield* getBill(first.id).pipe(as(ana));
        expect(bill.lines).toHaveLength(1);
        expect(bill.payments).toHaveLength(1);
        expect(yield* stockOf(cafe.id).pipe(as(ana))).toBe(8);
      }),
    ));

  it("records one of two sales sent at the same moment with the same key", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const cafe = yield* seedItem({ price: 2500, startingStock: 10, by: ana });
        const sale = {
          items: [{ itemId: cafe.id, quantity: 3 }],
          payment: { method: "cash" as const },
          submissionKey: newId(),
        };

        const [first, second] = yield* Effect.all(
          [recordSelection(sale).pipe(as(ana)), recordSelection(sale).pipe(as(ana))],
          { concurrency: "unbounded" },
        );

        expect(second).toEqual(first);
        expect(first).toMatchObject({ total: 7500, paid: 7500, state: "paid" });
        const bill = yield* getBill(first.id).pipe(as(ana));
        expect(bill.lines).toHaveLength(1);
        expect(bill.payments).toHaveLength(1);
        expect(yield* stockOf(cafe.id).pipe(as(ana))).toBe(7);
      }),
    ));

  it("records the same Items again under a new key, and another User's under the same one", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const cafe = yield* seedItem({ price: 2500, startingStock: 10, by: ana });
        const items = [{ itemId: cafe.id, quantity: 1 }];
        const key = newId();

        const first = yield* recordSelection({ items, submissionKey: key }).pipe(as(ana));
        const next = yield* recordSelection({ items, submissionKey: newId() }).pipe(as(ana));
        const betos = yield* recordSelection({ items, submissionKey: key }).pipe(as(beto));

        expect(new Set([first.id, next.id, betos.id]).size).toBe(3);
        expect(yield* stockOf(cafe.id).pipe(as(ana))).toBe(7);
      }),
    ));

  it("leaves the key free when the selection was refused", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const cafe = yield* seedItem({ price: 2500, startingStock: 10, by: ana });
        const gone = yield* seedItem({ by: ana });
        yield* retireItem(gone.id).pipe(as(ana));
        const key = newId();

        const refused = yield* Effect.flip(
          recordSelection({
            items: [{ itemId: cafe.id, quantity: 1 }, { itemId: gone.id, quantity: 1 }],
            submissionKey: key,
          }).pipe(as(ana)),
        );
        expect(refused._tag).toBe("ItemUnavailable");

        // The same form, sent again without the retired Item.
        const recorded = yield* recordSelection({
          items: [{ itemId: cafe.id, quantity: 1 }],
          submissionKey: key,
        }).pipe(as(ana));
        expect(recorded.total).toBe(2500);
        expect(yield* stockOf(cafe.id).pipe(as(ana))).toBe(9);
      }),
    ));
});

describe("takePayment with a submission key", () => {
  it("records a Payment sent twice once, and answers the second as the first", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const cafe = yield* seedItem({ price: 2500, by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: cafe.id, quantity: 4 }] }).pipe(as(ana));
        // The page was rendered once: both submissions carry its revision.
        const payment = {
          billId: bill.id,
          amount: 3000,
          method: "cash" as const,
          expectedRevision: bill.revision,
          submissionKey: newId(),
        };

        const first = yield* takePayment(payment).pipe(as(ana));
        const second = yield* takePayment(payment).pipe(as(ana));

        expect(first).toMatchObject({ amount: 3000, paid: false, total: 10000, owed: 7000 });
        expect(second).toEqual(first);
        const after = yield* getBill(bill.id).pipe(as(ana));
        expect(after).toMatchObject({ paid: 3000, owed: 7000, revision: bill.revision + 1 });
        expect(after.payments).toHaveLength(1);
      }),
    ));

  it("records one of two Payments sent at the same moment with the same key, and refuses neither", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const cafe = yield* seedItem({ price: 2500, by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: cafe.id, quantity: 2 }] }).pipe(as(ana));
        const payment = {
          billId: bill.id,
          method: "transfer" as const,
          expectedRevision: bill.revision,
          submissionKey: newId(),
        };

        const [first, second] = yield* Effect.all(
          [takePayment(payment).pipe(as(ana)), takePayment(payment).pipe(as(ana))],
          { concurrency: "unbounded" },
        );

        expect(first).toMatchObject({ amount: 5000, paid: true, owed: 0 });
        expect(second).toEqual(first);
        expect((yield* getBill(bill.id).pipe(as(ana))).payments).toHaveLength(1);
      }),
    ));
});

describe("takeCustomerPayment with a submission key", () => {
  it("records an Abonar sent twice once, alone or at the same moment, and answers both alike", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const cafe = yield* seedItem({ price: 2500, by: ana });
        const lupita = yield* seedCustomer("Lupita Abona Doble", { by: ana });
        // Two Open Bills, one per Day.
        yield* setClock("2026-10-05T10:00:00");
        yield* recordSelection({ items: [{ itemId: cafe.id, quantity: 2 }], customerId: lupita.id }).pipe(as(ana));
        yield* advanceClock("1 day");
        yield* recordSelection({ items: [{ itemId: cafe.id, quantity: 2 }], customerId: lupita.id }).pipe(as(ana));
        const shown = yield* listCustomerOpenBills(lupita.id).pipe(as(ana));
        const handover = {
          customerId: lupita.id,
          amount: 6000,
          method: "cash" as const,
          expectedRevisions: shown.map((bill) => ({ billId: bill.id, revision: bill.revision })),
          submissionKey: newId(),
        };

        const [first, second] = yield* Effect.all(
          [takeCustomerPayment(handover).pipe(as(ana)), takeCustomerPayment(handover).pipe(as(ana))],
          { concurrency: "unbounded" },
        );
        const third = yield* takeCustomerPayment(handover).pipe(as(ana));

        expect(first.shares.map((share) => share.amount)).toEqual([5000, 1000]);
        expect(second).toEqual(first);
        expect(third).toEqual(first);
        expect(yield* listCustomerOpenBills(lupita.id).pipe(as(ana))).toMatchObject([{ owed: 4000 }]);
        expect(yield* listCustomerHandovers(lupita.id).pipe(as(ana))).toMatchObject([
          { reference: first.reference, amount: 6000, billCount: 2 },
        ]);
      }),
    ));
});

describe("recordAdjustment with a submission key", () => {
  it("records an Adjustment sent twice once, alone or at the same moment", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const cafe = yield* seedItem({ by: ana });
        const restock = { itemId: cafe.id, reason: "restock" as const, units: 12, submissionKey: newId() };

        const [first, second] = yield* Effect.all(
          [recordAdjustment(restock).pipe(as(ana)), recordAdjustment(restock).pipe(as(ana))],
          { concurrency: "unbounded" },
        );
        const third = yield* recordAdjustment(restock).pipe(as(ana));

        expect(second).toEqual(first);
        expect(third).toEqual(first);
        expect(yield* stockOf(cafe.id).pipe(as(ana))).toBe(12);
        const recorded = (yield* listRecentAdjustments().pipe(as(ana))).filter((row) => row.itemId === cafe.id);
        expect(recorded.map((row) => row.id)).toEqual([first.id]);

        // The form the page renders next carries a new key.
        yield* recordAdjustment({ ...restock, submissionKey: newId() }).pipe(as(ana));
        expect(yield* stockOf(cafe.id).pipe(as(ana))).toBe(24);
      }),
    ));
});

describe("recordCount with a submission key", () => {
  it("records a Count sent twice once, alone or at the same moment", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const cafe = yield* seedItem({ startingStock: 10, by: ana });
        const count = { lines: [{ itemId: cafe.id, found: 7 }], note: "Cierre", submissionKey: newId() };

        const [first, second] = yield* Effect.all(
          [recordCount(count).pipe(as(ana)), recordCount(count).pipe(as(ana))],
          { concurrency: "unbounded" },
        );
        const third = yield* recordCount(count).pipe(as(ana));

        expect(second).toEqual(first);
        expect(third).toEqual(first);
        // A second Count would have expected the 7 units the first one left.
        const counts = (yield* listCounts().pipe(as(ana))).filter((recorded) =>
          recorded.lines.some((line) => line.itemId === cafe.id),
        );
        expect(counts).toMatchObject([{ id: first.id, lines: [{ expected: 10, found: 7, difference: -3 }] }]);
        expect(yield* stockOf(cafe.id).pipe(as(ana))).toBe(7);
      }),
    ));
});
