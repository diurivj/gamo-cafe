import { Cause, Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, listOpenBills, recordSelection, takePayment } from "~/backend/bills";
import { updateItem } from "~/backend/catalog";
import { recordedCorrection, removeLine, removePayment, voidBill } from "~/backend/corrections";
import { Db } from "~/backend/db";
import { stockOf } from "~/backend/stock";

import { as, seedUser } from "./support/auth";
import { seedItem } from "./support/catalog";
import { seedCustomer } from "./support/customers";
import { advanceClock, runTest, setClock } from "./support/effect";

// Corrections (spec §2.1, §5.7, §5.8, §7.3.3, §10.4, ADR 0002). A correction
// is a fact of its own; the Line or Payment it corrects is never touched, and
// the Bill's projections and Stock move in the same batch, conditionally on
// the Bill's revision. Tests in one file share a D1, and active Item names are
// unique, so each test names its own.

const Counting = Schema.Struct({ count: Schema.Int });

/** How many removals a Line, a Payment or a Bill has, scoped to this test. */
const countIn = Effect.fnUntraced(function* (table: string, column: string, value: string) {
  const db = yield* Db;
  const row = yield* db.first(Counting, `SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`, value);
  return row?.count ?? -1;
});

/** A Bill of one Line of `units`, left Open. */
function openBill(user: Parameters<typeof as>[0], itemId: string, units: number) {
  return recordSelection({ items: [{ itemId, quantity: units }] }).pipe(as(user));
}

