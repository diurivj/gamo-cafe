import { Cause, Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, recordSelection, takePayment } from "~/backend/bills";
import { Db } from "~/backend/db";

import { as, seedUser, signedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { advanceClock, runTest, setClock } from "./support/effect";
import { recordPayment } from "./support/sales";

// Payments (spec §2.3, §5.5, §5.6, §7.3.2, §10.3). Tests in one file share a
// D1, and active Item names are unique, so each test names its own.

/** A Bill of `units` of one Item, left Open, with the revision it now holds. */
function openBill(user: Parameters<typeof as>[0], itemId: string, units: number) {
  return recordSelection({ items: [{ itemId, quantity: units }] }).pipe(as(user));
}

describe("taking a Payment on one Bill", () => {
  it("records the Payment with its receiver, moment, Day and method, and makes the Bill Pagada", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Pagable", price: 1850, by: ana });
        const bill = yield* openBill(beto, item.id, 2);

        yield* advanceClock("5 minutes");
        const recorded = yield* takePayment({
          billId: bill.id,
          method: "cash",
          expectedRevision: bill.revision,
        }).pipe(as(ana));

        expect(recorded.amount).toBe(3700);
        const at = Date.parse("2026-10-05T12:05:00-06:00");
        expect(yield* getBill(bill.id).pipe(as(ana))).toMatchObject({
          total: 3700,
          paid: 3700,
          owed: 0,
          state: "paid",
          revision: 1,
          payments: [
            {
              id: recorded.id,
              amount: 3700,
              method: "cash",
              by: ana.id,
              byName: "Ana",
              at,
              day: "2026-10-05",
            },
          ],
        });

        // The fact is a Payment with no handover reference: it settles one
        // Bill, not several of a Customer's (spec §5.5, ticket 09).
        const db = yield* Db;
        expect(
          yield* db.first(
            Schema.Struct({ handoverReference: Schema.NullOr(Schema.String) }),
            "SELECT handover_reference AS handoverReference FROM payments WHERE id = ?",
            recorded.id,
          ),
        ).toEqual({ handoverReference: null });
      }),
    ));

  it("lets a Worker take a Payment on any Open Bill", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "De empleado", price: 1000, by: ana });
        const bill = yield* openBill(ana, item.id, 1);

        const recorded = yield* takePayment({
          billId: bill.id,
          method: "transfer",
          expectedRevision: bill.revision,
        }).pipe(as(beto));

        expect(recorded.amount).toBe(1000);
        // The Bill is now Paid, so a Worker no longer opens it (§4.1); its
        // own Payment is on the record all the same.
        expect(yield* getBill(bill.id).pipe(as(ana))).toMatchObject({
          state: "paid",
          payments: [{ method: "transfer", by: beto.id, byName: "Beto" }],
        });
      }),
    ));

  it("records a partial Payment, leaves the Bill Pago parcial, and paying the rest makes it Pagada", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "A plazos", price: 1000, by: ana });
        const bill = yield* openBill(ana, item.id, 3);

        yield* takePayment({ billId: bill.id, amount: 1200, method: "cash", expectedRevision: bill.revision }).pipe(
          as(ana),
        );

        let seen = yield* getBill(bill.id).pipe(as(ana));
        expect(seen).toMatchObject({ total: 3000, paid: 1200, owed: 1800, state: "partial", revision: 1 });
        expect(seen.payments).toMatchObject([{ amount: 1200, method: "cash", day: "2026-10-05" }]);

        yield* advanceClock("3 minutes");
        // Absent means everything that is still owed (spec §5.5).
        const rest = yield* takePayment({ billId: bill.id, method: "transfer", expectedRevision: seen.revision }).pipe(
          as(ana),
        );

        expect(rest.amount).toBe(1800);
        seen = yield* getBill(bill.id).pipe(as(ana));
        expect(seen).toMatchObject({ paid: 3000, owed: 0, state: "paid", revision: 2 });
        expect(seen.payments.map((payment) => [payment.amount, payment.method, payment.day])).toEqual([
          [1200, "cash", "2026-10-05"],
          [1800, "transfer", "2026-10-05"],
        ]);
      }),
    ));

  it("refuses zero, a negative, a fractional and a larger-than-owed Payment, writing nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Validado al pagar", price: 1850, by: ana });
        const bill = yield* openBill(ana, item.id, 2);

        const attempts = [
          [0, "PaymentNotPositive"],
          [-100, "PaymentNotPositive"],
          [1.5, "PaymentNotPositive"],
          [3701, "PaymentExceedsOwed"],
        ] as const;
        for (const [amount, tag] of attempts) {
          const error = yield* Effect.flip(
            takePayment({ billId: bill.id, amount, method: "cash", expectedRevision: bill.revision }).pipe(as(ana)),
          );
          expect(error._tag, String(amount)).toBe(tag);
        }

        const untouched = yield* getBill(bill.id).pipe(as(ana));
        expect(untouched).toMatchObject({ paid: 0, owed: 3700, state: "open", revision: 0 });
        expect(untouched.payments).toEqual([]);
      }),
    ));

  it("refuses a Payment on a Bill that does not exist or is Cancelada", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Anulada al pagar", price: 1000, by: ana });
        const bill = yield* openBill(ana, item.id, 1);

        expect((yield* Effect.flip(takePayment({ billId: "nadie", method: "cash", expectedRevision: 0 }).pipe(as(ana))))._tag).toBe(
          "BillNotFound",
        );

        const db = yield* Db;
        yield* db.run("UPDATE bills SET state = 'voided' WHERE id = ?", bill.id);
        expect(
          (yield* Effect.flip(
            takePayment({ billId: bill.id, amount: 500, method: "cash", expectedRevision: 0 }).pipe(as(ana)),
          ))._tag,
        ).toBe("BillIsVoided");
        expect((yield* getBill(bill.id).pipe(as(ana))).payments).toEqual([]);
      }),
    ));

  it("refuses a Payment whose page is stale, and writes nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Revisión", price: 1000, by: ana });
        const bill = yield* openBill(ana, item.id, 2);

        // Another phone adds a Line: the Bill's revision moves (spec §7.3).
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], billId: bill.id }).pipe(as(ana));

        const error = yield* Effect.flip(
          takePayment({ billId: bill.id, amount: 2000, method: "cash", expectedRevision: bill.revision }).pipe(as(ana)),
        );

        expect(error._tag).toBe("BillChanged");
        expect(yield* getBill(bill.id).pipe(as(ana))).toMatchObject({ paid: 0, state: "open", revision: 1 });
        expect((yield* getBill(bill.id).pipe(as(ana))).payments).toEqual([]);
      }),
    ));
});

