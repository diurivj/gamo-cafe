import { Data, Effect, Schema } from "effect";

import { ADJUSTMENT_REASONS, type AdjustmentReason } from "~/shared/adjustment";
import type { Day, Instant } from "~/shared/day";
import { newId } from "~/shared/id";
import { trimToNull } from "~/shared/text";

import { ItemNotFound } from "./catalog";
import { CurrentUser, requireAdmin } from "./current-user";
import { Db, statement } from "./db";
import { adjustmentStatements } from "./stock";
import { json, notYetRecorded, recordedAnswer, submissionOf, submissionStatement } from "./submissions";
import { now, today } from "./time";

/**
 * Inventario (spec §5.8, §6.2): an Admin's view of Stock and Minimums, and the
 * Adjustments that move Stock outside of selling. Every operation here starts
 * with `requireAdmin`, because a Worker never sees a Stock number (spec §4.2),
 * except the two of Consumo interno: `internalUseItems` and
 * `recordInternalUse` are any User's (spec §4.1), and neither reads nor
 * answers a Stock.
 *
 * The statements that touch `stock_levels` live in `./stock`; this module is
 * the operations that use them.
 */

/** An Adjustment's units that are not a whole number of one or more. */
export class InvalidAdjustmentUnits extends Data.TaggedError("InvalidAdjustmentUnits")<{}> {}

/** The Item exists but does not count its units, so it has no Stock to adjust. */
export class ItemNotStockTracked extends Data.TaggedError("ItemNotStockTracked")<{}> {}

/** No Adjustment has this id. */
export class AdjustmentNotFound extends Data.TaggedError("AdjustmentNotFound")<{}> {}

/** The Adjustment was already cancelled: cancelling happens once (spec §5.8). */
export class AdjustmentAlreadyCancelled extends Data.TaggedError("AdjustmentAlreadyCancelled")<{}> {}

/** A cancellation without a reason. */
export class ReasonMissing extends Data.TaggedError("ReasonMissing")<{}> {}

const InventoryRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  minimum: Schema.NullOr(Schema.Int),
  stock: Schema.Int,
  retiredAt: Schema.NullOr(Schema.Int),
});

export interface InventoryLine {
  readonly id: string;
  readonly name: string;
  readonly stock: number;
  readonly minimum: number | null;
  readonly retired: boolean;
  /** Stock is at or below its Minimum (spec §5.8). */
  readonly needsRestock: boolean;
  /** Stock is below zero, flagged separately from `needsRestock`. */
  readonly belowZero: boolean;
}

/**
 * Every stock-tracked Item's Stock and Minimum, in name order. Retired Items
 * stay: their Stock is still on the shelf, and Merma may have to be recorded
 * against it. An Item with no `stock_levels` row has a Stock of zero.
 */
export const listInventory = Effect.gen(function* () {
  yield* requireAdmin;
  const db = yield* Db;
  const rows = yield* db.all(
    InventoryRow,
    `SELECT i.id, i.name, i.minimum, i.retired_at AS retiredAt, COALESCE(s.units, 0) AS stock
     FROM items i LEFT JOIN stock_levels s ON s.item_id = i.id
     WHERE i.stock_tracked = 1
     ORDER BY i.normalized_name, i.id`,
  );
  return rows.map(
    ({ retiredAt, ...line }): InventoryLine => ({
      ...line,
      retired: retiredAt !== null,
      needsRestock: line.minimum !== null && line.stock <= line.minimum,
      belowZero: line.stock < 0,
    }),
  );
});

const CountedItemRow = Schema.Struct({ id: Schema.String, name: Schema.String });

/**
 * The Items Consumo interno offers (spec §4.1): every active Item that counts
 * its units, in name order, and nothing of their Stock, so any User may read
 * it. What is left of a retired Item is an Admin's to adjust, on Inventario.
 */
export const internalUseItems = Effect.gen(function* () {
  const db = yield* Db;
  return yield* db.all(
    CountedItemRow,
    `SELECT id, name FROM items
     WHERE stock_tracked = 1 AND retired_at IS NULL
     ORDER BY normalized_name, id`,
  );
});

export interface NewAdjustmentInput {
  readonly itemId: string;
  readonly reason: AdjustmentReason;
  /** A whole number of units, at least 1. */
  readonly units: number;
  /** Trimmed; empty or absent is no note. */
  readonly note?: string | null;
  /**
   * The key of the submission this Adjustment came from, made by the screen
   * at the tap (spec §3.4). A second Adjustment with the same key and content
   * records nothing and is answered as the first.
   */
  readonly submissionKey?: string | null;
}

/** What `recordAdjustment` answers, and what a repeat of its form is answered with. */
const AdjustmentAnswer = Schema.Struct({ id: Schema.String });

