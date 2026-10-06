import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { beforeEach, expect, it } from "vitest";

import { editBill, getBill, recordSelection, takePayment } from "~/backend/bills";
import { removeLine, removePayment, voidBill } from "~/backend/corrections";
import { Db } from "~/backend/db";
import {
  HISTORY_PAGE_SIZE,
  type HistoryCursor,
  type HistoryEntry,
  type HistoryPage,
  listHistory,
} from "~/backend/history";
import { cancelAdjustment, recordAdjustment } from "~/backend/inventory";

import { as, seedUser } from "./support/auth";
import { seedItem } from "./support/catalog";
import { seedCustomer } from "./support/customers";
import { advanceClock, runTest, setClock } from "./support/effect";

// Historial's paging and its read budget (spec §2.4, §6.2, §7.4, §10.7). A
// page is a keyset over the union of the six fact tables; these tests need to
// count every entry, so each starts from an empty database.

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type User = Parameters<typeof as>[0];

/**
 * One entry of each of the six kinds, a minute apart: a removed Line, a
 * removed Payment, a Voided Bill, a Customer set, a note set, an Adjustment
 * and its cancellation. `event` moves the clock and remembers what the entry's
 * instant should be.
 */
const performRound = Effect.fnUntraced(function* (
  admin: User,
  worker: User,
  ids: { readonly itemId: string; readonly customerId: string },
  round: number,
  event: (kind: HistoryEntry["kind"]) => Effect.Effect<number>,
) {
  const { itemId, customerId } = ids;

  // A removed Line from a Bill with no Payment: any User, no reason needed.
  const removed = yield* recordSelection({ items: [{ itemId, quantity: 1 }] }).pipe(as(worker));
  const beforeRemoval = yield* getBill(removed.id).pipe(as(admin));
  yield* event("line_removal");
  yield* removeLine({
    billId: removed.id,
    lineId: beforeRemoval.lines[0]!.id,
    expectedRevision: beforeRemoval.revision,
  }).pipe(as(worker));

  // A removed Payment: an Admin, with a reason.
  const paid = yield* recordSelection({ items: [{ itemId, quantity: 1 }] }).pipe(as(worker));
  const beforePayment = yield* getBill(paid.id).pipe(as(admin));
  const payment = yield* takePayment({
    billId: paid.id,
    amount: 500,
    method: "cash",
    expectedRevision: beforePayment.revision,
  }).pipe(as(worker));
  const afterPayment = yield* getBill(paid.id).pipe(as(admin));
  yield* event("payment_removal");
  yield* removePayment({
    billId: paid.id,
    paymentId: payment.id,
    reason: `Se cobró mal (${round})`,
    expectedRevision: afterPayment.revision,
  }).pipe(as(admin));

  // A Voided Bill: an Admin, with a reason.
  const voided = yield* recordSelection({ items: [{ itemId, quantity: 1 }] }).pipe(as(worker));
  const beforeVoid = yield* getBill(voided.id).pipe(as(admin));
  yield* event("bill_void");
  yield* voidBill({
    billId: voided.id,
    reason: `Cuenta de prueba (${round})`,
    expectedRevision: beforeVoid.revision,
  }).pipe(as(admin));

  // A Customer set on a Bill, then a note on another: two `bill_edits` facts.
  const forCustomer = yield* recordSelection({ items: [{ itemId, quantity: 1 }] }).pipe(as(worker));
  const beforeCustomer = yield* getBill(forCustomer.id).pipe(as(admin));
  yield* event("bill_edit");
  yield* editBill({
    billId: forCustomer.id,
    customerId,
    note: null,
    expectedRevision: beforeCustomer.revision,
  }).pipe(as(admin));

  const forNote = yield* recordSelection({ items: [{ itemId, quantity: 1 }] }).pipe(as(worker));
  const beforeNote = yield* getBill(forNote.id).pipe(as(admin));
  yield* event("bill_edit");
  yield* editBill({
    billId: forNote.id,
    customerId: null,
    note: `Nota (${round})`,
    expectedRevision: beforeNote.revision,
  }).pipe(as(admin));

  // An Adjustment, and its cancellation.
  yield* event("adjustment");
  const adjustment = yield* recordAdjustment({ itemId, reason: "restock", units: 2 }).pipe(as(admin));
  yield* event("adjustment_cancellation");
  yield* cancelAdjustment(adjustment.id, `Se contó dos veces (${round})`).pipe(as(admin));
});