describe("two phones paying the same Bill at once", () => {
  it("records exactly one full Payment; the other is told the Bill changed", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Carrera de pago", price: 3700, by: ana });
        const bill = yield* openBill(ana, item.id, 1);

        const payment = (user: typeof ana) =>
          Effect.exit(
            takePayment({ billId: bill.id, method: "cash", expectedRevision: bill.revision }).pipe(as(user)),
          );

        const outcomes = yield* Effect.all([payment(ana), payment(beto)], { concurrency: "unbounded" });

        expect(outcomes.filter((exit) => exit._tag === "Success")).toHaveLength(1);
        const failure = outcomes.find((exit) => exit._tag === "Failure")!;
        const error = Cause.findErrorOption(failure.cause);
        expect(Option.isSome(error) ? error.value._tag : "no error").toBe("BillChanged");

        const seen = yield* getBill(bill.id).pipe(as(ana));
        expect(seen).toMatchObject({ paid: 3700, owed: 0, state: "paid", revision: 1 });
        expect(seen.payments).toHaveLength(1);
      }),
    ));

  it("produces exactly one Payment when two phones race through the app", async () => {
    const seeded = await runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Carrera en la app", price: 1500, by: ana });
        const bill = yield* openBill(ana, item.id, 2);
        return { ana, beto, item, bill };
      }),
    );
    const ana = await signedIn("admin", "Ana");
    const beto = await signedIn("worker", "Beto");

    // The same page, the same revision: one submission wins.
    const pay = (who: typeof ana) =>
      recordPayment(who, seeded.bill.id, { amount: "30.00", method: "cash", revision: String(seeded.bill.revision) });
    const answers = await Promise.all([pay(ana), pay(beto)]);

    // Whichever request lands first records the Payment and the other is
    // refused, visibly: told the Bill changed, and nothing more is written.
    expect(answers.map(({ response }) => response.status).sort()).toEqual([200, 400]);
    expect(answers.filter(({ error }) => error?.includes("La cuenta cambió"))).toHaveLength(1);
    // A Worker is never told they may open the Bill it left Paid (§4.1).
    expect(answers[1].payment?.canOpen ?? answers[1].changed?.canOpen).toBe(false);

    const after = await runTest(getBill(seeded.bill.id).pipe(as(seeded.ana)));
    expect(after).toMatchObject({ paid: 3000, owed: 0, state: "paid" });
    expect(after.payments).toHaveLength(1);
  });
});