describe("removing a Line", () => {
  it("lets any User remove a Line from a Bill with no Payment: the Line stays, marked removed by them", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Línea quitada", price: 1850, startingStock: 10, by: ana });
        const bill = yield* openBill(beto, item.id, 2);
        const before = yield* getBill(bill.id).pipe(as(beto));
        const lineId = before.lines[0]!.id;

        yield* advanceClock("2 minutes");
        yield* removeLine({ billId: bill.id, lineId, expectedRevision: before.revision }).pipe(as(beto));

        const at = Date.parse("2026-10-05T12:02:00-06:00");
        const after = yield* getBill(bill.id).pipe(as(ana));
        // No Lines left: the Bill counts as Paid with a zero total (spec §5.6).
        expect(after).toMatchObject({ total: 0, paid: 0, owed: 0, state: "paid", revision: before.revision + 1 });
        expect(after.lines).toMatchObject([
          {
            id: lineId,
            quantity: 2,
            unitPrice: 1850,
            by: beto.id,
            removal: { by: beto.id, byName: "Beto", at, reason: null },
          },
        ]);

        // The original Line is untouched (spec §2.1, ADR 0002); the removal is
        // its own record, and the units are back.
        const db = yield* Db;
        expect(
          yield* db.first(
            Schema.Struct({ addedBy: Schema.String, quantity: Schema.Int }),
            "SELECT added_by AS addedBy, quantity FROM lines WHERE id = ?",
            lineId,
          ),
        ).toEqual({ addedBy: beto.id, quantity: 2 });
        expect(yield* countIn("line_removals", "line_id", lineId)).toBe(1);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(10);
      }),
    ));

  it("lets an Admin remove a Line from a Bill without a Payment, keeping a reason when one is given", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const item = yield* seedItem({ name: "Con motivo", price: 1000, startingStock: 3, by: ana });
        const bill = yield* openBill(ana, item.id, 1);
        const before = yield* getBill(bill.id).pipe(as(ana));

        yield* removeLine({
          billId: bill.id,
          lineId: before.lines[0]!.id,
          reason: "Se registró de más",
          expectedRevision: before.revision,
        }).pipe(as(ana));

        const after = yield* getBill(bill.id).pipe(as(ana));
        expect(after.lines[0]!.removal).toMatchObject({ by: ana.id, byName: "Ana", reason: "Se registró de más" });
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(3);
      }),
    ));

  it("refuses a Worker a Line on a Bill with a Payment, writing nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Solo admin quita", price: 1000, by: ana });
        const bill = yield* openBill(ana, item.id, 2);
        yield* advanceClock("1 minute");
        yield* takePayment({ billId: bill.id, amount: 500, method: "cash", expectedRevision: bill.revision }).pipe(
          as(ana),
        );
        const before = yield* getBill(bill.id).pipe(as(beto));

        const error = yield* Effect.flip(
          removeLine({ billId: bill.id, lineId: before.lines[0]!.id, expectedRevision: before.revision }).pipe(
            as(beto),
          ),
        );

        expect(error._tag).toBe("AdminOnly");
        const after = yield* getBill(bill.id).pipe(as(ana));
        expect(after).toMatchObject({ total: 2000, paid: 500, revision: before.revision });
        expect(yield* countIn("line_removals", "line_id", before.lines[0]!.id)).toBe(0);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(-2);
      }),
    ));

  it("needs a reason from an Admin once the Bill has a Payment, and removes the Line when given", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const item = yield* seedItem({ name: "Con pago y motivo", price: 1000, startingStock: 5, by: ana });
        const bill = yield* openBill(ana, item.id, 1);
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], billId: bill.id }).pipe(as(ana));
        const paid = yield* takePayment({
          billId: bill.id,
          amount: 1000,
          method: "cash",
          expectedRevision: bill.revision + 1,
        }).pipe(as(ana));
        expect(paid.paid).toBe(false);
        const before = yield* getBill(bill.id).pipe(as(ana));
        expect(before).toMatchObject({ total: 2000, paid: 1000, state: "partial" });
        const lineId = before.lines[0]!.id;

        const missing = yield* Effect.flip(
          removeLine({ billId: bill.id, lineId, expectedRevision: before.revision }).pipe(as(ana)),
        );
        expect(missing._tag).toBe("ReasonRequired");

        yield* removeLine({
          billId: bill.id,
          lineId,
          reason: "El cliente no lo llevó",
          expectedRevision: before.revision,
        }).pipe(as(ana));

        const after = yield* getBill(bill.id).pipe(as(ana));
        expect(after).toMatchObject({ total: 1000, paid: 1000, owed: 0, state: "paid", revision: before.revision + 1 });
        expect(after.lines.find((line) => line.id === lineId)!.removal).toMatchObject({
          by: ana.id,
          reason: "El cliente no lo llevó",
        });
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(4);
      }),
    ));

  it("refuses a removal that would leave the total below the Payments, writing nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Debajo de lo pagado", price: 1000, by: ana });
        const bill = yield* openBill(ana, item.id, 2);
        yield* advanceClock("1 minute");
        yield* takePayment({ billId: bill.id, amount: 500, method: "cash", expectedRevision: bill.revision }).pipe(
          as(ana),
        );
        const before = yield* getBill(bill.id).pipe(as(ana));

        const error = yield* Effect.flip(
          removeLine({
            billId: bill.id,
            lineId: before.lines[0]!.id,
            reason: "Ya no está",
            expectedRevision: before.revision,
          }).pipe(as(ana)),
        );

        expect(error._tag).toBe("TotalBelowPayments");
        expect(yield* getBill(bill.id).pipe(as(ana))).toMatchObject({
          total: 2000,
          paid: 500,
          state: "partial",
          revision: before.revision,
        });
        expect(yield* countIn("line_removals", "line_id", before.lines[0]!.id)).toBe(0);
      }),
    ));

  it("refuses a stale removal: another phone moved the Bill first", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Línea obsoleta", price: 1000, by: ana });
        const bill = yield* openBill(ana, item.id, 1);
        const before = yield* getBill(bill.id).pipe(as(ana));
        // Another phone adds a Line: the Bill's revision moves (spec §7.3).
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], billId: bill.id }).pipe(as(ana));

        const error = yield* Effect.flip(
          removeLine({ billId: bill.id, lineId: before.lines[0]!.id, expectedRevision: before.revision }).pipe(
            as(ana),
          ),
        );

        expect(error._tag).toBe("BillChanged");
        const after = yield* getBill(bill.id).pipe(as(ana));
        expect(after).toMatchObject({ total: 2000, revision: before.revision + 1 });
        expect(yield* countIn("line_removals", "line_id", before.lines[0]!.id)).toBe(0);
      }),
    ));

  it("refuses a Line that belongs to another Bill, and never returns Stock twice", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "De otra cuenta", price: 1000, startingStock: 4, by: ana });
        const first = yield* openBill(ana, item.id, 1);
        const second = yield* openBill(ana, item.id, 1);
        const firstLine = (yield* getBill(first.id).pipe(as(ana))).lines[0]!.id;
        const secondSeen = yield* getBill(second.id).pipe(as(ana));

        const foreign = yield* Effect.flip(
          removeLine({ billId: second.id, lineId: firstLine, expectedRevision: secondSeen.revision }).pipe(as(ana)),
        );
        expect(foreign._tag).toBe("LineNotFound");

        yield* removeLine({ billId: first.id, lineId: firstLine, expectedRevision: 0 }).pipe(as(ana));
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(3);

        // A second submission of the same removal is a removal that is already
        // there: nothing moves, and Stock does not come back twice.
        const again = yield* Effect.flip(
          removeLine({ billId: first.id, lineId: firstLine, expectedRevision: 1 }).pipe(as(ana)),
        );
        expect(again._tag).toBe("LineNotFound");
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(3);
        expect(yield* countIn("line_removals", "line_id", firstLine)).toBe(1);
      }),
    ));

  it("leaves Stock untouched for a Line of a non-stock-tracked Item", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Sin existencias", price: 1000, stockTracked: false, by: ana });
        const bill = yield* openBill(ana, item.id, 2);
        const before = yield* getBill(bill.id).pipe(as(ana));

        yield* removeLine({ billId: bill.id, lineId: before.lines[0]!.id, expectedRevision: before.revision }).pipe(
          as(ana),
        );

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(0);
        expect((yield* getBill(bill.id).pipe(as(ana))).lines[0]!.removal).not.toBeNull();
      }),
    ));

  it("returns a Line's units from its own moved_stock fact, even after the Item stops being tracked", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Se destrackea", price: 1000, startingStock: 5, by: ana });
        const bill = yield* openBill(ana, item.id, 2);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(3);
        // Switching tracking off changes no existing record (spec §5.1): the
        // Line already moved Stock, so putting it back is what it returns.
        yield* updateItem(item.id, { ...item, stockTracked: false }).pipe(as(ana));

        const before = yield* getBill(bill.id).pipe(as(ana));
        yield* removeLine({ billId: bill.id, lineId: before.lines[0]!.id, expectedRevision: before.revision }).pipe(
          as(ana),
        );

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(5);
      }),
    ));

  it("records exactly one removal when two phones submit it at once", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Carrera de línea", price: 1000, startingStock: 4, by: ana });
        const bill = yield* openBill(ana, item.id, 1);
        const lineId = (yield* getBill(bill.id).pipe(as(ana))).lines[0]!.id;
        const attempt = (user: typeof ana) =>
          Effect.exit(removeLine({ billId: bill.id, lineId, expectedRevision: 0 }).pipe(as(user)));

        const outcomes = yield* Effect.all([attempt(ana), attempt(beto)], { concurrency: "unbounded" });

        expect(outcomes.filter((exit) => exit._tag === "Success")).toHaveLength(1);
        const failure = outcomes.find((exit) => exit._tag === "Failure")!;
        const error = Cause.findErrorOption(failure.cause);
        expect(Option.isSome(error) ? error.value._tag : "no error").toBe("BillChanged");
        expect(yield* countIn("line_removals", "line_id", lineId)).toBe(1);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(4);
      }),
    ));
});