it("interleaves the fact tables in time order across page boundaries", () =>
  runTest(
    Effect.gen(function* () {
      const start = Date.parse("2026-10-05T08:00:00-06:00");
      yield* setClock("2026-10-05T08:00:00");
      const ana = yield* seedUser("admin", "Ana");
      const beto = yield* seedUser("worker", "Beto");
      const item = yield* seedItem({ name: "Historial páginas", price: 1000, by: ana });
      const ruiz = yield* seedCustomer("Familia de las páginas", { by: ana });

      let minutes = 0;
      const expected: Array<{ kind: HistoryEntry["kind"]; at: number }> = [];
      const event = (kind: HistoryEntry["kind"]) =>
        Effect.gen(function* () {
          yield* advanceClock("1 minute");
          minutes += 1;
          const at = start + minutes * 60_000;
          expected.push({ kind, at });
          return at;
        });

      // Eight rounds is 56 entries: the second page starts in the middle of
      // the rotation, so the boundary crosses every table.
      for (let round = 0; round < 8; round++) {
        yield* performRound(ana, beto, { itemId: item.id, customerId: ruiz.id }, round, event);
      }

      const seen: Array<{ kind: HistoryEntry["kind"]; at: number }> = [];
      let cursor: HistoryCursor | null = null;
      let pages = 0;
      let more = true;
      while (more) {
        const page: HistoryPage = yield* listHistory(cursor).pipe(as(ana));
        expect(page.entries.length).toBeLessThanOrEqual(HISTORY_PAGE_SIZE);
        seen.push(...page.entries.map(({ kind, at }) => ({ kind, at })));
        cursor = page.next;
        more = cursor !== null;
        pages += 1;
        expect(pages).toBeLessThan(10);
      }

      // Two full pages walked in time order, with nothing skipped or repeated.
      expect(pages).toBe(Math.ceil(expected.length / HISTORY_PAGE_SIZE));
      expect(seen).toEqual([...expected].reverse());
      // The first page alone holds entries of every kind.
      expect(new Set(seen.slice(0, HISTORY_PAGE_SIZE).map((entry) => entry.kind)).size).toBe(6);
    }),
  ));

/**
 * The D1 binding with counts of what the read asked of it, as in
 * tests/cuentas.test.ts: `prepare` counts a statement and `all` adds the rows
 * D1 reports reading.
 */
