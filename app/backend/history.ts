import { Effect, Schema } from "effect";

import { ADJUSTMENT_REASONS, type AdjustmentReason } from "~/shared/adjustment";
import type { Cursor } from "~/shared/cursor";
import type { Instant } from "~/shared/day";
import type { Centavos } from "~/shared/money";
import type { PaymentMethod } from "~/shared/payment";

import type { BillEditField } from "./bills";
import { requireAdmin } from "./current-user";
import { Db, type Param } from "./db";

/**
 * Historial (spec §5.7, §6.2, §7.4, §10.4): the corrections and Adjustments,
 * newest first, 50 per page. Every entry is a fact of its own; the record it
 * corrects is never touched (ADR 0002).
 *
 * The page is a keyset over the union of the six fact tables, each read by
 * its own index on time (`line_removals_by_time`, `payment_removals_by_time`,
 * `bill_voids_by_time`, `bill_edits_by_time`, `adjustments_by_time`,
 * `adjustment_cancellations_by_time`). One statement per table, each with
 * `LIMIT 51`; the merged newest 50 is the page. A page therefore issues a
 * bounded number of statements and reads a bounded number of rows whatever
 * the total history holds (spec §2.4), and entries of different tables
 * interleave in time order, including across page boundaries.
 *
 * The cursor is the last entry of the page: everything strictly older than
 * `(at, id)`, with the id breaking ties so no entry is skipped or repeated.
 */

/** How many entries a page holds (spec §6.2). */
export const HISTORY_PAGE_SIZE = 50;

/** Where the next page starts: the last entry of the page it follows. */
export type HistoryCursor = Cursor;

/** A Line an Admin or a Worker removed from a Bill (spec §5.7). */
export interface RemovedLineEntry {
  readonly kind: "line_removal";
  /** The removal's own id. */
  readonly id: string;
  readonly at: Instant;
  /** The User who removed it. */
  readonly byName: string;
  /** The reason an Admin owes; null when the Bill had no Payment and none was given. */
  readonly reason: string | null;
  readonly billId: string;
  /** The Bill's Customer, its note, or null for neither. */
  readonly billLabel: string | null;
  readonly itemId: string;
  readonly itemName: string;
  readonly quantity: number;
  readonly amount: Centavos;
}

/** A Payment an Admin removed from a Bill (spec §5.7). */
export interface RemovedPaymentEntry {
  readonly kind: "payment_removal";
  readonly id: string;
  readonly at: Instant;
  readonly byName: string;
  readonly reason: string;
  readonly billId: string;
  readonly billLabel: string | null;
  readonly amount: Centavos;
  readonly method: PaymentMethod;
}

/** A Bill an Admin voided (spec §5.7). */
export interface VoidedBillEntry {
  readonly kind: "bill_void";
  readonly id: string;
  readonly at: Instant;
  readonly byName: string;
  readonly reason: string;
  readonly billId: string;
  readonly billLabel: string | null;
  readonly total: Centavos;
}

/** A change to a Bill's Customer or note (spec §5.3, §5.7). */
export interface BillEditEntry {
  readonly kind: "bill_edit";
  readonly id: string;
  readonly at: Instant;
  readonly byName: string;
  readonly billId: string;
  readonly field: BillEditField;
  /** The Customer's name, or the note as it was; null when there was none. */
  readonly previous: string | null;
  /** The Customer's name, or the note as it became; null when it was cleared. */
  readonly next: string | null;
}

/** An Adjustment an Admin recorded on an Item (spec §5.8). */
export interface AdjustmentEntry {
  readonly kind: "adjustment";
  readonly id: string;
  readonly at: Instant;
  readonly byName: string;
  readonly reason: AdjustmentReason;
  readonly units: number;
  readonly note: string | null;
  readonly itemId: string;
  readonly itemName: string;
}

/** An Adjustment an Admin cancelled, with a reason (spec §5.8). */
export interface AdjustmentCancellationEntry {
  readonly kind: "adjustment_cancellation";
  readonly id: string;
  readonly at: Instant;
  readonly byName: string;
  readonly reason: string;
  /** The cancelled Adjustment, as it was recorded. */
  readonly adjustmentId: string;
  readonly adjustmentReason: AdjustmentReason;
  readonly units: number;
  readonly itemId: string;
  readonly itemName: string;
}

