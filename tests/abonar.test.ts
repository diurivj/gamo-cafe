import { env } from "cloudflare:workers";
import { Cause, Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, listCustomerHandovers, listCustomerOpenBills, takeCustomerPayment, takePayment } from "~/backend/bills";
import { retireCustomer } from "~/backend/customers";
import { Db } from "~/backend/db";

import { as, seedUser, signedIn } from "./support/auth";
import { seedCustomer } from "./support/customers";
import { advanceClock, runTest, setClock } from "./support/effect";

// Abonar: one amount paid across a Customer's Open Bills (spec §5.5, §7.3.2,
// §8.3, §10.3). Tests in one file share a D1, so each test uses its own
// Customer, Item names and bill ids.
//
// The routing rule of §5.3 puts a Customer's new Lines on their one Open Bill
// of the Day, so a Customer with several Open Bills at once is arranged here
// by inserting the Bills' projection rows directly, as tests/cuentas.test.ts
// does for its read budget.

interface SeededBill {
  readonly id: string;
  readonly customerId: string;
  readonly by: string;
  readonly day: string;
  readonly openedAt: number;
  readonly total: number;
  readonly paid: number;
  readonly state: "open" | "partial";
  readonly revision: number;
}

/** One Open Bill of a Customer, with its projections as they would be. */
function seedOpenBill(db: Db["Service"], bill: SeededBill) {
  return db.run(
    `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    bill.id, bill.day, bill.by, bill.openedAt, bill.customerId, bill.total, bill.paid, bill.state, bill.revision,
  );
}

/** What the page would submit for these Bills: their ids and revisions. */
function expectedOf(bills: ReadonlyArray<{ readonly id: string; readonly revision: number }>) {
  return bills.map((bill) => ({ billId: bill.id, revision: bill.revision }));
}

const PaymentRows = Schema.Struct({
  id: Schema.String,
  billId: Schema.String,
  amount: Schema.Int,
  method: Schema.Literals(["cash", "transfer"]),
  reference: Schema.NullOr(Schema.String),
  receivedBy: Schema.String,
  receivedAt: Schema.Int,
  day: Schema.String,
});

const paymentsOf = Effect.fnUntraced(function* (customerId: string) {
  const db = yield* Db;
  return yield* db.all(
    PaymentRows,
    `SELECT p.id, p.bill_id AS billId, p.amount, p.method, p.handover_reference AS reference,
            p.received_by AS receivedBy, p.received_at AS receivedAt, p.day
     FROM payments p JOIN bills b ON b.id = p.bill_id
     WHERE b.customer_id = ?
     ORDER BY p.received_at, p.rowid`,
    customerId,
  );
});

describe("Abonar across a Customer's Open Bills", () => {
  it("pays oldest first, one shared-reference Payment per Bill, leaving the last Pago parcial", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const ruiz = yield* seedCustomer("Familia del abono", { by: ana });
        const db = yield* Db;
        yield* seedOpenBill(db, { id: "abono-a", customerId: ruiz.id, by: ana.id, day: "2026-09-26", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
        yield* seedOpenBill(db, { id: "abono-b", customerId: ruiz.id, by: ana.id, day: "2026-09-27", openedAt: 2000, total: 3000, paid: 0, state: "open", revision: 0 });
        yield* seedOpenBill(db, { id: "abono-c", customerId: ruiz.id, by: ana.id, day: "2026-09-28", openedAt: 3000, total: 2000, paid: 500, state: "partial", revision: 4 });

        yield* advanceClock("30 minutes");
        const recorded = yield* takeCustomerPayment({
          customerId: ruiz.id,
          amount: 6000,
          method: "transfer",
          expectedRevisions: expectedOf([
            { id: "abono-a", revision: 0 },
            { id: "abono-b", revision: 0 },
            { id: "abono-c", revision: 4 },
          ]),
        }).pipe(as(ana));

        // $50.00 covers the oldest Bill, $10.00 goes onto the next: it is left
        // Pago parcial and the third Bill is untouched (flow §8.3).
        expect(recorded.amount).toBe(6000);
        expect(recorded.shares.map((share) => [share.billId, share.amount])).toEqual([
          ["abono-a", 5000],
          ["abono-b", 1000],
        ]);
        expect(yield* getBill("abono-a").pipe(as(ana))).toMatchObject({ paid: 5000, owed: 0, state: "paid" });
        expect(yield* getBill("abono-b").pipe(as(ana))).toMatchObject({ paid: 1000, owed: 2000, state: "partial" });
        expect(yield* getBill("abono-c").pipe(as(ana))).toMatchObject({ paid: 500, owed: 1500, state: "partial" });

        // One Payment per Bill it reached, with the same method, receiver,
        // moment, Day and handover reference (spec §5.5).
        const at = Date.parse("2026-10-05T12:30:00-06:00");
        const payments = yield* paymentsOf(ruiz.id);
        expect(payments).toEqual([
          { id: recorded.shares[0]!.paymentId, billId: "abono-a", amount: 5000, method: "transfer", reference: recorded.reference, receivedBy: ana.id, receivedAt: at, day: "2026-10-05" },
          { id: recorded.shares[1]!.paymentId, billId: "abono-b", amount: 1000, method: "transfer", reference: recorded.reference, receivedBy: ana.id, receivedAt: at, day: "2026-10-05" },
        ]);
      }),
    ));

  it("defaults to everything the Customer owes, leaving every Bill Pagada", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const ruiz = yield* seedCustomer("Familia del total", { by: ana });
        const db = yield* Db;
        yield* seedOpenBill(db, { id: "total-a", customerId: ruiz.id, by: ana.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
        yield* seedOpenBill(db, { id: "total-b", customerId: ruiz.id, by: ana.id, day: "2026-10-02", openedAt: 2000, total: 2000, paid: 1000, state: "partial", revision: 2 });

        const recorded = yield* takeCustomerPayment({
          customerId: ruiz.id,
          method: "cash",
          expectedRevisions: expectedOf([
            { id: "total-a", revision: 0 },
            { id: "total-b", revision: 2 },
          ]),
        }).pipe(as(ana));

        expect(recorded.amount).toBe(6000);
        expect(recorded.shares.map((share) => share.amount)).toEqual([5000, 1000]);
        expect(yield* getBill("total-a").pipe(as(ana))).toMatchObject({ paid: 5000, owed: 0, state: "paid" });
        expect(yield* getBill("total-b").pipe(as(ana))).toMatchObject({ paid: 2000, owed: 0, state: "paid" });
      }),
    ));

  it("refuses an amount above what the Customer owes, and zero or less, writing nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const ruiz = yield* seedCustomer("Familia del límite", { by: ana });
        const db = yield* Db;
        yield* seedOpenBill(db, { id: "limite-a", customerId: ruiz.id, by: ana.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
        yield* seedOpenBill(db, { id: "limite-b", customerId: ruiz.id, by: ana.id, day: "2026-10-02", openedAt: 2000, total: 2000, paid: 1000, state: "partial", revision: 2 });
        const expectedRevisions = expectedOf([
          { id: "limite-a", revision: 0 },
          { id: "limite-b", revision: 2 },
        ]);

        const over = yield* Effect.flip(
          takeCustomerPayment({ customerId: ruiz.id, amount: 6001, method: "cash", expectedRevisions }).pipe(as(ana)),
        );
        expect(over).toMatchObject({ _tag: "PaymentExceedsOwed", owed: 6000 });

        for (const amount of [0, -100, 1.5]) {
          const error = yield* Effect.flip(
            takeCustomerPayment({ customerId: ruiz.id, amount, method: "cash", expectedRevisions }).pipe(as(ana)),
          );
          expect(error._tag, String(amount)).toBe("PaymentNotPositive");
        }

        expect(yield* getBill("limite-a").pipe(as(ana))).toMatchObject({ paid: 0, state: "open", revision: 0 });
        expect(yield* getBill("limite-b").pipe(as(ana))).toMatchObject({ paid: 1000, state: "partial", revision: 2 });
        expect(yield* paymentsOf(ruiz.id)).toEqual([]);
      }),
    ));

  it("records nothing and tells the User when another phone changed a Bill since the page was loaded", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const ruiz = yield* seedCustomer("Familia de la carrera", { by: ana });
        const db = yield* Db;
        yield* seedOpenBill(db, { id: "carrera-a", customerId: ruiz.id, by: ana.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
        yield* seedOpenBill(db, { id: "carrera-b", customerId: ruiz.id, by: ana.id, day: "2026-10-02", openedAt: 2000, total: 3000, paid: 0, state: "open", revision: 0 });
        const page = expectedOf([
          { id: "carrera-a", revision: 0 },
          { id: "carrera-b", revision: 0 },
        ]);

        // Another phone pays the second Bill before this page is submitted.
        yield* takePayment({ billId: "carrera-b", amount: 1000, method: "cash", expectedRevision: 0 }).pipe(
          as(beto),
        );

        const error = yield* Effect.flip(
          takeCustomerPayment({ customerId: ruiz.id, amount: 8000, method: "cash", expectedRevisions: page }).pipe(
            as(ana),
          ),
        );

        expect(error).toMatchObject({ _tag: "CustomerBillsChanged", customerId: ruiz.id });
        // Nothing of this submission was recorded, and both Bills still hold
        // exactly what they held before it (spec §10.3).
        const payments = yield* paymentsOf(ruiz.id);
        expect(payments.map((payment) => [payment.billId, payment.amount, payment.reference])).toEqual([
          ["carrera-b", 1000, null],
        ]);
        expect(yield* getBill("carrera-a").pipe(as(ana))).toMatchObject({ paid: 0, state: "open", revision: 0 });
        expect(yield* getBill("carrera-b").pipe(as(ana))).toMatchObject({ paid: 1000, state: "partial", revision: 1 });
      }),
    ));

  it("records nothing when the set of Open Bills changed — one was paid, another appeared", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const ruiz = yield* seedCustomer("Familia del conjunto", { by: ana });
        const db = yield* Db;
        yield* seedOpenBill(db, { id: "conjunto-a", customerId: ruiz.id, by: ana.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
        const page = expectedOf([{ id: "conjunto-a", revision: 0 }]);

        // Another selection on a later day leaves the first Bill Open behind.
        yield* seedOpenBill(db, { id: "conjunto-b", customerId: ruiz.id, by: ana.id, day: "2026-10-03", openedAt: 3000, total: 2000, paid: 0, state: "open", revision: 0 });
        // And the Bill the page showed was paid by another phone.
        yield* takePayment({ billId: "conjunto-a", method: "cash", expectedRevision: 0 }).pipe(as(ana));

        const error = yield* Effect.flip(
          takeCustomerPayment({ customerId: ruiz.id, amount: 4000, method: "cash", expectedRevisions: page }).pipe(
            as(ana),
          ),
        );

        expect(error._tag).toBe("CustomerBillsChanged");
        expect(yield* getBill("conjunto-b").pipe(as(ana))).toMatchObject({ paid: 0, state: "open", revision: 0 });
        expect((yield* paymentsOf(ruiz.id)).map((payment) => payment.amount)).toEqual([5000]);
      }),
    ));

  it("collects a retired Customer's Open Bills", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const ruiz = yield* seedCustomer("Familia retirada", { by: ana });
        const db = yield* Db;
        yield* seedOpenBill(db, { id: "retirada-a", customerId: ruiz.id, by: ana.id, day: "2026-10-01", openedAt: 1000, total: 3000, paid: 0, state: "open", revision: 0 });
        yield* retireCustomer(ruiz.id).pipe(as(ana));

        const recorded = yield* takeCustomerPayment({
          customerId: ruiz.id,
          amount: 1000,
          method: "cash",
          expectedRevisions: expectedOf([{ id: "retirada-a", revision: 0 }]),
        }).pipe(as(ana));

        expect(recorded.shares.map((share) => share.amount)).toEqual([1000]);
        expect(yield* getBill("retirada-a").pipe(as(ana))).toMatchObject({ paid: 1000, owed: 2000, state: "partial" });
      }),
    ));

  it("refuses a Customer that does not exist", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const error = yield* Effect.flip(
          takeCustomerPayment({ customerId: "nadie", amount: 1000, method: "cash", expectedRevisions: [] }).pipe(
            as(ana),
          ),
        );
        expect(error._tag).toBe("CustomerNotFound");
      }),
    ));
});

describe("two phones submitting the same Customer page at once", () => {
  it("records exactly one handover; the other tells the User the Bills changed", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const ruiz = yield* seedCustomer("Familia simultánea", { by: ana });
        const db = yield* Db;
        yield* seedOpenBill(db, { id: "sim-a", customerId: ruiz.id, by: ana.id, day: "2026-10-01", openedAt: 1000, total: 3000, paid: 0, state: "open", revision: 0 });
        yield* seedOpenBill(db, { id: "sim-b", customerId: ruiz.id, by: ana.id, day: "2026-10-02", openedAt: 2000, total: 2000, paid: 0, state: "open", revision: 0 });
        const expectedRevisions = expectedOf([
          { id: "sim-a", revision: 0 },
          { id: "sim-b", revision: 0 },
        ]);

        const submit = (user: typeof ana) =>
          Effect.exit(
            takeCustomerPayment({ customerId: ruiz.id, amount: 5000, method: "cash", expectedRevisions }).pipe(
              as(user),
            ),
          );
        const outcomes = yield* Effect.all([submit(ana), submit(beto)], { concurrency: "unbounded" });

        expect(outcomes.filter((exit) => exit._tag === "Success")).toHaveLength(1);
        const failure = outcomes.find((exit) => exit._tag === "Failure")!;
        const error = Cause.findErrorOption(failure.cause);
        expect(Option.isSome(error) ? error.value._tag : "no error").toBe("CustomerBillsChanged");

        const payments = yield* paymentsOf(ruiz.id);
        expect(payments).toHaveLength(2);
        expect(new Set(payments.map((payment) => payment.reference)).size).toBe(1);
        expect(yield* getBill("sim-a").pipe(as(ana))).toMatchObject({ paid: 3000, state: "paid" });
        expect(yield* getBill("sim-b").pipe(as(ana))).toMatchObject({ paid: 2000, state: "paid" });
      }),
    ));
});

describe("the Customer page's reads", () => {
  it("give the Customer's Open Bills oldest first, and only theirs", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const ruiz = yield* seedCustomer("Familia leída", { by: ana });
        const otro = yield* seedCustomer("Familia ajena", { by: ana });
        const db = yield* Db;
        yield* seedOpenBill(db, { id: "lee-vieja", customerId: ruiz.id, by: ana.id, day: "2026-10-01", openedAt: 1000, total: 3000, paid: 0, state: "open", revision: 0 });
        yield* seedOpenBill(db, { id: "lee-nueva", customerId: ruiz.id, by: ana.id, day: "2026-10-02", openedAt: 2000, total: 2000, paid: 500, state: "partial", revision: 3 });
        yield* seedOpenBill(db, { id: "lee-ajena", customerId: otro.id, by: ana.id, day: "2026-09-30", openedAt: 500, total: 900, paid: 0, state: "open", revision: 0 });

        const bills = yield* listCustomerOpenBills(ruiz.id);

        expect(bills.map((bill) => [bill.id, bill.owed, bill.revision])).toEqual([
          ["lee-vieja", 3000, 0],
          ["lee-nueva", 1500, 3],
        ]);
      }),
    ));

  it("show one handover as one event, with its Payments added up", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const ruiz = yield* seedCustomer("Familia de eventos", { by: ana });
        const db = yield* Db;
        yield* seedOpenBill(db, { id: "evento-a", customerId: ruiz.id, by: ana.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
        yield* seedOpenBill(db, { id: "evento-b", customerId: ruiz.id, by: ana.id, day: "2026-10-02", openedAt: 2000, total: 3000, paid: 0, state: "open", revision: 0 });
        yield* takeCustomerPayment({
          customerId: ruiz.id,
          amount: 6000,
          method: "transfer",
          expectedRevisions: expectedOf([
            { id: "evento-a", revision: 0 },
            { id: "evento-b", revision: 0 },
          ]),
        }).pipe(as(ana));

        yield* advanceClock("10 minutes");
        // A later Payment on one Bill is an event of its own, with no reference.
        yield* takePayment({ billId: "evento-b", amount: 500, method: "cash", expectedRevision: 1 }).pipe(
          as(ana),
        );

        const events = yield* listCustomerHandovers(ruiz.id);

        expect(events.map((event) => [event.amount, event.method, event.billCount, event.reference === null])).toEqual([
          [500, "cash", 1, true],
          [6000, "transfer", 2, false],
        ]);
        expect(events[1]).toMatchObject({ by: ana.id, byName: "Ana", day: "2026-10-05" });
      }),
    ));
});

/**
 * The D1 binding with counts of what the operation asked of it: `prepare`
 * counts a statement, `bind` records the widest parameter list (spec §2.4,
 * §10.3). The same shape as the counters in tests/bills.test.ts.
 */
function countingD1(d1: D1Database) {
  const counter = { statements: 0, maxParams: 0 };
  const measured = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...params: ReadonlyArray<string | number | null>) => {
            counter.maxParams = Math.max(counter.maxParams, params.length);
            return measured(target.bind(...params));
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return {
    counter,
    d1: new Proxy(d1, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return (sql: string) => {
            counter.statements += 1;
            return measured(target.prepare(sql));
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database,
  };
}

it("pays 30 Open Bills in fewer than 50 statements, no query over 100 bound parameters", async () => {
  const seeded = await runTest(
    Effect.gen(function* () {
      const ana = yield* seedUser("admin");
      const ruiz = yield* seedCustomer("Familia de treinta", { by: ana });
      const db = yield* Db;
      yield* db.run(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 30)
         INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
         SELECT 'treinta-' || x, '2026-09-01', ?, 1000 + x, ?, 100, 0, 'open', 0 FROM n`,
        ana.id,
        ruiz.id,
      );
      return { ana, ruiz };
    }),
  );

  const { counter, d1 } = countingD1(env.DB);
  const recorded = await Effect.runPromise(
    takeCustomerPayment({
      customerId: seeded.ruiz.id,
      amount: 2995,
      method: "cash",
      expectedRevisions: Array.from({ length: 30 }, (_, index) => ({
        billId: `treinta-${index + 1}`,
        revision: 0,
      })),
    }).pipe(as(seeded.ana), Effect.provide(Db.layer(d1))),
  );

  // Three statements: the Customer's read, then the batch's two multi-row
  // statements, whatever the number of Bills (spec §2.4, §10.3).
  expect(counter.statements).toBeLessThan(50);
  expect(counter.maxParams).toBeLessThanOrEqual(100);
  // $29.95 over thirty $1.00 claims: twenty-nine Bills are covered, the last
  // one keeps $0.05 owed, and all thirty Payments share one reference.
  expect(recorded.shares).toHaveLength(30);
  expect(recorded.shares.at(-1)!.amount).toBe(95);
  const payments = await runTest(paymentsOf(seeded.ruiz.id));
  expect(new Set(payments.map((payment) => payment.reference))).toEqual(new Set([recorded.reference]));
  const states = await runTest(
    Effect.gen(function* () {
      const db = yield* Db;
      return yield* db.all(
        Schema.Struct({ id: Schema.String, paid: Schema.Int, state: Schema.String }),
        "SELECT id, paid, state FROM bills WHERE id LIKE 'treinta-%' ORDER BY opened_at",
      );
    }),
  );
  expect(states.filter((bill) => bill.state === "paid")).toHaveLength(29);
  expect(states.at(-1)).toMatchObject({ id: "treinta-30", paid: 95, state: "partial" });
});