describe("removing a Payment", () => {
  it("lets an Admin remove a Payment with a reason: paid falls, the state follows, the Payment stays marked", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const item = yield* seedItem({ name: "Pago quitado", price: 1000, startingStock: 4, by: ana });
        const bill = yield* openBill(ana, item.id, 2);
        yield* advanceClock("1 minute");
        const payment = yield* takePayment({
          billId: bill.id,
          method: "cash",
          expectedRevision: bill.revision,
        }).pipe(as(ana));
        const before = yield* getBill(bill.id).pipe(as(ana));
        expect(before).toMatchObject({ total: 2000, paid: 2000, state: "paid" });

        yield* advanceClock("2 minutes");
        yield* removePayment({
          billId: bill.id,
          paymentId: payment.id,
          reason: "Se cobró en otra cuenta",
          expectedRevision: before.revision,
        }).pipe(as(ana));

        const at = Date.parse("2026-10-05T12:03:00-06:00");
        const after = yield* getBill(bill.id).pipe(as(ana));
        expect(after).toMatchObject({ total: 2000, paid: 0, owed: 2000, state: "open", revision: before.revision + 1 });
        expect(after.payments).toMatchObject([
          {
            id: payment.id,
            amount: 2000,
            by: ana.id,
            removal: { by: ana.id, byName: "Ana", at, reason: "Se cobró en otra cuenta" },
          },
        ]);

        // The Payment itself is untouched; the removal is its own record.
        const db = yield* Db;
        expect(
          yield* db.first(
            Schema.Struct({ amount: Schema.Int, receivedBy: Schema.String }),
            "SELECT amount, received_by AS receivedBy FROM payments WHERE id = ?",
            payment.id,
          ),
        ).toEqual({ amount: 2000, receivedBy: ana.id });
        expect(yield* countIn("payment_removals", "payment_id", payment.id)).toBe(1);
        // Removing a Payment never moves Stock.
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(2);
      }),
    ));

  it("leaves the Bill Pago parcial when what remains still owes", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Queda debiendo", price: 1000, by: ana });
        const bill = yield* openBill(ana, item.id, 3);
        const first = yield* takePayment({ billId: bill.id, amount: 1000, method: "cash", expectedRevision: 0 }).pipe(
          as(ana),
        );
        yield* takePayment({ billId: bill.id, amount: 1000, method: "cash", expectedRevision: bill.revision + 1 }).pipe(
          as(ana),
        );
        const before = yield* getBill(bill.id).pipe(as(ana));

        yield* removePayment({
          billId: bill.id,
          paymentId: first.id,
          reason: "Un abono mal registrado",
          expectedRevision: before.revision,
        }).pipe(as(ana));

        expect(yield* getBill(bill.id).pipe(as(ana))).toMatchObject({
          total: 3000,
          paid: 1000,
          owed: 2000,
          state: "partial",
        });
      }),
    ));

  it("refuses a Worker, refuses an Admin without a reason, and refuses a stale submission", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Reglas del pago", price: 1000, by: ana });
        const bill = yield* openBill(ana, item.id, 1);
        const payment = yield* takePayment({ billId: bill.id, amount: 500, method: "cash", expectedRevision: 0 }).pipe(
          as(ana),
        );
        const seen = yield* getBill(bill.id).pipe(as(ana));

        const worker = yield* Effect.flip(
          removePayment({
            billId: bill.id,
            paymentId: payment.id,
            reason: "No me toca",
            expectedRevision: seen.revision,
          }).pipe(as(beto)),
        );
        expect(worker._tag).toBe("AdminOnly");

        const noReason = yield* Effect.flip(
          removePayment({ billId: bill.id, paymentId: payment.id, expectedRevision: seen.revision }).pipe(as(ana)),
        );
        expect(noReason._tag).toBe("ReasonRequired");

        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], billId: bill.id }).pipe(as(ana));
        const stale = yield* Effect.flip(
          removePayment({
            billId: bill.id,
            paymentId: payment.id,
            reason: "Obsoleto",
            expectedRevision: seen.revision,
          }).pipe(as(ana)),
        );
        expect(stale._tag).toBe("BillChanged");

        expect(yield* countIn("payment_removals", "payment_id", payment.id)).toBe(0);
        expect(yield* getBill(bill.id).pipe(as(ana))).toMatchObject({ paid: 500, revision: seen.revision + 1 });
      }),
    ));

  it("refuses a Payment of another Bill or one already removed", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Pago ajeno", price: 1000, by: ana });
        const first = yield* openBill(ana, item.id, 1);
        const second = yield* openBill(ana, item.id, 1);
        const payment = yield* takePayment({ billId: first.id, method: "cash", expectedRevision: 0 }).pipe(as(ana));
        const secondSeen = yield* getBill(second.id).pipe(as(ana));

        const foreign = yield* Effect.flip(
          removePayment({
            billId: second.id,
            paymentId: payment.id,
            reason: "No es de aquí",
            expectedRevision: secondSeen.revision,
          }).pipe(as(ana)),
        );
        expect(foreign._tag).toBe("PaymentNotFound");

        const firstSeen = yield* getBill(first.id).pipe(as(ana));
        yield* removePayment({
          billId: first.id,
          paymentId: payment.id,
          reason: "Se devolvió",
          expectedRevision: firstSeen.revision,
        }).pipe(as(ana));
        const again = yield* Effect.flip(
          removePayment({
            billId: first.id,
            paymentId: payment.id,
            reason: "Otra vez",
            expectedRevision: firstSeen.revision + 1,
          }).pipe(as(ana)),
        );
        expect(again._tag).toBe("PaymentNotFound");
        expect(yield* countIn("payment_removals", "payment_id", payment.id)).toBe(1);
      }),
    ));

  it("lets a Worker remove a Line again once the only Payment is gone", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Vuelve el empleado", price: 1000, startingStock: 4, by: ana });
        const bill = yield* openBill(ana, item.id, 1);
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], billId: bill.id }).pipe(as(ana));
        const payment = yield* takePayment({
          billId: bill.id,
          amount: 1000,
          method: "cash",
          expectedRevision: bill.revision + 1,
        }).pipe(as(ana));

        const withPayment = yield* getBill(bill.id).pipe(as(beto));
        expect(
          (yield* Effect.flip(
            removeLine({
              billId: bill.id,
              lineId: withPayment.lines[0]!.id,
              expectedRevision: withPayment.revision,
            }).pipe(as(beto)),
          ))._tag,
        ).toBe("AdminOnly");

        yield* removePayment({
          billId: bill.id,
          paymentId: payment.id,
          reason: "Se registró por error",
          expectedRevision: withPayment.revision,
        }).pipe(as(ana));

        const withoutPayment = yield* getBill(bill.id).pipe(as(beto));
        yield* removeLine({
          billId: bill.id,
          lineId: withoutPayment.lines[0]!.id,
          expectedRevision: withoutPayment.revision,
        }).pipe(as(beto));

        const after = yield* getBill(bill.id).pipe(as(ana));
        expect(after).toMatchObject({ total: 1000, paid: 0, state: "open", revision: withoutPayment.revision + 1 });
        expect(after.lines.find((line) => line.removal !== null)!.removal).toMatchObject({ by: beto.id });
      }),
    ));
});

