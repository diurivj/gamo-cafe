import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { editBill, getBill, listOpenBills, recordSelection, takePayment } from "~/backend/bills";
import { retireCustomer } from "~/backend/customers";
import { Db } from "~/backend/db";

import { as, seedUser } from "./support/auth";
import { seedItem } from "./support/catalog";
import { seedCustomer } from "./support/customers";
import { advanceClock, runTest, setClock } from "./support/effect";

// Changing a Bill's Customer or note (spec §5.3, §4.1, §7.2, §7.3.4). Tests in
// one file share a D1, so each names its own Items and Customers.

/** A Bill of `units` of one Item, left Open, with the revision it now holds. */
function openBill(user: Parameters<typeof as>[0], itemId: string, units = 1) {
  return recordSelection({ items: [{ itemId, quantity: units }] }).pipe(as(user));
}

const EditRow = Schema.Struct({
  field: Schema.Literals(["customer", "note"]),
  previousValue: Schema.NullOr(Schema.String),
  newValue: Schema.NullOr(Schema.String),
  editedBy: Schema.String,
  editedAt: Schema.Int,
});

/**
 * The `bill_edits` facts of one Bill, oldest first. No operation reads them
 * yet (Historial, ticket 18), so the test looks at the table directly, as the
 * Payments test does for `handover_reference`.
 */
const editsOf = (billId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.all(
      EditRow,
      `SELECT field, previous_value AS previousValue, new_value AS newValue,
              edited_by AS editedBy, edited_at AS editedAt
       FROM bill_edits WHERE bill_id = ? ORDER BY edited_at, rowid`,
      billId,
    );
  });

