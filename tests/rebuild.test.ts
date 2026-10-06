import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { editBill, getBill, recordSelection, takePayment } from "~/backend/bills";
import { getItem, updateItem } from "~/backend/catalog";
import { removeLine, voidBill } from "~/backend/corrections";
import { recordCount } from "~/backend/counts";
import { cancelAdjustment, recordAdjustment } from "~/backend/inventory";
import { rebuildProjectionStatements, verifyProjectionsSql, type ProjectionDifference } from "~/backend/rebuild";

import { as, seedUser } from "./support/auth";
import { seedItem } from "./support/catalog";
import { seedCustomer } from "./support/customers";
import { advanceClock, runTest, setClock } from "./support/effect";

// The maintenance command (ticket 19, spec §7.1): every projection is
// recomputed from the facts, so `verify` reports what disagrees with the live
// values and `rebuild` rewrites them. The command is SQL — the very strings
// `scripts/projections.ts` hands to `wrangler d1 execute` — so these tests
// send them to the same real D1 the operations wrote.
//
// Each test starts from an empty database: verify reads every Bill and every
// Stock row, and one test's facts must not be able to differ from another's.

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/** Every difference between the live projections and the facts. */
async function verify(): Promise<ProjectionDifference[]> {
  return (await env.DB.prepare(verifyProjectionsSql).all<ProjectionDifference>()).results;
}

/** Differences in a fixed order, so two lists can be compared by content. */
const ordered = (rows: ReadonlyArray<ProjectionDifference>) =>
  [...rows].sort(
    (a, b) =>
      a.projection.localeCompare(b.projection) ||
      a.id.localeCompare(b.id) ||
      a.field.localeCompare(b.field),
  );

interface BillProjections {
  readonly total: number;
  readonly paid: number;
  readonly state: string;
  readonly customer_id: string | null;
  readonly note: string | null;
}

/** A Bill's live projections, as the screens and the command read them. */
function billProjections(id: string): Promise<BillProjections | null> {
  return env.DB.prepare("SELECT total, paid, state, customer_id, note FROM bills WHERE id = ?")
    .bind(id)
    .first<BillProjections>();
}

/** An Item's live Stock row, or nothing when it has none (Stock of zero). */
function stockRow(itemId: string) {
  return env.DB.prepare("SELECT units, last_counted_at FROM stock_levels WHERE item_id = ?")
    .bind(itemId)
    .first<{ readonly units: number; readonly last_counted_at: number | null }>();
}

/** Runs the command's rebuild as the script does: one statement at a time. */
async function rebuild() {
  const changed: Array<{ label: string; changes: number }> = [];
  for (const { label, sql } of rebuildProjectionStatements) {
    const { meta } = await env.DB.prepare(sql).run();
    changed.push({ label, changes: meta.changes ?? 0 });
  }
  return changed;
}

describe("verify", () => {
  it("finds nothing to fix after a sequence of the operations", async () => {
    await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-06T09:00:00");
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const agua = yield* seedItem({ name: "Agua del rebuild", price: 1500, startingStock: 12, by: ana });
        const pan = yield* seedItem({ name: "Pan del rebuild", price: 800, stockTracked: false, by: ana });
        const clara = yield* seedCustomer("Clara del rebuild");

        const bill = yield* recordSelection({
          items: [{ itemId: agua.id, quantity: 3 }, { itemId: pan.id, quantity: 1 }],
          customerId: clara.id,
        }).pipe(as(beto));
        yield* advanceClock("5 minutes");
        yield* takePayment({ billId: bill.id, amount: 1000, method: "cash", expectedRevision: bill.revision }).pipe(
          as(beto),
        );
        yield* advanceClock("10 minutes");
        yield* recordAdjustment({ itemId: agua.id, reason: "waste", units: 2 }).pipe(as(ana));
        yield* advanceClock("1 hour");
        yield* recordCount({ lines: [{ itemId: agua.id, found: 6 }] }).pipe(as(ana));
        yield* advanceClock("5 minutes");
        yield* editBill({
          billId: bill.id,
          customerId: null,
          note: "Para llevar",
          expectedRevision: 1,
        }).pipe(as(ana));
      }),
    );

    expect(await verify()).toEqual([]);
  });
});

