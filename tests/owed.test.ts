import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { recordSelection, takePayment } from "~/backend/bills";
import type { CurrentUser } from "~/backend/current-user";
import { retireCustomer } from "~/backend/customers";
import { Db } from "~/backend/db";
import { listOwed } from "~/backend/owed";

import { as, seedUser } from "./support/auth";
import { seedItem } from "./support/catalog";
import { seedCustomer } from "./support/customers";
import { advanceClock, runTest, setClock } from "./support/effect";

// Por cobrar (spec §5.3, §5.9, §6.2, §4.1). The Owed figure and the row
// budgets are about every Bill in the database, so each test here starts from
// an empty one (as tests/cuentas.test.ts does).
beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/** Sets a Bill's projections the way a Payment or a Void will (tickets 08, 11). */
const markBill = (billId: string, state: "partial" | "paid" | "voided", paid = 0) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* db.run("UPDATE bills SET state = ?, paid = ? WHERE id = ?", state, paid, billId);
  });

describe("listOwed", () => {
  it("gives each Customer what they owe with the Day of their oldest Open Bill, then the Bills with no Customer, and the overall Owed", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-04T12:00:00");
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Producto por cobrar", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia deudora", { by: ana });
        const aparte = yield* seedCustomer("Familia que ya pagó", { by: ana });

        const oldest = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));
        yield* advanceClock("1 day");
        const newer = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 2 }],
          customerId: ruiz.id,
        }).pipe(as(ana));
        // A Payment on the newer Bill: what a Customer owes is the remainder.
        yield* takePayment({
          billId: newer.id,
          amount: 500,
          method: "transfer",
          expectedRevision: newer.revision,
        }).pipe(as(ana));
        const suelto = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));

        // Paid and Voided Bills count for nothing (spec §5.6, §5.9).
        const pagada = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: aparte.id,
        }).pipe(as(ana));
        yield* markBill(pagada.id, "paid", 1000);
        const anulada = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: aparte.id,
        }).pipe(as(ana));
        yield* markBill(anulada.id, "voided");

        const owed = yield* listOwed().pipe(as(ana));

        expect(owed.total).toBe(3500);
        expect(owed.customers).toEqual([
          { customerId: ruiz.id, name: "Familia deudora", owed: 2500, oldestDay: "2026-10-04" },
        ]);
        expect(owed.bills.map((bill) => bill.id)).toEqual([suelto.id]);
        expect(owed.bills[0]).toMatchObject({
          day: "2026-10-05",
          total: 1000,
          paid: 0,
          owed: 1000,
          fromEarlierDay: false,
        });
        expect(oldest.owed).toBe(1000);
        expect(newer.total).toBe(2000);
      }),
    ));

  it("keeps collecting a retired Customer's Open Bills (spec §5.2)", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "De un cliente retirado", price: 1000, by: ana });
        const paco = yield* seedCustomer("Don Paco", { by: ana });
        yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: paco.id,
        }).pipe(as(ana));
        yield* retireCustomer(paco.id).pipe(as(ana));

        const owed = yield* listOwed().pipe(as(ana));

        expect(owed.customers).toMatchObject([
          { customerId: paco.id, name: "Don Paco", owed: 1000, oldestDay: "2026-10-05" },
        ]);
      }),
    ));

  it("flags a Bill with no Customer the next Day, not on its own Day", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T23:50:00");
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Suelta de un día", price: 1000, by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));

        const ownDay = yield* listOwed().pipe(as(ana));
        expect(ownDay.bills).toMatchObject([{ id: bill.id, day: "2026-10-05", fromEarlierDay: false }]);

        yield* advanceClock("15 minutes"); // 00:05, the next Day

        const nextDay = yield* listOwed().pipe(as(ana));
        expect(nextDay.bills).toMatchObject([{ id: bill.id, day: "2026-10-05", fromEarlierDay: true }]);
      }),
    ));

  it("refuses a Worker: the Owed list is Admin only (spec §4.1)", () =>
    runTest(
      Effect.gen(function* () {
        const beto = yield* seedUser("worker");

        expect((yield* Effect.flip(listOwed().pipe(as(beto))))._tag).toBe("AdminOnly");
      }),
    ));
});

