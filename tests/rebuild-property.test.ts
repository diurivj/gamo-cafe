import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect, Exit } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import {
  editBill,
  getBill,
  listCustomerOpenBills,
  listOpenBills,
  recordSelection,
  takeCustomerPayment,
  takePayment,
} from "~/backend/bills";
import { type CatalogItem, getItem, updateItem } from "~/backend/catalog";
import { removeLine, removePayment, voidBill } from "~/backend/corrections";
import { recordCount } from "~/backend/counts";
import { cancelAdjustment, listRecentAdjustments, recordAdjustment } from "~/backend/inventory";
import { rebuildProjectionStatements, verifyProjectionsSql } from "~/backend/rebuild";

import { as, seedUser } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { seedCustomer } from "./support/customers";
import { advanceClock, runTest, setClock } from "./support/effect";

// The rebuild has to agree with the live projections after ANY sequence of
// the operations (ticket 19, spec §10.5): random sequences of selections,
// Payments, Abonar, removals, voids, edits, Adjustments, cancellations,
// Counts and stock-tracking toggles. Each seed is played out through the real
// operations on a real local D1, then the command's own SQL — the strings
// scripts/projections.ts hands to production — is run against it: verify
// finds nothing, a hand-corrupted projection is detected, the rebuild fixes
// it, and the projections are byte-for-byte what the operations left.
//
// The sequences are deterministic (a seeded PRNG) so a failure can be
// replayed; each test starts from an empty database.

const SEEDS = [1, 2, 3, 4, 5, 6];

/** How many operations one sequence plays out. */
const STEPS = 60;

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type Random = () => number;

/** mulberry32: the same seed replays the same sequence. */
function makeRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

const below = (rand: Random, count: number) => Math.floor(rand() * count);
const pick = <A>(rand: Random, list: ReadonlyArray<A>): A => list[below(rand, list.length)]!;
const chance = (rand: Random, probability: number) => rand() < probability;

/** The kinds of operation a sequence plays with, and how often. */
const OPERATIONS = [
  "selection",
  "payment",
  "abonar",
  "removeLine",
  "removePayment",
  "void",
  "edit",
  "adjustment",
  "cancellation",
  "count",
  "toggle",
] as const;
type Operation = (typeof OPERATIONS)[number];

const WEIGHTS: ReadonlyArray<[Operation, number]> = [
  ["selection", 20],
  ["payment", 12],
  ["abonar", 7],
  ["removeLine", 9],
  ["removePayment", 4],
  ["void", 5],
  ["edit", 7],
  ["adjustment", 9],
  ["cancellation", 6],
  ["count", 6],
  ["toggle", 5],
];

function nextOperation(rand: Random): Operation {
  const total = WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [operation, weight] of WEIGHTS) {
    roll -= weight;
    if (roll < 0) return operation;
  }
  return "selection";
}

async function verifyProjections() {
  return (await env.DB.prepare(verifyProjectionsSql).all()).results;
}

async function rebuildProjections() {
  for (const { sql } of rebuildProjectionStatements) await env.DB.prepare(sql).run();
}

/** Everything the command recomputes, as it lives now. */
async function snapshot() {
  const bills = (await env.DB.prepare("SELECT id, total, paid, state, customer_id, note FROM bills ORDER BY id").all())
    .results;
  const stock = (
    await env.DB.prepare("SELECT item_id, units, last_counted_at FROM stock_levels ORDER BY item_id").all()
  ).results;
  return { bills, stock };
}