describe("rebuild", () => {
  it("rewrites a Bill whose projections were changed by hand", async () => {
    const { billId, customer } = await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-06T09:00:00");
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const agua = yield* seedItem({ name: "Agua corrompida", price: 1500, startingStock: 12, by: ana });
        const clara = yield* seedCustomer("Clara corrompida");

        const bill = yield* recordSelection({
          items: [{ itemId: agua.id, quantity: 3 }],
          customerId: clara.id,
        }).pipe(as(beto));
        yield* advanceClock("5 minutes");
        yield* takePayment({ billId: bill.id, amount: 1000, method: "cash", expectedRevision: 0 }).pipe(as(beto));
        yield* advanceClock("5 minutes");
        yield* editBill({ billId: bill.id, customerId: null, note: "Sin cliente", expectedRevision: 1 }).pipe(as(ana));
        return { billId: bill.id, customer: clara.id };
      }),
    );

    const live = await billProjections(billId);
    expect(live).toEqual({ total: 4500, paid: 1000, state: "partial", customer_id: null, note: "Sin cliente" });

    await env.DB.prepare(
      "UPDATE bills SET total = 9500, paid = 1, state = 'voided', customer_id = ?, note = 'corrupto' WHERE id = ?",
    )
      .bind(customer, billId)
      .run();

    expect(ordered(await verify())).toEqual(
      ordered([
        { projection: "bill", id: billId, field: "customer_id", live: customer, rebuilt: null },
        { projection: "bill", id: billId, field: "note", live: "corrupto", rebuilt: "Sin cliente" },
        { projection: "bill", id: billId, field: "paid", live: 1, rebuilt: 1000 },
        { projection: "bill", id: billId, field: "state", live: "voided", rebuilt: "partial" },
        { projection: "bill", id: billId, field: "total", live: 9500, rebuilt: 4500 },
      ]),
    );

    expect(await rebuild()).toEqual([
      { label: "Bills", changes: 1 },
      { label: "Stock", changes: 0 },
      { label: "Stock rows without facts", changes: 0 },
    ]);
    expect(await verify()).toEqual([]);
    expect(await billProjections(billId)).toEqual(live);
  });

  it("rewrites a Bill's Customer and note that were never edited, from the facts of its creation", async () => {
    const { billId, customer } = await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-06T09:00:00");
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const agua = yield* seedItem({ name: "Agua sin ediciones", price: 1500, startingStock: 1, by: ana });
        const clara = yield* seedCustomer("Clara sin ediciones");

        // A Bill created for a Customer, and never edited: migration 0019
        // keeps the Customer and the note it was created for as facts, so a
        // projection changed by hand is still detected.
        const bill = yield* recordSelection({
          items: [{ itemId: agua.id, quantity: 1 }],
          customerId: clara.id,
          note: "Mesa 4",
        }).pipe(as(beto));
        return { billId: bill.id, customer: clara.id };
      }),
    );

    expect(await env.DB.prepare("SELECT COUNT(*) AS edits FROM bill_edits WHERE bill_id = ?").bind(billId).first()).toEqual(
      { edits: 0 },
    );
    await env.DB.prepare("UPDATE bills SET customer_id = NULL, note = 'corrupto' WHERE id = ?").bind(billId).run();

    expect(ordered(await verify())).toEqual(
      ordered([
        { projection: "bill", id: billId, field: "customer_id", live: null, rebuilt: customer },
        { projection: "bill", id: billId, field: "note", live: "corrupto", rebuilt: "Mesa 4" },
      ]),
    );

    await rebuild();
    expect(await verify()).toEqual([]);
    expect(await billProjections(billId)).toEqual({
      total: 1500,
      paid: 0,
      state: "open",
      customer_id: customer,
      note: "Mesa 4",
    });
  });

  it("rewrites a Stock row whose units or last Count were changed by hand, and removes a row the facts do not justify", async () => {
    const { agua, pan } = await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-06T09:00:00");
        const ana = yield* seedUser("admin");
        const agua = yield* seedItem({ name: "Agua inventada", price: 1500, startingStock: 12, by: ana });
        const pan = yield* seedItem({ name: "Pan inventado", price: 800, by: ana });

        yield* recordAdjustment({ itemId: agua.id, reason: "waste", units: 2 }).pipe(as(ana));
        yield* advanceClock("10 minutes");
        yield* recordCount({ lines: [{ itemId: agua.id, found: 6 }] }).pipe(as(ana));
        yield* advanceClock("10 minutes");
        yield* recordAdjustment({ itemId: agua.id, reason: "restock", units: 4 }).pipe(as(ana));
        return { agua: agua.id, pan: pan.id };
      }),
    );

    const live = await stockRow(agua);
    expect(live).toEqual({ units: 10, last_counted_at: Date.parse("2026-10-06T09:10:00-06:00") });

    await env.DB.prepare("UPDATE stock_levels SET units = 999, last_counted_at = 1 WHERE item_id = ?")
      .bind(agua)
      .run();
    await env.DB.prepare("INSERT INTO stock_levels (item_id, units) VALUES (?, 7)").bind(pan).run();

    expect(ordered(await verify())).toEqual(
      ordered([
        { projection: "stock", id: agua, field: "last_counted_at", live: 1, rebuilt: live!.last_counted_at },
        { projection: "stock", id: agua, field: "units", live: 999, rebuilt: 10 },
        { projection: "stock", id: pan, field: "units", live: 7, rebuilt: null },
      ]),
    );

    expect(await rebuild()).toEqual([
      { label: "Bills", changes: 0 },
      { label: "Stock", changes: 1 },
      { label: "Stock rows without facts", changes: 1 },
    ]);
    expect(await verify()).toEqual([]);
    expect(await stockRow(agua)).toEqual(live);
    expect(await stockRow(pan)).toBeNull();
  });
});

