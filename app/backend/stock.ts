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

/**
 * Puts a removed Line's units back, for the batch that records its removal:
 * one statement, keyed by the `line_removals` row the same batch writes, so
 * nothing moves when the removal was refused.
 *
 * It reads the Line's own `moved_stock` fact and not the Item's flag today: a
 * Line that moved Stock when it was added gives its units back even if
 * tracking was switched off since (spec §5.1, ticket 04's trap). That is what
 * rebuilding Stock from the facts does too (ticket 19): a removed Line stops
 * counting, whether or not its Item is tracked now.
 */
export function lineRemovalStock(removalId: string): Statement {
  return statement(
    `INSERT INTO stock_levels (item_id, units)
     SELECT l.item_id, l.quantity
     FROM lines l JOIN line_removals r ON r.line_id = l.id
     WHERE r.id = ? AND l.moved_stock = 1
     ON CONFLICT (item_id) DO UPDATE SET units = units + excluded.units`,
    removalId,
  );
}

/**
 * Puts back the units of every Line of a Voided Bill that still counts, for
 * the batch that records the void: one multi-row statement, keyed by the
 * `bill_voids` row the same batch writes, so nothing moves when the void was
 * refused. Lines that were already removed are left out — their units came
 * back with their own removal and must not return twice (spec §5.7) — and so
 * are Lines that never moved Stock (spec §5.8).
 */
export function billVoidStock(voidId: string): Statement {
  return statement(
    `INSERT INTO stock_levels (item_id, units)
     SELECT l.item_id, SUM(l.quantity)
     FROM lines l
     JOIN bill_voids v ON v.bill_id = l.bill_id
     LEFT JOIN line_removals r ON r.line_id = l.id
     WHERE v.id = ? AND r.id IS NULL AND l.moved_stock = 1
     GROUP BY l.item_id
     ON CONFLICT (item_id) DO UPDATE SET units = units + excluded.units`,
    voidId,
  );
}

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

const LastCounted = Schema.Struct({ lastCountedAt: Schema.NullOr(Schema.Int) });

/** When an Item was last counted, or `null` when it never was. Admins only. */
export const lastCountedAt = Effect.fn("lastCountedAt")(function* (itemId: string) {
  yield* requireAdmin;
  const db = yield* Db;
  const level = yield* db.first(
    LastCounted,
    "SELECT last_counted_at AS lastCountedAt FROM stock_levels WHERE item_id = ?",
    itemId,
  );
  return level?.lastCountedAt ?? null;
});

/** One Item's line of a Count, with the id of the `count_lines` row to write. */
export interface CountedLine {
  readonly id: string;
  readonly itemId: string;
  /** The units found on the shelf; zero or more. */
  readonly found: number;
}

/** A Count to record, for `countStatements`. Every `lines` Item is distinct. */
export interface NewCount {
  readonly id: string;
  readonly note: string | null;
  /** The Admin who records it. */
  readonly by: string;
  readonly at: Instant;
  readonly day: Day;
  readonly lines: ReadonlyArray<CountedLine>;
}

/**
 * How many lines one statement carries. Each line binds three parameters and
 * each statement binds two more, so 32 stays under D1's 100 bound parameters
 * per query (spec §2.4) with room to spare; a Count of every Item is then a
 * handful of statements, well under the 50 a request may issue.
 */
const COUNTED_LINES_PER_STATEMENT = 32;

function chunk<A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> {
  const parts: Array<ReadonlyArray<A>> = [];
  for (let at = 0; at < items.length; at += size) parts.push(items.slice(at, at + size));
  return parts;
}

const rowsOf = (size: number) => Array.from({ length: size }, () => "(?, ?, ?)").join(", ");

/**
 * The statements that record a Count, for a batch: the fact, then per Item the
 * line and the Stock it sets. The Stock expected is read from `stock_levels`
 * INSIDE the batch, in the same statement that writes the line and before any
 * Stock moves, so it is the Stock of the moment of confirming even when the
 * review page showed another number (spec §5.8).
 *
 * The Count's insert is conditional on every Item existing and being
 * stock-tracked; when it writes nothing, the lines and Stock statements do
 * nothing either, because they join the Count the first statement would have
 * written. Its `changes` says whether the Count was recorded.
 */
export function countStatements(count: NewCount): ReadonlyArray<Statement> {
  const { id, note, by, at, day, lines } = count;
  const parts = chunk(lines, COUNTED_LINES_PER_STATEMENT);
  const itemIds = JSON.stringify(lines.map((line) => line.itemId));

  return [
    // json_each carries the whole set of Items as one parameter, so the
    // condition stays under the parameter limit however many Items are counted.
    statement(
      `INSERT INTO counts (id, note, recorded_by, recorded_at, day)
       SELECT ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM json_each(?) AS j
              JOIN items i ON i.id = j.value AND i.stock_tracked = 1) = ?`,
      id, note, by, at, day, itemIds, lines.length,
    ),
    ...parts.map((part) =>
      statement(
        `INSERT INTO count_lines (id, count_id, item_id, units_expected, units_found)
         SELECT v.column1, ?, v.column2, COALESCE(s.units, 0), v.column3
         FROM (VALUES ${rowsOf(part.length)}) AS v
         JOIN counts c ON c.id = ?
         LEFT JOIN stock_levels s ON s.item_id = v.column2`,
        id,
        ...part.flatMap((line) => [line.id, line.itemId, line.found]),
        id,
      ),
    ),
    ...parts.map((part) =>
      statement(
        `INSERT INTO stock_levels (item_id, units, last_counted_at)
         SELECT v.column2, v.column3, ?
         FROM (VALUES ${rowsOf(part.length)}) AS v
         JOIN counts c ON c.id = ?
         WHERE c.recorded_at IS NOT NULL
         ON CONFLICT (item_id) DO UPDATE SET units = excluded.units, last_counted_at = excluded.last_counted_at`,
        at,
        ...part.flatMap((line) => [line.id, line.itemId, line.found]),
        id,
      ),
    ),
  ];
}

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