describe("the rebuild after random sequences", () => {
  for (const seed of SEEDS) {
    it(`agrees with the live projections after the sequence of seed ${seed}`, async () => {
      const { played, failures, bills } = await runTest(
        Effect.gen(function* () {
          const rand = makeRandom(seed);
          yield* setClock("2026-10-06T08:00:00");
          const ana = yield* seedUser("admin");
          const beto = yield* seedUser("worker", "Beto");
          const category = yield* seedCategory("Secuencia", ana);
          const items: Array<string> = [];
          const prices = new Map<string, number>();
          for (let index = 0; index < 4; index += 1) {
            const price = 500 + index * 250;
            const item = yield* seedItem({
              name: `Secuencia ${seed}-${index}`,
              categoryId: category.id,
              price,
              startingStock: 6,
              by: ana,
            });
            items.push(item.id);
            prices.set(item.id, price);
          }
          const prepared = yield* seedItem({
            name: `Secuencia ${seed}-preparado`,
            categoryId: category.id,
            price: 900,
            stockTracked: false,
            by: ana,
          });
          items.push(prepared.id);
          prices.set(prepared.id, 900);
          const customers = [
            (yield* seedCustomer(`Secuencia ${seed} A`)).id,
            (yield* seedCustomer(`Secuencia ${seed} B`, { by: beto })).id,
          ];
          const billIds: Array<string> = [];
          const voidedBills = new Set<string>();
          const played = new Map<Operation, number>(OPERATIONS.map((operation) => [operation, 0]));

          // Every operation is played at least once (the acceptance criterion
          // lists them all), in a random order and with a random frequency on
          // top: three rounds of all of them, then as many extras as STEPS
          // allows, all shuffled together.
          const operations: Array<Operation> = [];
          for (let round = 0; round < 3; round += 1) operations.push(...OPERATIONS);
          while (operations.length < STEPS) operations.push(nextOperation(rand));
          for (let at = operations.length - 1; at > 0; at -= 1) {
            const other = below(rand, at + 1);
            [operations[at], operations[other]] = [operations[other]!, operations[at]!];
          }

          /** The Item as it is now, with whatever the toggles did to it. */
          const readItem = (itemId: string) => getItem(itemId).pipe(as(ana));
          const trackedItems = (all: ReadonlyArray<CatalogItem>) => all.filter((item) => item.stockTracked);

          const failures = new Map<Operation, string>();
          for (const operation of operations) {
            yield* advanceClock(1 + below(rand, 60));
            const actor = chance(rand, 0.3) ? beto : ana;
            const method = chance(rand, 0.5) ? "cash" : "transfer";
            let outcome: Exit.Exit<unknown, unknown>;
            switch (operation) {
              case "selection": {
                const chosen = [
                  { itemId: pick(rand, items), quantity: 1 + below(rand, 3) },
                  ...(chance(rand, 0.4) ? [{ itemId: pick(rand, items), quantity: 1 + below(rand, 2) }] : []),
                ];
                const open = (yield* listOpenBills()).bills;
                // Onto an Open Bill sometimes; otherwise routed by Customer or
                // started fresh, as Vender does.
                const target = open.length > 0 && chance(rand, 0.3) ? pick(rand, open) : null;
                const customerId = target === null && chance(rand, 0.5) ? pick(rand, customers) : undefined;
                const total = chosen.reduce(
                  (sum, line) => sum + (prices.get(line.itemId) ?? 0) * line.quantity,
                  0,
                );
                const payment = chance(rand, 0.3)
                  ? { method: chance(rand, 0.5) ? ("cash" as const) : ("transfer" as const), amount: 1 + below(rand, total) }
                  : null;
                const selected = yield* Effect.exit(
                  recordSelection({
                    items: chosen,
                    ...(target ? { billId: target.id } : {}),
                    ...(customerId ? { customerId } : {}),
                    payment,
                  }).pipe(as(actor)),
                );
                outcome = selected;
                if (Exit.isSuccess(selected)) {
                  const created = selected.value as { id: string };
                  if (!billIds.includes(created.id)) billIds.push(created.id);
                }
                break;
              }
              case "payment": {
                const open = (yield* listOpenBills()).bills.filter((bill) => bill.owed > 0);
                if (open.length === 0) {
                  outcome = Exit.succeed(undefined);
                  break;
                }
                const bill = pick(rand, open);
                outcome = yield* Effect.exit(
                  takePayment({
                    billId: bill.id,
                    amount: 1 + below(rand, bill.owed),
                    method,
                    expectedRevision: bill.revision,
                  }).pipe(as(actor)),
                );
                break;
              }
              case "abonar": {
                const customerId = pick(rand, customers);
                const owed = yield* listCustomerOpenBills(customerId);
                if (owed.length === 0) {
                  outcome = Exit.succeed(undefined);
                  break;
                }
                const total = owed.reduce((sum, bill) => sum + bill.owed, 0);
                outcome = yield* Effect.exit(
                  takeCustomerPayment({
                    customerId,
                    amount: 1 + below(rand, total),
                    method,
                    expectedRevisions: owed.map((bill) => ({ billId: bill.id, revision: bill.revision })),
                  }).pipe(as(actor)),
                );
                break;
              }
              case "removeLine": {
                const open = (yield* listOpenBills()).bills;
                if (open.length === 0) {
                  outcome = Exit.succeed(undefined);
                  break;
                }
                const bill = yield* getBill(pick(rand, open).id).pipe(as(ana));
                const lines = bill.lines.filter((line) => line.removal === null);
                if (lines.length === 0) {
                  outcome = Exit.succeed(undefined);
                  break;
                }
                outcome = yield* Effect.exit(
                  removeLine({
                    billId: bill.id,
                    lineId: pick(rand, lines).id,
                    reason: "Cambio",
                    expectedRevision: bill.revision,
                  }).pipe(as(actor)),
                );
                break;
              }
              case "removePayment": {
                if (billIds.length === 0) {
                  outcome = Exit.succeed(undefined);
                  break;
                }
                const bill = yield* getBill(pick(rand, billIds)).pipe(as(ana));
                const payments = bill.payments.filter((payment) => payment.removal === null);
                if (payments.length === 0) {
                  outcome = Exit.succeed(undefined);
                  break;
                }
                outcome = yield* Effect.exit(
                  removePayment({
                    billId: bill.id,
                    paymentId: pick(rand, payments).id,
                    reason: "Error",
                    expectedRevision: bill.revision,
                  }).pipe(as(ana)),
                );
                break;
              }
              case "void": {
                const target = billIds.filter((billId) => !voidedBills.has(billId));
                if (target.length === 0) {
                  outcome = Exit.succeed(undefined);
                  break;
                }
                const billId = pick(rand, target);
                const bill = yield* getBill(billId).pipe(as(ana));
                outcome = yield* Effect.exit(
                  voidBill({ billId, reason: "Prueba", expectedRevision: bill.revision }).pipe(as(ana)),
                );
                if (Exit.isSuccess(outcome)) voidedBills.add(billId);
                break;
              }
              case "edit": {
                const target = billIds.filter((billId) => !voidedBills.has(billId));
                if (target.length === 0) {
                  outcome = Exit.succeed(undefined);
                  break;
                }
                const before = yield* getBill(pick(rand, target)).pipe(as(ana));
                const customerId = chance(rand, 0.3) ? null : pick(rand, customers);
                const note = chance(rand, 0.5) ? `Nota ${operation}` : null;
                // A Bill with a Payment takes an Admin for an edit (spec §4.1).
                const editor = before.paid > 0 ? ana : actor;
                outcome = yield* Effect.exit(
                  editBill({ billId: before.id, customerId, note, expectedRevision: before.revision }).pipe(as(editor)),
                );
                break;
              }
              case "adjustment": {
                const all = yield* Effect.all(items.map((itemId) => readItem(itemId)));
                const tracked = trackedItems(all);
                if (tracked.length === 0) {
                  outcome = Exit.succeed(undefined);
                  break;
                }
                outcome = yield* Effect.exit(
                  recordAdjustment({
                    itemId: pick(rand, tracked).id,
                    reason: pick(rand, ["restock", "waste", "internal_use"] as const),
                    units: 1 + below(rand, 5),
                  }).pipe(as(ana)),
                );
                break;
              }
              case "cancellation": {
                const recent = yield* listRecentAdjustments(100).pipe(as(ana));
                const open = recent.filter((adjustment) => adjustment.cancellation === null);
                if (open.length === 0) {
                  outcome = Exit.succeed(undefined);
                  break;
                }
                outcome = yield* Effect.exit(
                  cancelAdjustment(pick(rand, open).id, "Corrección").pipe(as(ana)),
                );
                break;
              }
              case "count": {
                let all = yield* Effect.all(items.map((itemId) => readItem(itemId)));
                let tracked = trackedItems(all);
                // With every Item untracked there is nothing to count; the
                // Admin switches one back on, as they would in the app.
                if (tracked.length === 0) {
                  const item = pick(rand, all);
                  yield* Effect.exit(updateItem(item.id, { ...item, stockTracked: true }).pipe(as(ana)));
                  all = yield* Effect.all(items.map((itemId) => readItem(itemId)));
                  tracked = trackedItems(all);
                }
                const count = 1 + below(rand, tracked.length);
                const lines = [...tracked].sort(() => rand() - 0.5).slice(0, count);
                outcome = yield* Effect.exit(
                  recordCount({
                    lines: lines.map((item) => ({ itemId: item.id, found: below(rand, 9) })),
                  }).pipe(as(ana)),
                );
                break;
              }
              case "toggle": {
                const item = yield* readItem(pick(rand, items));
                outcome = yield* Effect.exit(
                  updateItem(item.id, { ...item, stockTracked: !item.stockTracked }).pipe(as(ana)),
                );
                break;
              }
            }
            if (Exit.isSuccess(outcome)) played.set(operation, played.get(operation)! + 1);
            else if (!failures.has(operation)) failures.set(operation, String(outcome.cause));
          }

          return { played, failures, bills: billIds };
        }),
      );

      // Every kind of operation the acceptance criterion lists really happened.
      expect([...played].filter(([, count]) => count === 0), JSON.stringify([...failures])).toEqual([]);
      expect(bills.length).toBeGreaterThan(0);

      // The operations left projections the facts explain exactly.
      expect(await verifyProjections()).toEqual([]);
      const before = await snapshot();

      // Corrupt a Bill's projections and a Stock row by hand.
      const bill = before.bills[0] as { id: string };
      await env.DB.prepare(
        "UPDATE bills SET total = total + 900, note = 'corrupto', state = CASE WHEN state = 'voided' THEN 'paid' ELSE 'voided' END WHERE id = ?",
      )
        .bind(bill.id)
        .run();
      if (before.stock.length > 0) {
        const row = before.stock[0] as { item_id: string };
        await env.DB.prepare("UPDATE stock_levels SET units = units + 1000, last_counted_at = 1 WHERE item_id = ?")
          .bind(row.item_id)
          .run();
      } else {
        const item = (await env.DB.prepare("SELECT id FROM items WHERE stock_tracked = 0 LIMIT 1").first<{ id: string }>())!;
        await env.DB.prepare("INSERT INTO stock_levels (item_id, units, last_counted_at) VALUES (?, 4, 1)")
          .bind(item.id)
          .run();
      }
      expect((await verifyProjections()).length).toBeGreaterThan(0);

      // The rebuild fixes every difference, and changes nothing else.
      await rebuildProjections();
      expect(await verifyProjections()).toEqual([]);
      expect(await snapshot()).toEqual(before);
    });
  }
});
