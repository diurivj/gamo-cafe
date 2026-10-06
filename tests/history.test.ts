import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, editBill, recordSelection, takePayment } from "~/backend/bills";
import { removeLine, removePayment, voidBill } from "~/backend/corrections";
import { listHistory } from "~/backend/history";
import { cancelAdjustment, recordAdjustment } from "~/backend/inventory";
import { stockOf } from "~/backend/stock";

import { as, seedUser } from "./support/auth";
import { seedItem } from "./support/catalog";
import { seedCustomer } from "./support/customers";
import { advanceClock, runTest, setClock } from "./support/effect";

// Historial (spec §5.7, §6.2, §7.4, §10.4, §2.4): every correction and
// Adjustment, newest first, with who, when and why. The records the entries
// correct stay on file. Tests in one file share a D1 and active Item names are
// unique, so each test names its own.

describe("a removed Line", () => {
  it("is shown with who removed it, when and why, and the Line still exists", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T09:00:00");
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Historial línea", price: 1850, by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 2 }] }).pipe(as(beto));
        const before = yield* getBill(bill.id).pipe(as(ana));
        const lineId = before.lines[0]!.id;

        yield* advanceClock("5 minutes");
        yield* removeLine({
          billId: bill.id,
          lineId,
          reason: "Se pidió por error",
          expectedRevision: before.revision,
        }).pipe(as(ana));

        const page = yield* listHistory(null).pipe(as(ana));
        expect(page.next).toBeNull();
        expect(page.entries.filter((entry) => "billId" in entry && entry.billId === bill.id)).toMatchObject([
          {
            kind: "line_removal",
            at: Date.parse("2026-10-05T09:05:00-06:00"),
            byName: "Ana",
            reason: "Se pidió por error",
            billId: bill.id,
            itemId: item.id,
            itemName: "Historial línea",
            quantity: 2,
            amount: 3700,
          },
        ]);

        // The original record is untouched (spec §2.1): it is the same Line.
        const after = yield* getBill(bill.id).pipe(as(ana));
        expect(after.lines).toHaveLength(1);
        expect(after.lines[0]).toMatchObject({ id: lineId, quantity: 2, unitPrice: 1850 });
      }),
    ));
});

describe("a removed Payment and a Voided Bill", () => {
  it("are shown with who, when and why, newest first, and both records still exist", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T11:00:00");
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Historial pago", price: 1000, by: ana });
        const selection = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 2 }],
          note: "Se lo llevó Sofía",
        }).pipe(as(beto));
        const withPayment = yield* getBill(selection.id).pipe(as(ana));
        const payment = yield* takePayment({
          billId: selection.id,
          amount: 500,
          method: "cash",
          expectedRevision: withPayment.revision,
        }).pipe(as(beto));
        const paid = yield* getBill(selection.id).pipe(as(ana));

        yield* advanceClock("5 minutes");
        yield* removePayment({
          billId: selection.id,
          paymentId: payment.id,
          reason: "Se cobró por error",
          expectedRevision: paid.revision,
        }).pipe(as(ana));

        yield* advanceClock("5 minutes");
        const reopened = yield* getBill(selection.id).pipe(as(ana));
        yield* voidBill({
          billId: selection.id,
          reason: "La cuenta era de prueba",
          expectedRevision: reopened.revision,
        }).pipe(as(ana));

        const page = yield* listHistory(null).pipe(as(ana));
        expect(page.entries.filter((entry) => "billId" in entry && entry.billId === selection.id)).toMatchObject([
          {
            kind: "bill_void",
            at: Date.parse("2026-10-05T11:10:00-06:00"),
            byName: "Ana",
            reason: "La cuenta era de prueba",
            billId: selection.id,
            billLabel: "Se lo llevó Sofía",
            total: 2000,
          },
          {
            kind: "payment_removal",
            at: Date.parse("2026-10-05T11:05:00-06:00"),
            byName: "Ana",
            reason: "Se cobró por error",
            billId: selection.id,
            billLabel: "Se lo llevó Sofía",
            amount: 500,
            method: "cash",
          },
        ]);

        // The Bill is Voided and its Payment is on record, marked removed.
        const after = yield* getBill(selection.id).pipe(as(ana));
        expect(after.state).toBe("voided");
        expect(after.payments).toMatchObject([{ id: payment.id, amount: 500, removal: { by: ana.id } }]);
        expect(after.voided).toMatchObject({ by: ana.id, byName: "Ana", reason: "La cuenta era de prueba" });
      }),
    ));
});