/**
 * Records an Adjustment: the fact and its effect on Stock, in one batch
 * (spec §7.3). Restock adds its units; Waste and Internal use subtract them.
 * An Item that is not stock-tracked is refused, and nothing is written. The
 * same form sent twice is recorded once (spec §3.4, `./submissions`).
 */
export const recordAdjustment = Effect.fn("recordAdjustment")(function* (input: NewAdjustmentInput) {
  return yield* adjustmentBy(yield* requireAdmin, input);
});

/** An Internal use as Consumo interno sends it: an Adjustment whose reason is already said. */
export type InternalUseInput = Omit<NewAdjustmentInput, "reason">;

/**
 * Records an Internal use (spec §4.1, §5.8): units of an Item that staff
 * consumed or gave away, taken off its Stock. Any User may, a Worker
 * included, so it asks nobody to be an Admin; and it answers no Stock, which
 * a Worker never sees (spec §4.2). It is `recordAdjustment`'s fact, batch and
 * submission; cancelling one is still an Admin's (`cancelAdjustment`).
 */
export const recordInternalUse = Effect.fn("recordInternalUse")(function* (input: InternalUseInput) {
  return yield* adjustmentBy(yield* CurrentUser, { ...input, reason: "internal_use" });
});

/**
 * What both ways of recording an Adjustment do once they know who records it:
 * the rules, the batch, and one submission per form.
 */
const adjustmentBy = Effect.fnUntraced(function* (author: CurrentUser["Service"], input: NewAdjustmentInput) {
  const db = yield* Db;

  if (!Number.isSafeInteger(input.units) || input.units < 1) return yield* new InvalidAdjustmentUnits();
  const note = trimToNull(input.note);

  const submission = yield* submissionOf("adjustment", author.id, input.submissionKey, [
    input.itemId,
    input.reason,
    input.units,
    note,
  ]);
  const earlier = yield* recordedAnswer(AdjustmentAnswer, submission);
  if (earlier) return earlier;

  const id = newId();
  const at = yield* now;

  // The fact's insert is conditional on the Item being stock-tracked, so its
  // `changes` says whether the Adjustment was recorded.
  const [fact] = yield* db.batch([
    ...adjustmentStatements(
      { id, itemId: input.itemId, reason: input.reason, units: input.units, note, by: author.id, at, day: yield* today },
      notYetRecorded(submission),
    ),
    submissionStatement(submission, {
      at,
      answer: json({ id }),
      wrote: { sql: "EXISTS (SELECT 1 FROM adjustments WHERE id = ?)", params: [id] },
    }),
  ]);

  if (fact!.changes === 0) {
    // Another request with this form's key recorded it meanwhile.
    const meanwhile = yield* recordedAnswer(AdjustmentAnswer, submission);
    if (meanwhile) return meanwhile;
    const item = yield* db.first(
      Schema.Struct({ stockTracked: Schema.Int }),
      "SELECT stock_tracked AS stockTracked FROM items WHERE id = ?",
      input.itemId,
    );
    if (!item) return yield* new ItemNotFound();
    return yield* new ItemNotStockTracked();
  }
  return { id };
});

/**
 * Cancels an Adjustment: the cancellation and the reverse of the Adjustment's
 * effect on Stock, in one batch. It carries a reason and happens once; a
 * second attempt is refused and moves nothing.
 */
export const cancelAdjustment = Effect.fn("cancelAdjustment")(function* (adjustmentId: string, reason: string) {
  const admin = yield* requireAdmin;
  const db = yield* Db;

  const why = trimToNull(reason);
  if (why === null) return yield* new ReasonMissing();
  const id = newId();

  const [cancelled] = yield* db.batch([
    statement(
      `INSERT INTO adjustment_cancellations (id, adjustment_id, cancelled_by, cancelled_at, reason)
       SELECT ?, a.id, ?, ?, ? FROM adjustments a
       WHERE a.id = ? AND NOT EXISTS (
         SELECT 1 FROM adjustment_cancellations c WHERE c.adjustment_id = a.id)`,
      id, admin.id, yield* now, why, adjustmentId,
    ),
    // Reverses only the cancellation this batch wrote (`c.id = ?`), so a
    // second, racing attempt cannot reverse the same Adjustment twice.
    //
    // It reverses the Adjustment's own effect whatever the Item's flag says
    // now: the Adjustment fact only exists when the Item was stock-tracked
    // when it was recorded, and its effect is in the Stock, so the
    // cancellation has to take it out — the same rule a removed Line's units
    // follow (ticket 04's trap, `lineRemovalStock`). Reading the flag at
    // cancellation time would leave a recorded Stock change that no fact
    // explains, which the rebuild (ticket 19) could not reproduce.
    statement(
      `INSERT INTO stock_levels (item_id, units)
       SELECT a.item_id, CASE a.reason WHEN 'restock' THEN -a.units ELSE a.units END
       FROM adjustments a
       JOIN adjustment_cancellations c ON c.id = ? AND c.adjustment_id = a.id
       WHERE a.id = ?
       ON CONFLICT (item_id) DO UPDATE SET units = units + excluded.units`,
      id, adjustmentId,
    ),
  ]);

  if (cancelled!.changes === 0) {
    const state = yield* db.first(
      Schema.Struct({ exists: Schema.Int, alreadyCancelled: Schema.Int }),
      `SELECT (SELECT COUNT(*) FROM adjustments WHERE id = ?) AS "exists",
              (SELECT COUNT(*) FROM adjustment_cancellations WHERE adjustment_id = ?) AS alreadyCancelled`,
      adjustmentId, adjustmentId,
    );
    if (!state || state.exists === 0) return yield* new AdjustmentNotFound();
    return yield* new AdjustmentAlreadyCancelled();
  }
});