describe("editing a Bill's Customer or note", () => {
  it("lets a Worker set both while the Bill has no Payment, recording the previous and new value, who and when", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Editable", price: 1850, by: ana });
        const ruiz = yield* seedCustomer("Familia Ruiz", { by: beto });
        const bill = yield* openBill(beto, item.id, 2);

        yield* advanceClock("7 minutes");
        const result = yield* editBill({
          billId: bill.id,
          customerId: ruiz.id,
          note: "  Paga los viernes  ",
          expectedRevision: bill.revision,
        }).pipe(as(beto));

        expect(result).toEqual({ revision: bill.revision + 1 });
        expect(yield* getBill(bill.id).pipe(as(beto))).toMatchObject({
          customer: { id: ruiz.id, name: "Familia Ruiz" },
          note: "Paga los viernes",
          revision: bill.revision + 1,
        });

        const at = Date.parse("2026-10-05T12:07:00-06:00");
        expect(yield* editsOf(bill.id)).toEqual([
          { field: "customer", previousValue: null, newValue: ruiz.id, editedBy: beto.id, editedAt: at },
          { field: "note", previousValue: null, newValue: "Paga los viernes", editedBy: beto.id, editedAt: at },
        ]);

        // The Bill now appears among that Customer's Open Bills and in what
        // they owe (spec §5.2).
        expect((yield* listOpenBills("familia rui")).bills).toMatchObject([
          { id: bill.id, customer: { id: ruiz.id, name: "Familia Ruiz" }, owed: 3700 },
        ]);
      }),
    ));

  it("refuses a Worker once the Bill has a Payment, and lets an Admin change it", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Con pago", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia Pagada", { by: beto });
        const bill = yield* openBill(beto, item.id, 2);
        // A partial Payment: the Bill stays Open, but its `paid` is no longer 0.
        yield* takePayment({
          billId: bill.id,
          amount: 500,
          method: "cash",
          expectedRevision: bill.revision,
        }).pipe(as(beto));
        const revision = bill.revision + 1;

        const refused = yield* Effect.flip(
          editBill({ billId: bill.id, customerId: ruiz.id, note: "después", expectedRevision: revision }).pipe(
            as(beto),
          ),
        );
        expect(refused._tag).toBe("BillHasPayment");
        expect(yield* editsOf(bill.id)).toEqual([]);
        expect(yield* getBill(bill.id).pipe(as(ana))).toMatchObject({ customer: null, note: null, revision });

        yield* advanceClock("4 minutes");
        const edited = yield* editBill({
          billId: bill.id,
          customerId: ruiz.id,
          note: "Paga el viernes",
          expectedRevision: revision,
        }).pipe(as(ana));

        expect(edited).toEqual({ revision: revision + 1 });
        expect(yield* getBill(bill.id).pipe(as(ana))).toMatchObject({
          customer: { id: ruiz.id, name: "Familia Pagada" },
          note: "Paga el viernes",
        });
        expect(yield* editsOf(bill.id)).toMatchObject([
          { field: "customer", previousValue: null, newValue: ruiz.id, editedBy: ana.id },
          { field: "note", previousValue: null, newValue: "Paga el viernes", editedBy: ana.id },
        ]);
      }),
    ));

  it("refuses a note longer than 80 characters and writes nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Nota larga", price: 1000, by: ana });
        const bill = yield* openBill(beto, item.id);

        const refused = yield* Effect.flip(
          editBill({ billId: bill.id, customerId: null, note: "x".repeat(81), expectedRevision: bill.revision }).pipe(as(beto)),
        );
        expect(refused._tag).toBe("NoteTooLong");
        expect(yield* editsOf(bill.id)).toEqual([]);
        expect(yield* getBill(bill.id).pipe(as(beto))).toMatchObject({ note: null, revision: bill.revision });

        // Exactly the limit is allowed.
        yield* editBill({ billId: bill.id, customerId: null, note: "y".repeat(80), expectedRevision: bill.revision }).pipe(as(beto));
        expect(yield* getBill(bill.id).pipe(as(beto))).toMatchObject({
          note: "y".repeat(80),
          revision: bill.revision + 1,
        });
      }),
    ));

  it("writes nothing and says the Bill changed when the submission is stale", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Obsoleta", price: 1000, by: ana });
        const bill = yield* openBill(beto, item.id);

        const refused = yield* Effect.flip(
          editBill({ billId: bill.id, customerId: null, note: "vieja", expectedRevision: bill.revision + 1 }).pipe(as(beto)),
        );
        expect(refused._tag).toBe("BillChanged");
        expect(yield* editsOf(bill.id)).toEqual([]);
        expect(yield* getBill(bill.id).pipe(as(beto))).toMatchObject({ note: null, revision: bill.revision });

        // Two phones editing from the same revision: the first is written, the
        // second is stale and changes nothing (spec §7.3, Concurrency).
        yield* editBill({ billId: bill.id, customerId: null, note: "primera", expectedRevision: bill.revision }).pipe(as(beto));
        const second = yield* Effect.flip(
          editBill({ billId: bill.id, customerId: null, note: "segunda", expectedRevision: bill.revision }).pipe(as(ana)),
        );
        expect(second._tag).toBe("BillChanged");
        expect(yield* editsOf(bill.id)).toMatchObject([{ field: "note", newValue: "primera", editedBy: beto.id }]);
      }),
    ));

  it("refuses a retired Customer, and still lets the note of a Bill already linked to them change", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Retirado", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia Retirada", { by: beto });
        const bill = yield* openBill(beto, item.id);

        // A retired Customer is never offered by the picker, and refused here
        // too (spec §5.2); the picker hiding them is not enforcement.
        const gone = yield* seedCustomer("Don Paco", { by: beto, retired: true });
        const refused = yield* Effect.flip(
          editBill({ billId: bill.id, customerId: gone.id, note: null, expectedRevision: bill.revision }).pipe(
            as(beto),
          ),
        );
        expect(refused._tag).toBe("CustomerUnavailable");
        expect(yield* editsOf(bill.id)).toEqual([]);

        // Linking an active Customer works. Retiring them later does not block
        // a note-only change: the Customer is not being chosen anew, and the
        // Bill stays collectable (spec §5.2).
        yield* editBill({ billId: bill.id, customerId: ruiz.id, note: null, expectedRevision: bill.revision }).pipe(
          as(beto),
        );
        const linked = bill.revision + 1;
        yield* retireCustomer(ruiz.id).pipe(as(ana));

        const edited = yield* editBill({
          billId: bill.id,
          customerId: ruiz.id,
          note: "Nota nueva",
          expectedRevision: linked,
        }).pipe(as(beto));
        expect(edited).toEqual({ revision: linked + 1 });
        expect(yield* getBill(bill.id).pipe(as(ana))).toMatchObject({
          customer: { id: ruiz.id, name: "Familia Retirada" },
          note: "Nota nueva",
        });
      }),
    ));

  it("clears the Customer and the note, and a submission that changes nothing writes no fact", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Quitar", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia Quitar", { by: beto });
        const bill = yield* openBill(beto, item.id);
        yield* editBill({ billId: bill.id, customerId: ruiz.id, note: "con nota", expectedRevision: bill.revision }).pipe(
          as(beto),
        );
        const revision = bill.revision + 1;

        // The same values again: nothing changed, so no fact and no revision
        // bump; each change is a History entry, no change is none (spec §5.3).
        const again = yield* editBill({
          billId: bill.id,
          customerId: ruiz.id,
          note: "con nota",
          expectedRevision: revision,
        }).pipe(as(beto));
        expect(again).toEqual({ revision });
        expect(yield* editsOf(bill.id)).toHaveLength(2);

        // Quitar on the picker and emptying the note clear both.
        const cleared = yield* editBill({ billId: bill.id, customerId: null, note: "", expectedRevision: revision }).pipe(
          as(beto),
        );
        expect(cleared).toEqual({ revision: revision + 1 });
        expect(yield* getBill(bill.id).pipe(as(beto))).toMatchObject({ customer: null, note: null });
        expect(yield* editsOf(bill.id)).toMatchObject([
          { field: "customer" },
          { field: "note" },
          { field: "customer", previousValue: ruiz.id, newValue: null },
          { field: "note", previousValue: "con nota", newValue: null },
        ]);
      }),
    ));

  it("refuses an unknown Bill and a Voided one", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Cancelada", price: 1000, by: ana });
        const bill = yield* openBill(beto, item.id);

        const missing = yield* Effect.flip(
          editBill({ billId: "nadie", customerId: null, note: "hola", expectedRevision: 0 }).pipe(as(beto)),
        );
        expect(missing._tag).toBe("BillNotFound");

        // A Voided Bill accepts no further corrections (ticket 11); there is no
        // void operation yet, so the projection is written directly.
        yield* db.run("UPDATE bills SET state = 'voided' WHERE id = ?", bill.id);
        const voided = yield* Effect.flip(
          editBill({ billId: bill.id, customerId: null, note: "tarde", expectedRevision: bill.revision }).pipe(as(ana)),
        );
        expect(voided._tag).toBe("BillIsVoided");
        expect(yield* editsOf(bill.id)).toEqual([]);
      }),
    ));
});