export type HistoryEntry =
  | RemovedLineEntry
  | RemovedPaymentEntry
  | VoidedBillEntry
  | BillEditEntry
  | AdjustmentEntry
  | AdjustmentCancellationEntry;

/** One page of History, and where the page after it starts. */
export interface HistoryPage {
  readonly entries: ReadonlyArray<HistoryEntry>;
  /** null when this is the last page. */
  readonly next: HistoryCursor | null;
}

/**
 * The `WHERE` fragment of one fact table's page read: what is older than the
 * cursor, or the same instant with a smaller id. Without a cursor, nothing.
 *
 * The leading `column <= ?` is what lets SQLite seek into the index and scan
 * backwards from the cursor; the `OR` alone is only a filter, and would make
 * it scan the whole index from the newest entry for every page.
 */
function olderThan(column: string, idColumn: string, cursor: HistoryCursor | null) {
  if (cursor === null) return { sql: "", params: [] as ReadonlyArray<Param> };
  return {
    sql: ` AND (${column} <= ? AND (${column} < ? OR (${column} = ? AND ${idColumn} < ?)))`,
    params: [cursor.at, cursor.at, cursor.at, cursor.id] as ReadonlyArray<Param>,
  };
}

/** Newest first; the id breaks ties, as the keyset does. */
const newestFirst = (a: HistoryEntry, b: HistoryEntry) =>
  b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const RemovedLineRow = Schema.Struct({
  id: Schema.String,
  at: Schema.Int,
  byName: Schema.String,
  reason: Schema.NullOr(Schema.String),
  billId: Schema.String,
  billLabel: Schema.NullOr(Schema.String),
  itemId: Schema.String,
  itemName: Schema.String,
  quantity: Schema.Int,
  amount: Schema.Int,
});

const RemovedPaymentRow = Schema.Struct({
  id: Schema.String,
  at: Schema.Int,
  byName: Schema.String,
  reason: Schema.String,
  billId: Schema.String,
  billLabel: Schema.NullOr(Schema.String),
  amount: Schema.Int,
  method: Schema.Literals(["cash", "transfer"]),
});

const VoidedBillRow = Schema.Struct({
  id: Schema.String,
  at: Schema.Int,
  byName: Schema.String,
  reason: Schema.String,
  billId: Schema.String,
  billLabel: Schema.NullOr(Schema.String),
  total: Schema.Int,
});

const BillEditRow = Schema.Struct({
  id: Schema.String,
  at: Schema.Int,
  byName: Schema.String,
  billId: Schema.String,
  field: Schema.Literals(["customer", "note"]),
  previous: Schema.NullOr(Schema.String),
  next: Schema.NullOr(Schema.String),
});

const AdjustmentRow = Schema.Struct({
  id: Schema.String,
  at: Schema.Int,
  byName: Schema.String,
  reason: Schema.Literals(ADJUSTMENT_REASONS),
  units: Schema.Int,
  note: Schema.NullOr(Schema.String),
  itemId: Schema.String,
  itemName: Schema.String,
});

const AdjustmentCancellationRow = Schema.Struct({
  id: Schema.String,
  at: Schema.Int,
  byName: Schema.String,
  reason: Schema.String,
  adjustmentId: Schema.String,
  adjustmentReason: Schema.Literals(ADJUSTMENT_REASONS),
  units: Schema.Int,
  itemId: Schema.String,
  itemName: Schema.String,
});

/**
 * One page of History, newest first. An Admin only: a Worker never sees
 * History (spec §4.1, §4.2).
 */
