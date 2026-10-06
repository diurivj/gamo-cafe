import { Effect, Schema } from "effect";

import type { Day, Instant } from "~/shared/day";

import { requireAdmin } from "./current-user";
import { Db, statement, type Condition, type Statement } from "./db";

/**
 * Stock (spec §5.8, ADR 0002). `stock_levels` is a projection: nothing writes
 * it except the statements built here, and they only ever travel in the batch
 * of the fact that moves Stock (a Line, an Adjustment, a Count).
 *
 * An Item with no `stock_levels` row has a Stock of zero.
 */

/**
 * Moves an Item's Stock by a relative amount, negative to lower it. A
 * statement for another operation's batch, next to the fact that causes it:
 *
 *     yield* db.batch([insertLine, changeStock(itemId, -quantity)]);
 *
 * It does nothing to an Item that is not stock-tracked at that moment (spec
 * §5.1), and its `changes` says whether Stock moved. Because the change is
 * relative, two phones moving the same Item's Stock never conflict (§7.3).
 *
 * When the batch has a condition all of its statements share (`Condition`),
 * pass it as `when`, so Stock moves exactly when the rest of the batch does
 * and not when a refused selection would have moved it.
 */
export function changeStock(itemId: string, units: number, when?: Condition): Statement {
  return statement(
    `INSERT INTO stock_levels (item_id, units)
     SELECT id, ? FROM items WHERE id = ? AND stock_tracked = 1${when ? ` AND (${when.sql})` : ""}
     ON CONFLICT (item_id) DO UPDATE SET units = units + excluded.units`,
    units,
    itemId,
    ...(when?.params ?? []),
  );
}

export type AdjustmentReason = "restock" | "waste" | "internal_use";

export interface NewAdjustment {
  readonly id: string;
  readonly itemId: string;
  readonly reason: AdjustmentReason;
  /** A whole number of units, at least 1. */
  readonly units: number;
  readonly note: string | null;
  /** The Admin who records it. */
  readonly by: string;
  readonly at: Instant;
  readonly day: Day;
}

/**
 * The statements that record an Adjustment, for a batch: the fact, then its
 * effect on Stock. Restock adds its units; Waste and Internal use subtract
 * them. For an Item that does not exist or is not stock-tracked, neither
 * statement writes anything, and the `changes` of the first one is 0.
 */
export function adjustmentStatements(adjustment: NewAdjustment): ReadonlyArray<Statement> {
  const { id, itemId, reason, units, note, by, at, day } = adjustment;
  return [
    statement(
      `INSERT INTO adjustments (id, item_id, reason, units, note, recorded_by, recorded_at, day)
       SELECT ?, id, ?, ?, ?, ?, ?, ? FROM items WHERE id = ? AND stock_tracked = 1`,
      id, reason, units, note, by, at, day, itemId,
    ),
    changeStock(itemId, reason === "restock" ? units : -units),
  ];
}

const Units = Schema.Struct({ units: Schema.Int });

/** An Item's Stock. Admins only (spec §4.2). */
export const stockOf = Effect.fn("stockOf")(function* (itemId: string) {
  yield* requireAdmin;
  const db = yield* Db;
  const level = yield* db.first(Units, "SELECT units FROM stock_levels WHERE item_id = ?", itemId);
  return level?.units ?? 0;
});

const Adjustment = Schema.Struct({
  id: Schema.String,
  itemId: Schema.String,
  reason: Schema.Literals(["restock", "waste", "internal_use"]),
  units: Schema.Int,
  note: Schema.NullOr(Schema.String),
  by: Schema.String,
  at: Schema.Int,
  day: Schema.String,
});

export type Adjustment = (typeof Adjustment)["Type"];

/** An Item's Adjustments, oldest first. Admins only. */
export const listAdjustments = Effect.fn("listAdjustments")(function* (itemId: string) {
  yield* requireAdmin;
  const db = yield* Db;
  return yield* db.all(
    Adjustment,
    `SELECT id, item_id AS itemId, reason, units, note, recorded_by AS "by", recorded_at AS at, day
     FROM adjustments WHERE item_id = ? ORDER BY recorded_at, id`,
    itemId,
  );
});