describe("voiding a Bill", () => {
  it("lets an Admin void a Bill with a reason: it leaves the lists, keeps its record, and returns its Lines' units", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const item = yield* seedItem({ name: "Cuenta anulada", price: 1850, startingStock: 10, by: ana });
        const untracked = yield* seedItem({
          name: "Preparado anulado",
          price: 1000,
          stockTracked: false,
          by: ana,
        });
        const bill = yield* openBill(ana, item.id, 2);
        yield* recordSelection({ items: [{ itemId: untracked.id, quantity: 1 }], billId: bill.id }).pipe(as(ana));
        // A second Line of the same Item, removed before the void: its units
        // are already back, and voiding must not return them twice.
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], billId: bill.id }).pipe(as(ana));
        const beforeRemoval = yield* getBill(bill.id).pipe(as(ana));
        const secondLine = beforeRemoval.lines.find((line) => line.itemId === item.id && line.quantity === 1)!.id;
        yield* removeLine({ billId: bill.id, lineId: secondLine, expectedRevision: beforeRemoval.revision }).pipe(
          as(ana),
        );
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(8);

        const before = yield* getBill(bill.id).pipe(as(ana));
        yield* advanceClock("3 minutes");
        yield* voidBill({
          billId: bill.id,
          reason: "El cliente se arrepintió",
          expectedRevision: before.revision,
        }).pipe(as(ana));

        const at = Date.parse("2026-10-05T12:03:00-06:00");
        const after = yield* getBill(bill.id).pipe(as(ana));
        expect(after).toMatchObject({ state: "voided", revision: before.revision + 1, total: 4700, paid: 0 });
        expect(after.voided).toMatchObject({ by: ana.id, byName: "Ana", at, reason: "El cliente se arrepintió" });
        expect(after.lines).toHaveLength(3);
        expect(after.lines.find((line) => line.id === secondLine)!.removal).not.toBeNull();

        // It left Cuentas abiertas and the Owed list, while its record stays.
        expect((yield* listOpenBills()).bills.map((row) => row.id)).not.toContain(bill.id);
        const db = yield* Db;
        expect(yield* countIn("bill_voids", "bill_id", bill.id)).toBe(1);
        // Only the unremoved Line's units: the Item is back at 10, the
        // non-stock-tracked Item never moved.
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(10);
        expect(yield* stockOf(untracked.id).pipe(as(ana))).toBe(0);
      }),
    ));

  it("keeps a Paid Bill's Payments on record while counting them toward nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Pagada y anulada", price: 1000, startingStock: 3, by: ana });
        const bill = yield* openBill(ana, item.id, 2);
        const payment = yield* takePayment({ billId: bill.id, method: "cash", expectedRevision: 0 }).pipe(as(ana));
        const before = yield* getBill(bill.id).pipe(as(ana));

        yield* voidBill({ billId: bill.id, reason: "Era una prueba", expectedRevision: before.revision }).pipe(as(ana));

        const after = yield* getBill(bill.id).pipe(as(ana));
        expect(after).toMatchObject({ state: "voided", total: 2000, paid: 2000 });
        expect(after.payments).toMatchObject([{ id: payment.id, amount: 2000, removal: null }]);
        expect((yield* listOpenBills()).bills.map((row) => row.id)).not.toContain(bill.id);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(3);
      }),
    ));

  it("requires an Admin and a reason, cannot be done twice, and refuses a stale submission", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Reglas de anulación", price: 1000, by: ana });
        const bill = yield* openBill(ana, item.id, 1);
        const seen = yield* getBill(bill.id).pipe(as(beto));

        expect(
          (yield* Effect.flip(voidBill({ billId: bill.id, reason: "Nada", expectedRevision: 0 }).pipe(as(beto))))._tag,
        ).toBe("AdminOnly");
        expect(
          (yield* Effect.flip(voidBill({ billId: bill.id, expectedRevision: 0 }).pipe(as(ana))))._tag,
        ).toBe("ReasonRequired");
        // A stale submission changes nothing (spec §7.3).
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], billId: bill.id }).pipe(as(ana));
        expect(
          (yield* Effect.flip(voidBill({ billId: bill.id, reason: "Obsoleta", expectedRevision: 0 }).pipe(as(ana))))._tag,
        ).toBe("BillChanged");

        const now = yield* getBill(bill.id).pipe(as(ana));
        yield* voidBill({ billId: bill.id, reason: "Primera", expectedRevision: now.revision }).pipe(as(ana));
        expect(
          (yield* Effect.flip(
            voidBill({ billId: bill.id, reason: "Segunda", expectedRevision: now.revision + 1 }).pipe(as(ana)),
          ))._tag,
        ).toBe("BillIsVoided");
        expect(yield* countIn("bill_voids", "bill_id", bill.id)).toBe(1);
      }),
    ));

  it("refuses a Voided Bill any more Lines, Payments or corrections", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Cerrada del todo", price: 1000, by: ana });
        const bill = yield* openBill(ana, item.id, 1);
        const before = yield* getBill(bill.id).pipe(as(ana));
        yield* voidBill({ billId: bill.id, reason: "Se anuló", expectedRevision: before.revision }).pipe(as(ana));
        const voided = yield* getBill(bill.id).pipe(as(ana));

        expect(
          (yield* Effect.flip(
            recordSelection({ items: [{ itemId: item.id, quantity: 1 }], billId: bill.id }).pipe(as(ana)),
          ))._tag,
        ).toBe("BillNotOpen");
        expect(
          (yield* Effect.flip(
            takePayment({ billId: bill.id, method: "cash", expectedRevision: voided.revision }).pipe(as(ana)),
          ))._tag,
        ).toBe("BillIsVoided");
        expect(
          (yield* Effect.flip(
            removeLine({
              billId: bill.id,
              lineId: voided.lines[0]!.id,
              expectedRevision: voided.revision,
            }).pipe(as(ana)),
          ))._tag,
        ).toBe("BillIsVoided");
        expect(
          (yield* Effect.flip(
            voidBill({ billId: bill.id, reason: "Otra vez", expectedRevision: voided.revision }).pipe(as(ana)),
          ))._tag,
        ).toBe("BillIsVoided");

        const after = yield* getBill(bill.id).pipe(as(ana));
        expect(after).toMatchObject({ state: "voided", revision: voided.revision });
        expect(after.lines[0]!.removal).toBeNull();
      }),
    ));

  it("routes a new selection with the same Customer to a new Bill, not the Voided one", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const customer = yield* seedCustomer("Familia anulada", { by: ana });
        const item = yield* seedItem({ name: "Cliente anulado", price: 1000, by: ana });
        const bill = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: customer.id,
        }).pipe(as(ana));
        const before = yield* getBill(bill.id).pipe(as(ana));
        yield* voidBill({ billId: bill.id, reason: "Vuelve a empezar", expectedRevision: before.revision }).pipe(
          as(ana),
        );

        const fresh = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: customer.id,
        }).pipe(as(ana));

        expect(fresh.id).not.toBe(bill.id);
        expect((yield* listOpenBills("Familia anulada")).bills.map((row) => row.id)).toEqual([fresh.id]);
      }),
    ));
});