export const listHistory = Effect.fn("listHistory")(function* (cursor: HistoryCursor | null = null) {
  yield* requireAdmin;
  const db = yield* Db;

  /** One fact table's page: its index on time drives the read, LIMIT 51. */
  const read = <A>(schema: Schema.Decoder<A>, from: string, column: string, idColumn: string) => {
    const keyset = olderThan(column, idColumn, cursor);
    return db.all(
      schema,
      `${from}${keyset.sql}
     ORDER BY ${column} DESC, ${idColumn} DESC
     LIMIT ?`,
      ...keyset.params,
      HISTORY_PAGE_SIZE + 1,
    );
  };

  const removedLines = yield* read(
    RemovedLineRow,
    `SELECT r.id, r.removed_at AS at, u.name AS byName, r.reason,
            l.bill_id AS billId, COALESCE(c.name, b.note) AS billLabel,
            l.item_id AS itemId, i.name AS itemName, l.quantity,
            l.quantity * l.unit_price AS amount
     FROM line_removals r
     JOIN lines l ON l.id = r.line_id
     JOIN bills b ON b.id = l.bill_id
     JOIN items i ON i.id = l.item_id
     JOIN users u ON u.id = r.removed_by
     LEFT JOIN customers c ON c.id = b.customer_id
     WHERE 1 = 1`,
    "r.removed_at",
    "r.id",
  );

  const removedPayments = yield* read(
    RemovedPaymentRow,
    `SELECT r.id, r.removed_at AS at, u.name AS byName, r.reason,
            p.bill_id AS billId, COALESCE(c.name, b.note) AS billLabel,
            p.amount, p.method
     FROM payment_removals r
     JOIN payments p ON p.id = r.payment_id
     JOIN bills b ON b.id = p.bill_id
     JOIN users u ON u.id = r.removed_by
     LEFT JOIN customers c ON c.id = b.customer_id
     WHERE 1 = 1`,
    "r.removed_at",
    "r.id",
  );

  const voidedBills = yield* read(
    VoidedBillRow,
    `SELECT v.id, v.voided_at AS at, u.name AS byName, v.reason,
            b.id AS billId, COALESCE(c.name, b.note) AS billLabel, b.total
     FROM bill_voids v
     JOIN bills b ON b.id = v.bill_id
     JOIN users u ON u.id = v.voided_by
     LEFT JOIN customers c ON c.id = b.customer_id
     WHERE 1 = 1`,
    "v.voided_at",
    "v.id",
  );

  const billEdits = yield* read(
    BillEditRow,
    `SELECT e.id, e.edited_at AS at, u.name AS byName, e.bill_id AS billId, e.field,
            CASE WHEN e.field = 'customer' THEN pc.name ELSE e.previous_value END AS previous,
            CASE WHEN e.field = 'customer' THEN nc.name ELSE e.new_value END AS next
     FROM bill_edits e
     JOIN users u ON u.id = e.edited_by
     LEFT JOIN customers pc ON e.field = 'customer' AND pc.id = e.previous_value
     LEFT JOIN customers nc ON e.field = 'customer' AND nc.id = e.new_value
     WHERE 1 = 1`,
    "e.edited_at",
    "e.id",
  );

  const adjustments = yield* read(
    AdjustmentRow,
    `SELECT a.id, a.recorded_at AS at, u.name AS byName, a.reason, a.units, a.note,
            a.item_id AS itemId, i.name AS itemName
     FROM adjustments a
     JOIN items i ON i.id = a.item_id
     JOIN users u ON u.id = a.recorded_by
     WHERE 1 = 1`,
    "a.recorded_at",
    "a.id",
  );

  const cancellations = yield* read(
    AdjustmentCancellationRow,
    `SELECT c.id, c.cancelled_at AS at, u.name AS byName, c.reason,
            a.id AS adjustmentId, a.reason AS adjustmentReason, a.units,
            a.item_id AS itemId, i.name AS itemName
     FROM adjustment_cancellations c
     JOIN adjustments a ON a.id = c.adjustment_id
     JOIN items i ON i.id = a.item_id
     JOIN users u ON u.id = c.cancelled_by
     WHERE 1 = 1`,
    "c.cancelled_at",
    "c.id",
  );

  const entries: Array<HistoryEntry> = [
    ...removedLines.map((row) => ({ kind: "line_removal", ...row }) as const),
    ...removedPayments.map((row) => ({ kind: "payment_removal", ...row }) as const),
    ...voidedBills.map((row) => ({ kind: "bill_void", ...row }) as const),
    ...billEdits.map((row) => ({ kind: "bill_edit", ...row }) as const),
    ...adjustments.map((row) => ({ kind: "adjustment", ...row }) as const),
    ...cancellations.map((row) => ({ kind: "adjustment_cancellation", ...row }) as const),
  ];
  entries.sort(newestFirst);

  const page = entries.slice(0, HISTORY_PAGE_SIZE);
  const last = page.at(-1);
  return {
    entries: page,
    next: entries.length > HISTORY_PAGE_SIZE && last ? { at: last.at, id: last.id } : null,
  };
});