const StandingRow = Schema.Struct({
  stock: Schema.Int,
  cancelledBy: Schema.NullOr(Schema.String),
  cancelReason: Schema.NullOr(Schema.String),
});

/**
 * How an Adjustment stands now: its Item's Stock, and who cancelled it and
 * why, when someone did. It is what the
 * route answers a recorded change with, and how it tells a cancellation sent
 * again after its answer was lost from one somebody else made.
 */
export const adjustmentStanding = Effect.fn("adjustmentStanding")(function* (adjustmentId: string) {
  yield* requireAdmin;
  const db = yield* Db;
  const row = yield* db.first(
    StandingRow,
    `SELECT COALESCE(s.units, 0) AS stock, c.cancelled_by AS cancelledBy, c.reason AS cancelReason
     FROM adjustments a
     LEFT JOIN stock_levels s ON s.item_id = a.item_id
     LEFT JOIN adjustment_cancellations c ON c.adjustment_id = a.id
     WHERE a.id = ?`,
    adjustmentId,
  );
  if (!row) return yield* new AdjustmentNotFound();
  return {
    stock: row.stock,
    cancellation: row.cancelledBy === null ? null : { by: row.cancelledBy, reason: row.cancelReason ?? "" },
  };
});

const RecentRow = Schema.Struct({
  id: Schema.String,
  itemId: Schema.String,
  itemName: Schema.String,
  reason: Schema.Literals(ADJUSTMENT_REASONS),
  units: Schema.Int,
  note: Schema.NullOr(Schema.String),
  byName: Schema.String,
  at: Schema.Int,
  day: Schema.String,
  cancelledAt: Schema.NullOr(Schema.Int),
  cancelReason: Schema.NullOr(Schema.String),
  cancelledByName: Schema.NullOr(Schema.String),
});

export interface AdjustmentCancellation {
  readonly reason: string;
  readonly byName: string;
}

export interface RecentAdjustment {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly reason: AdjustmentReason;
  readonly units: number;
  readonly note: string | null;
  /** The User who recorded it: a Worker's Internal use too. */
  readonly byName: string;
  readonly at: Instant;
  readonly day: Day;
  readonly cancellation: AdjustmentCancellation | null;
}

/**
 * The most recent Adjustments, newest first, cancelled ones too. One bounded
 * statement, so Inventario never reads rows in proportion to the history
 * (spec §2.4, §10.7).
 */
export const listRecentAdjustments = Effect.fn("listRecentAdjustments")(function* (limit = 50) {
  yield* requireAdmin;
  const db = yield* Db;
  const rows = yield* db.all(
    RecentRow,
    `SELECT a.id, a.item_id AS itemId, i.name AS itemName, a.reason, a.units, a.note,
            u.name AS byName, a.recorded_at AS at, a.day,
            c.cancelled_at AS cancelledAt, c.reason AS cancelReason, cu.name AS cancelledByName
     FROM adjustments a
     JOIN items i ON i.id = a.item_id
     JOIN users u ON u.id = a.recorded_by
     LEFT JOIN adjustment_cancellations c ON c.adjustment_id = a.id
     LEFT JOIN users cu ON cu.id = c.cancelled_by
     ORDER BY a.recorded_at DESC, a.id DESC
     LIMIT ?`,
    limit,
  );
  return rows.map(
    ({ cancelledAt, cancelReason, cancelledByName, ...row }): RecentAdjustment => ({
      ...row,
      cancellation:
        cancelledAt === null ? null : { reason: cancelReason ?? "", byName: cancelledByName ?? "" },
    }),
  );
});