describe("Stock and the stock-tracking flag", () => {
  it("reverses a cancelled Adjustment even after its Item stopped being tracked", async () => {
    const { agua } = await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-06T09:00:00");
        const ana = yield* seedUser("admin");
        const agua = yield* seedItem({ name: "Agua sin seguimiento", price: 1500, startingStock: 5, by: ana });
        const { id } = yield* recordAdjustment({ itemId: agua.id, reason: "waste", units: 2 }).pipe(as(ana));
        const item = yield* getItem(agua.id).pipe(as(ana));

        yield* advanceClock("1 minute");
        yield* updateItem(agua.id, {
          name: item.name,
          price: item.price,
          categoryId: item.categoryId,
          stockTracked: false,
          minimum: item.minimum,
        }).pipe(as(ana));
        yield* advanceClock("1 minute");
        yield* cancelAdjustment(id, "Captura equivocada").pipe(as(ana));
        return { agua: agua.id };
      }),
    );

    // The Adjustment moved Stock while tracking was on, so its cancellation
    // gives those units back although the flag is off now, and a rebuild from
    // the facts agrees: there is no fact about the flag at that moment and
    // none is needed.
    expect(await stockRow(agua)).toEqual({ units: 5, last_counted_at: null });
    expect(await verify()).toEqual([]);
  });

  it("returns a removed Line's units from the Line's own fact after tracking was switched off", async () => {
    const { billId } = await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-06T09:00:00");
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const agua = yield* seedItem({ name: "Agua quitada tarde", price: 1500, startingStock: 5, by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: agua.id, quantity: 2 }] }).pipe(as(beto));
        const before = yield* getBill(bill.id).pipe(as(beto));
        const item = yield* getItem(agua.id).pipe(as(ana));

        yield* advanceClock("1 minute");
        yield* updateItem(agua.id, {
          name: item.name,
          price: item.price,
          categoryId: item.categoryId,
          stockTracked: false,
          minimum: item.minimum,
        }).pipe(as(ana));
        yield* advanceClock("1 minute");
        yield* removeLine({
          billId: bill.id,
          lineId: before.lines[0]!.id,
          expectedRevision: before.revision,
        }).pipe(as(ana));
        return { billId: bill.id };
      }),
    );

    expect(await verify()).toEqual([]);
    expect(await billProjections(billId)).toMatchObject({ total: 0, paid: 0, state: "paid" });
  });

  it("returns a Voided Bill's units from each Line's own fact, once, and only while tracking was on when it was added", async () => {
    const { agua, pan } = await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-06T09:00:00");
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const agua = yield* seedItem({ name: "Agua anulada", price: 1500, startingStock: 5, by: ana });
        const pan = yield* seedItem({ name: "Pan sin seguimiento al vender", price: 800, by: ana });
        const panItem = yield* getItem(pan.id).pipe(as(ana));

        // Pan stops being tracked before it is sold, so its Line moves no Stock.
        yield* advanceClock("1 minute");
        yield* updateItem(pan.id, {
          name: panItem.name,
          price: panItem.price,
          categoryId: panItem.categoryId,
          stockTracked: false,
          minimum: panItem.minimum,
        }).pipe(as(ana));
        yield* advanceClock("1 minute");
        const bill = yield* recordSelection({
          items: [{ itemId: agua.id, quantity: 2 }, { itemId: pan.id, quantity: 3 }],
        }).pipe(as(beto));
        const aguaItem = yield* getItem(agua.id).pipe(as(ana));

        // Agua stops being tracked before the void; its Line still gives its units back.
        yield* advanceClock("1 minute");
        yield* updateItem(agua.id, {
          name: aguaItem.name,
          price: aguaItem.price,
          categoryId: aguaItem.categoryId,
          stockTracked: false,
          minimum: aguaItem.minimum,
        }).pipe(as(ana));
        yield* advanceClock("1 minute");
        const current = yield* getBill(bill.id).pipe(as(ana));
        yield* voidBill({ billId: bill.id, reason: "Prueba", expectedRevision: current.revision }).pipe(as(ana));
        return { agua: agua.id, pan: pan.id };
      }),
    );

    expect(await stockRow(agua)).toEqual({ units: 5, last_counted_at: null });
    expect(await stockRow(pan)).toBeNull();
    expect(await verify()).toEqual([]);
  });

  it("records no Adjustment at all while its Item is not stock-tracked, and the rebuild agrees", async () => {
    const { agua } = await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-06T09:00:00");
        const ana = yield* seedUser("admin");
        const agua = yield* seedItem({ name: "Agua sin ajustes", price: 1500, startingStock: 3, by: ana });
        const item = yield* getItem(agua.id).pipe(as(ana));

        yield* advanceClock("1 minute");
        yield* updateItem(agua.id, {
          name: item.name,
          price: item.price,
          categoryId: item.categoryId,
          stockTracked: false,
          minimum: item.minimum,
        }).pipe(as(ana));
        const error = yield* Effect.flip(
          recordAdjustment({ itemId: agua.id, reason: "restock", units: 5 }).pipe(as(ana)),
        );

        expect(error._tag).toBe("ItemNotStockTracked");
        return { agua: agua.id };
      }),
    );

    expect(await stockRow(agua)).toEqual({ units: 3, last_counted_at: null });
    expect(await verify()).toEqual([]);
  });
});