/**
 * The D1 binding with counts of what the operation asked of it. `prepare`
 * counts a statement; `all` adds the rows D1 reports reading. The same shape
 * as the counter in tests/cuentas.test.ts.
 */
function countingD1(d1: D1Database) {
  const counter = { statements: 0, rowsRead: 0 };

  const measured = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "all" || property === "run") {
          return async () => {
            const result = await target[property]();
            counter.rowsRead += result.meta.rows_read;
            return result;
          };
        }
        if (property === "bind") {
          return (...params: ReadonlyArray<string | number | null>) => measured(target.bind(...params));
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

/** Runs `listOwed` as this Admin with a D1 that counts what it does. */
async function listed(admin: CurrentUser["Service"]) {
  const { counter, d1 } = countingD1(env.DB);
  const owed = await Effect.runPromise(listOwed().pipe(as(admin), Effect.provide(Db.layer(d1))));
  return { ...counter, owed };
}

describe("Por cobrar reads", () => {
  it("reads the Open Bills, not the Paid and Voided history", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const db = yield* Db;
        const item = yield* seedItem({ name: "Presupuesto de Por cobrar", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia del presupuesto", { by: ana });
        for (let n = 0; n < 3; n++) {
          yield* recordSelection({
            items: [{ itemId: item.id, quantity: 1 }],
            customerId: ruiz.id,
          }).pipe(as(ana));
        }
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));

        const before = yield* Effect.promise(() => listed(ana));
        expect(before.statements).toBeLessThan(5);
        expect(before.owed.customers).toHaveLength(1);
        expect(before.owed.bills).toHaveLength(1);
        expect(before.rowsRead).toBeLessThan(25);

        // 200 Paid and 200 Voided Bills: they are never read (spec §2.4, §7.4).
        for (const state of ["paid", "voided"]) {
          yield* db.run(
            `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 200)
             INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
             SELECT ? || x, '2026-10-04', ?, 1000 + x, NULL, 100, 0, ?, 0 FROM n`,
            `${state}-presupuesto`,
            ana.id,
            state,
          );
        }

        const after = yield* Effect.promise(() => listed(ana));
        expect(after.statements).toBe(before.statements);
        expect(after.owed.total).toBe(before.owed.total);
        expect(after.owed.customers).toEqual(before.owed.customers);
        expect(after.owed.bills).toEqual(before.owed.bills);
        // The same read: 400 more Bills add at most a row or two to the plan.
        expect(after.rowsRead).toBeLessThanOrEqual(before.rowsRead + 2);
      }),
    ));

  it("returns 200 Open Bills reading only about their own rows", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const db = yield* Db;
        const ruiz = yield* seedCustomer("Familia numerosa", { by: ana });
        // 100 Bills of a Customer and 100 with no Customer, all Open.
        for (const customerId of [ruiz.id, null]) {
          yield* db.run(
            `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 100)
             INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
             SELECT ? || x, '2026-10-04', ?, 1000 + x, ?, 100, 0, 'open', 0 FROM n`,
            customerId === null ? "suelta-" : "de-",
            ana.id,
            customerId,
          );
        }

        const measured = yield* Effect.promise(() => listed(ana));

        expect(measured.statements).toBeLessThan(5);
        expect(measured.owed.customers).toHaveLength(1);
        expect(measured.owed.customers[0]).toMatchObject({ owed: 10000, oldestDay: "2026-10-04" });
        expect(measured.owed.bills).toHaveLength(100);
        expect(measured.owed.total).toBe(20000);
        // Rows read are the Open Bills' own rows, not the history's.
        // Under four rows per Open Bill: its index entry, its row and the
        // Customer it belongs to, if any (spec §2.4, §7.4).
        expect(measured.rowsRead).toBeLessThan(200 * 4);
      }),
    ));
});