describe("what a correction answers", () => {
  it("is the Bill's figures as the correction left them", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Cifras tras corregir", price: 1000, startingStock: 10, by: ana });
        const bill = yield* openBill(ana, item.id, 2);
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], billId: bill.id }).pipe(as(ana));
        let seen = yield* getBill(bill.id).pipe(as(ana));
        const paid = yield* takePayment({
          billId: bill.id,
          amount: 500,
          method: "cash",
          expectedRevision: seen.revision,
        }).pipe(as(ana));
        seen = yield* getBill(bill.id).pipe(as(ana));
        // A Line says whether it moved Stock: what its removal returns (spec §5.7).
        expect(seen.lines.map((line) => line.movedStock)).toEqual([true, true]);

        const line = yield* removeLine({
          billId: bill.id,
          lineId: seen.lines[1]!.id,
          reason: "De más",
          expectedRevision: seen.revision,
        }).pipe(as(ana));
        expect(line).toMatchObject({ total: 2000, paid: 500, voided: false });

        seen = yield* getBill(bill.id).pipe(as(ana));
        const payment = yield* removePayment({
          billId: bill.id,
          paymentId: paid.id,
          reason: "Por error",
          expectedRevision: seen.revision,
        }).pipe(as(ana));
        expect(payment).toMatchObject({ total: 2000, paid: 0, voided: false });

        seen = yield* getBill(bill.id).pipe(as(ana));
        const voided = yield* voidBill({ billId: bill.id, reason: "Prueba", expectedRevision: seen.revision }).pipe(as(ana));
        expect(voided).toMatchObject({ total: 2000, paid: 0, voided: true });
      }),
    ));
});