function countingD1(d1: D1Database) {
  const counter = { statements: 0, rowsRead: 0 };
  const unwrap = new WeakMap<object, D1PreparedStatement>();

  const measured = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapper = new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "all") {
          return async () => {
            const result = await target.all();
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
    unwrap.set(wrapper, statement);
    return wrapper;
  };

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

/** A page read with a D1 that counts what it does. */
async function page(user: User, cursor: HistoryCursor | null) {
  const { counter, d1 } = countingD1(env.DB);
  const result = await Effect.runPromise(
    listHistory(cursor).pipe(as(user), Effect.provide(Db.layer(d1))),
  );
  return { ...counter, page: result };
}

it("issues six statements and reads a bounded number of rows, whatever the history holds", () =>
  runTest(
    Effect.gen(function* () {
      const start = Date.parse("2026-10-05T08:00:00-06:00");
      yield* setClock("2026-10-05T08:00:00");
      const ana = yield* seedUser("admin", "Ana");
      const beto = yield* seedUser("worker", "Beto");
      const item = yield* seedItem({ name: "Historial presupuesto", price: 1000, by: ana });
      const ruiz = yield* seedCustomer("Familia del presupuesto", { by: ana });

      let minutes = 0;
      const event = (kind: HistoryEntry["kind"]) =>
        Effect.gen(function* () {
          yield* advanceClock("1 minute");
          minutes += 1;
          return start + minutes * 60_000;
        });

      // 60 rounds is 420 entries, so every one of the six reads finds at
      // least 51 live entries and both a first page and a page deeper in are
      // full of real entries from every fact table.
      for (let round = 0; round < 60; round++) {
        yield* performRound(ana, beto, { itemId: item.id, customerId: ruiz.id }, round, event);
      }

      const small = yield* Effect.promise(() => page(ana, null));
      expect(small.statements).toBe(6);
      expect(small.page.entries).toHaveLength(HISTORY_PAGE_SIZE);

      // A year of history: 500 old rows in each of the six fact tables, all
      // older than every entry above.
      const db = yield* Db;
      const old = 1_700_000_000_000;
      yield* db.run(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 500)
         INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
         SELECT 'vieja-cuenta-' || x, '2024-01-01', ?, ${old} + x, NULL, 1000, 0, 'open', 0 FROM n`,
        ana.id,
      );
      yield* db.run(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 500)
         INSERT INTO lines (id, bill_id, item_id, quantity, unit_price, moved_stock, added_by, added_at, day)
         SELECT 'vieja-linea-' || x, 'vieja-cuenta-1', ?, 1, 1000, 1, ?, ${old} + x, '2024-01-01' FROM n`,
        item.id,
        ana.id,
      );
      yield* db.run(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 500)
         INSERT INTO line_removals (id, line_id, reason, removed_by, removed_at)
         SELECT 'vieja-baja-' || x, 'vieja-linea-' || x, 'vieja', ?, ${old} + x FROM n`,
        ana.id,
      );
      yield* db.run(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 500)
         INSERT INTO payments (id, bill_id, amount, method, handover_reference, received_by, received_at, day)
         SELECT 'viejo-pago-' || x, 'vieja-cuenta-1', 1, 'cash', NULL, ?, ${old} + x, '2024-01-01' FROM n`,
        ana.id,
      );
      yield* db.run(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 500)
         INSERT INTO payment_removals (id, payment_id, reason, removed_by, removed_at)
         SELECT 'vieja-baja-pago-' || x, 'viejo-pago-' || x, 'vieja', ?, ${old} + x FROM n`,
        ana.id,
      );
      yield* db.run(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 500)
         INSERT INTO bill_edits (id, bill_id, field, previous_value, new_value, edited_by, edited_at)
         SELECT 'vieja-edicion-' || x, 'vieja-cuenta-1', 'note', NULL, 'vieja', ?, ${old} + x FROM n`,
        ana.id,
      );
      yield* db.run(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 500)
         INSERT INTO bill_voids (id, bill_id, reason, voided_by, voided_at)
         SELECT 'vieja-cancelacion-' || x, 'vieja-cuenta-' || x, 'vieja', ?, ${old} + x FROM n`,
        ana.id,
      );
      yield* db.run(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 500)
         INSERT INTO adjustments (id, item_id, reason, units, note, recorded_by, recorded_at, day)
         SELECT 'viejo-ajuste-' || x, ?, 'waste', 1, NULL, ?, ${old} + x, '2024-01-01' FROM n`,
        item.id,
        ana.id,
      );
      yield* db.run(
        `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 500)
         INSERT INTO adjustment_cancellations (id, adjustment_id, cancelled_by, cancelled_at, reason)
         SELECT 'vieja-canc-ajuste-' || x, 'viejo-ajuste-' || x, ?, ${old} + x, 'vieja' FROM n`,
        ana.id,
      );

      // The same page costs the same: the older rows are never reached.
      const grown = yield* Effect.promise(() => page(ana, null));
      expect(grown.statements).toBe(6);
      expect(grown.page.entries).toHaveLength(HISTORY_PAGE_SIZE);
      expect(grown.rowsRead).toBeLessThanOrEqual(small.rowsRead + 50);

      // Twelve pages in, the cursor points at the old rows, and a page still
      // reads only around its own 50 entries.
      let cursor: HistoryCursor | null = null;
      for (let walked = 0; walked < 12; walked++) {
        const next: HistoryPage = yield* listHistory(cursor).pipe(as(ana));
        expect(next.entries).toHaveLength(HISTORY_PAGE_SIZE);
        cursor = next.next;
      }
      const deep = yield* Effect.promise(() => page(ana, cursor!));
      expect(deep.statements).toBe(6);
      expect(deep.page.entries).toHaveLength(HISTORY_PAGE_SIZE);
      expect(deep.rowsRead).toBeLessThanOrEqual(small.rowsRead + 50);
      // Bounded by the six reads and their 51-row limits, not by the tables:
      // one unindexed branch would read at least its 500 rows alone.
      expect(deep.rowsRead).toBeLessThan(1_500);
    }),
  ));