describe("a change to a Bill's Customer or note", () => {
  it("is shown from what to what, with its author and time, and only what changed is recorded", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T13:00:00");
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Historial edición", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia del historial", { by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(beto));
        const opened = yield* getBill(bill.id).pipe(as(beto));

        yield* advanceClock("5 minutes");
        yield* editBill({
          billId: bill.id,
          customerId: ruiz.id,
          note: "Lo recogió Sofía",
          expectedRevision: opened.revision,
        }).pipe(as(beto));
        const edited = yield* getBill(bill.id).pipe(as(beto));

        // The same values again change nothing, so they are no History entry.
        yield* editBill({
          billId: bill.id,
          customerId: ruiz.id,
          note: "Lo recogió Sofía",
          expectedRevision: edited.revision,
        }).pipe(as(beto));

        yield* advanceClock("5 minutes");
        yield* editBill({
          billId: bill.id,
          customerId: null,
          note: null,
          expectedRevision: edited.revision,
        }).pipe(as(ana));

        const page = yield* listHistory(null).pipe(as(ana));
        const entries = page.entries.filter((entry) => "billId" in entry && entry.billId === bill.id);
        expect(entries).toHaveLength(4);
        const cleared = Date.parse("2026-10-05T13:10:00-06:00");
        const assigned = Date.parse("2026-10-05T13:05:00-06:00");
        expect(entries.slice(0, 2)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "bill_edit",
              at: cleared,
              byName: "Ana",
              field: "customer",
              previous: "Familia del historial",
              next: null,
            }),
            expect.objectContaining({
              kind: "bill_edit",
              at: cleared,
              byName: "Ana",
              field: "note",
              previous: "Lo recogió Sofía",
              next: null,
            }),
          ]),
        );
        expect(entries.slice(2)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "bill_edit",
              at: assigned,
              byName: "Beto",
              field: "customer",
              previous: null,
              next: "Familia del historial",
            }),
            expect.objectContaining({
              kind: "bill_edit",
              at: assigned,
              byName: "Beto",
              field: "note",
              previous: null,
              next: "Lo recogió Sofía",
            }),
          ]),
        );
      }),
    ));
});

describe("an Adjustment and its cancellation", () => {
  it("are each shown with who, when and why, and the Adjustment stays cancelled once", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T15:00:00");
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Historial ajuste", price: 1000, by: ana });

        const adjustment = yield* recordAdjustment({
          itemId: item.id,
          reason: "restock",
          units: 12,
          note: "Compra semanal",
        }).pipe(as(ana));
        yield* advanceClock("5 minutes");
        yield* cancelAdjustment(adjustment.id, "Se contó dos veces").pipe(as(ana));

        const page = yield* listHistory(null).pipe(as(ana));
        const entries = page.entries.filter((entry) => "itemId" in entry && entry.itemId === item.id);
        expect(entries).toMatchObject([
          {
            kind: "adjustment_cancellation",
            at: Date.parse("2026-10-05T15:05:00-06:00"),
            byName: "Ana",
            reason: "Se contó dos veces",
            adjustmentId: adjustment.id,
            adjustmentReason: "restock",
            units: 12,
            itemId: item.id,
            itemName: "Historial ajuste",
          },
          {
            kind: "adjustment",
            at: Date.parse("2026-10-05T15:00:00-06:00"),
            byName: "Ana",
            reason: "restock",
            units: 12,
            note: "Compra semanal",
            itemId: item.id,
            itemName: "Historial ajuste",
          },
        ]);

        // The Adjustment and its cancellation stay on file, and Stock moved
        // by exactly the two amounts (spec §5.8, §10.5).
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(0);
      }),
    ));
});

describe("a Worker", () => {
  it("never sees History (spec §4.2)", () =>
    runTest(
      Effect.gen(function* () {
        const beto = yield* seedUser("worker", "Beto");

        const error = yield* Effect.flip(listHistory(null).pipe(as(beto)));

        expect(error._tag).toBe("AdminOnly");
      }),
    ));
});