describe("a correction this User already recorded", () => {
  it("is found for the Line, the Payment and the Bill, with the Bill as it is now", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Corrección ya hecha", price: 1000, startingStock: 10, by: ana });
        const bill = yield* openBill(ana, item.id, 2);
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], billId: bill.id }).pipe(as(ana));
        let seen = yield* getBill(bill.id).pipe(as(ana));
        const paid = yield* takePayment({
          billId: bill.id,
          amount: 500,
          method: "cash",
          expectedRevision: seen.revision,
        }).pipe(as(ana));
        seen = yield* getBill(bill.id).pipe(as(ana));
        const lineId = seen.lines[1]!.id;
        const line = { intent: "quitar-linea", billId: bill.id, lineId } as const;
        const payment = { intent: "quitar-pago", billId: bill.id, paymentId: paid.id } as const;
        const whole = { intent: "cancelar-cuenta", billId: bill.id } as const;

        // Nothing was corrected yet.
        expect(yield* recordedCorrection(line).pipe(as(ana))).toBeUndefined();
        expect(yield* recordedCorrection(payment).pipe(as(ana))).toBeUndefined();
        expect(yield* recordedCorrection(whole).pipe(as(ana))).toBeUndefined();

        const removed = yield* removeLine({ billId: bill.id, lineId, reason: "De más", expectedRevision: seen.revision }).pipe(as(ana));
        expect(yield* recordedCorrection(line, " De más ").pipe(as(ana))).toEqual({ id: removed.id, total: 2000, paid: 500, voided: false });

        seen = yield* getBill(bill.id).pipe(as(ana));
        const unpaid = yield* removePayment({
          billId: bill.id,
          paymentId: paid.id,
          reason: "Por error",
          expectedRevision: seen.revision,
        }).pipe(as(ana));
        expect(yield* recordedCorrection(payment, "Por error").pipe(as(ana))).toEqual({
          id: unpaid.id,
          total: 2000,
          paid: 0,
          voided: false,
        });
        // The Line's is answered with the Bill as it is now, not as it was then.
        expect(yield* recordedCorrection(line, "De más").pipe(as(ana))).toMatchObject({ id: removed.id, paid: 0 });
        // Another reason, or none, is not the correction that was recorded.
        expect(yield* recordedCorrection(line, "Otra cosa").pipe(as(ana))).toBeUndefined();
        expect(yield* recordedCorrection(payment).pipe(as(ana))).toBeUndefined();

        seen = yield* getBill(bill.id).pipe(as(ana));
        const voided = yield* voidBill({ billId: bill.id, reason: "Prueba", expectedRevision: seen.revision }).pipe(as(ana));
        expect(yield* recordedCorrection(whole, "Prueba").pipe(as(ana))).toEqual({ id: voided.id, total: 2000, paid: 0, voided: true });
      }),
    ));

  it("is not another User's, nor a record of another Bill", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const carla = yield* seedUser("admin", "Carla");
        const item = yield* seedItem({ name: "Corrección ajena", price: 1000, startingStock: 10, by: ana });
        const bill = yield* openBill(ana, item.id, 1);
        const other = yield* openBill(ana, item.id, 1);
        const seen = yield* getBill(bill.id).pipe(as(ana));
        const lineId = seen.lines[0]!.id;
        yield* removeLine({ billId: bill.id, lineId, expectedRevision: seen.revision }).pipe(as(ana));

        expect(yield* recordedCorrection({ intent: "quitar-linea", billId: bill.id, lineId }).pipe(as(carla))).toBeUndefined();
        expect(
          yield* recordedCorrection({ intent: "quitar-linea", billId: other.id, lineId }).pipe(as(ana)),
        ).toBeUndefined();
      }),
    ));
});
