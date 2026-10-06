import { Data, Effect, Schema } from "effect";

import { chunk } from "~/shared/chunk";
import type { Cursor } from "~/shared/cursor";
import type { Day, Instant } from "~/shared/day";
import { newId } from "~/shared/id";
import { trimToNull } from "~/shared/text";

import { ItemNotFound } from "./catalog";
import { requireAdmin } from "./current-user";
import { Db } from "./db";
import { ItemNotStockTracked } from "./inventory";
import { countStatements, type CountedLine } from "./stock";
import { now, today } from "./time";

/**
 * Conteo (spec §5.8, §6.2): an Admin's physical tally of the units of some
 * stock-tracked Items. The entry step shows Item names and nothing else; the
 * review computes expected, found and difference; confirming records one batch
 * in which the expected Stock is read at that moment, and Stock then takes the
 * counted value. Every operation here starts with `requireAdmin`: a Worker
 * never sees a Stock number (spec §4.2).
 *
 * Diferencias reads these records: `listCounts`.
 */

/** A Count with no Item to count. */
export class NoItemsCounted extends Data.TaggedError("NoItemsCounted")<{}> {}

/** Units found that are not a whole number of zero or more. */
export class InvalidCountUnits extends Data.TaggedError("InvalidCountUnits")<{}> {}

/** One Item in a Count, as the entry step and the operations read it. */
export interface CountedInput {
  readonly itemId: string;
  /** The units found; zero or more. */
  readonly found: number;
}

/** One line of a Count: the Stock expected when it was read, and the difference. */
export interface CountLine {
  readonly itemId: string;
  readonly itemName: string;
  readonly expected: number;
  readonly found: number;
  /** Found minus expected: negative is Faltante, positive Sobrante (spec §5.8). */
  readonly difference: number;
}

export interface RecordedCount {
  readonly id: string;
  readonly note: string | null;
  readonly byName: string;
  readonly at: Instant;
  readonly day: Day;
  readonly lines: ReadonlyArray<CountLine>;
}

/** An Item as the entry step lists it: its name and nothing about Stock. */
export interface CountItem {
  readonly id: string;
  readonly name: string;
  readonly retired: boolean;
}

export const listCountItems = Effect.gen(function* () {
  yield* requireAdmin;
  const db = yield* Db;
  const rows = yield* db.all(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      retiredAt: Schema.NullOr(Schema.Int),
    }),
    `SELECT id, name, retired_at AS retiredAt FROM items
     WHERE stock_tracked = 1
     ORDER BY normalized_name, id`,
  );
  return rows.map(
    ({ retiredAt, ...line }): CountItem => ({ ...line, retired: retiredAt !== null }),
  );
});

/**
 * The lines of a Count as the Admin submitted them: every Item distinct (a
 * second line for one Item is ignored), units a whole number of zero or more,
 * and at least one Item. Empty: nothing was counted.
 */
const tidyCounted = Effect.fnUntraced(function* (input: ReadonlyArray<CountedInput>) {
  const seen = new Set<string>();
  const lines: Array<CountedInput> = [];
  for (const line of input) {
    if (!Number.isSafeInteger(line.found) || line.found < 0) return yield* new InvalidCountUnits();
    if (seen.has(line.itemId)) continue;
    seen.add(line.itemId);
    lines.push({ itemId: line.itemId, found: line.found });
  }
  if (lines.length === 0) return yield* new NoItemsCounted();
  return lines;
});

const ItemStock = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  stockTracked: Schema.Int,
  stock: Schema.Int,
});

/** How many Item ids one `IN (?, …)` may carry; two bindings of them per query. */
const ITEMS_PER_QUERY = 45;

/** The named Items in the submitted order, with their Stock right now. */
const itemsWithStock = Effect.fnUntraced(function* (itemIds: ReadonlyArray<string>) {
  const db = yield* Db;
  const found = new Map<string, (typeof ItemStock)["Type"]>();
  for (const part of chunk(itemIds, ITEMS_PER_QUERY)) {
    const placeholders = part.map(() => "?").join(", ");
    const rows = yield* db.all(
      ItemStock,
      `SELECT i.id, i.name, i.stock_tracked AS stockTracked, COALESCE(s.units, 0) AS stock
       FROM items i LEFT JOIN stock_levels s ON s.item_id = i.id
       WHERE i.id IN (${placeholders})`,
      ...part,
    );
    for (const row of rows) found.set(row.id, row);
  }
  return found;
});

/**
 * The review step: for each counted Item, its name, the Stock expected now,
 * the units found and the difference (spec §5.8, §8.7). A read: nothing is
 * recorded, and the expected numbers reach the Admin only here.
 */
export const previewCount = Effect.fn("previewCount")(function* (input: ReadonlyArray<CountedInput>) {
  yield* requireAdmin;
  const lines = yield* tidyCounted(input);
  const items = yield* itemsWithStock(lines.map((line) => line.itemId));

  const preview: Array<CountLine> = [];
  for (const line of lines) {
    const item = items.get(line.itemId);
    if (!item) return yield* new ItemNotFound();
    if (item.stockTracked !== 1) return yield* new ItemNotStockTracked();
    preview.push({
      itemId: line.itemId,
      itemName: item.name,
      expected: item.stock,
      found: line.found,
      difference: line.found - item.stock,
    });
  }
  return preview;
});

export interface NewCountInput {
  readonly lines: ReadonlyArray<CountedInput>;
  /** Trimmed; empty or absent is no note. */
  readonly note?: string | null;
}

/**
 * Records a Count: one batch of multi-row statements (spec §7.3). Per Item,
 * the Stock expected is read inside the batch, then Stock takes the units
 * found and `last_counted_at` becomes this Count's instant. A Discrepancy of
 * zero is recorded like any other. An Item that does not exist, or does not
 * count its units, is refused and nothing is written.
 */
export const recordCount = Effect.fn("recordCount")(function* (input: NewCountInput) {
  const admin = yield* requireAdmin;
  const db = yield* Db;

  const lines = yield* tidyCounted(input.lines);
  const note = trimToNull(input.note);
  const id = newId();

  const [recorded] = yield* db.batch(
    countStatements({
      id,
      note,
      by: admin.id,
      at: yield* now,
      day: yield* today,
      lines: lines.map((line): CountedLine => ({ ...line, id: newId() })),
    }),
  );

  if (recorded!.changes === 0) {
    // The Count's insert wrote nothing because an Item was missing or not
    // stock-tracked; one bounded read says which.
    for (const part of chunk(lines, ITEMS_PER_QUERY)) {
      const placeholders = part.map(() => "?").join(", ");
      const row = yield* db.first(
        Schema.Struct({ existing: Schema.Int, tracked: Schema.Int }),
        `SELECT (SELECT COUNT(*) FROM items WHERE id IN (${placeholders})) AS existing,
                (SELECT COUNT(*) FROM items WHERE stock_tracked = 1 AND id IN (${placeholders})) AS tracked`,
        ...part.map((line) => line.itemId),
        ...part.map((line) => line.itemId),
      );
      if (row === undefined || row.existing < part.length) return yield* new ItemNotFound();
      if (row.tracked < part.length) return yield* new ItemNotStockTracked();
    }
    // Every Item was countable, so the insert cannot have written nothing.
    return yield* Effect.die(new Error("recordCount: nothing was written although every Item was countable"));
  }
  return { id };
});

/**
 * How many Counts one page of Diferencias holds. A Count has a line per Item
 * counted, so a few of them are already a long page (spec §2.4, §3.4).
 */
export const COUNTS_PER_PAGE = 3;

/** One page of Counts, newest first, and where the page after it starts. */
export interface CountPage {
  readonly counts: ReadonlyArray<RecordedCount>;
  /** null when this is the last page. */
  readonly next: Cursor | null;
}

const CountRow = Schema.Struct({
  id: Schema.String,
  note: Schema.NullOr(Schema.String),
  byName: Schema.String,
  at: Schema.Int,
  day: Schema.String,
});

const CountLineRow = Schema.Struct({
  countId: Schema.String,
  itemId: Schema.String,
  itemName: Schema.String,
  expected: Schema.Int,
  found: Schema.Int,
});

/**
 * One page of Counts, newest first, each with its lines in name order:
 * Diferencias (spec §6.2). Two statements: the page's Counts by
 * `counts_by_time`, seeking to the cursor — the last Count of the page before,
 * its id breaking ties — and then their lines. A page reads about its own
 * rows, whatever was ever counted (spec §2.4).
 */
export const listCounts = Effect.fn("listCounts")(function* (
  cursor: Cursor | null = null,
  limit = COUNTS_PER_PAGE,
) {
  yield* requireAdmin;
  const db = yield* Db;

  const read = yield* db.all(
    CountRow,
    `SELECT c.id, c.note, u.name AS byName, c.recorded_at AS at, c.day
     FROM counts c JOIN users u ON u.id = c.recorded_by
     ${cursor === null ? "" : "WHERE c.recorded_at <= ? AND (c.recorded_at < ? OR c.id < ?)"}
     ORDER BY c.recorded_at DESC, c.id DESC
     LIMIT ?`,
    ...(cursor === null ? [] : [cursor.at, cursor.at, cursor.id]),
    limit + 1,
  );
  const counts = read.slice(0, limit);
  const last = counts.at(-1);
  const next: Cursor | null = read.length > limit && last ? { at: last.at, id: last.id } : null;
  if (counts.length === 0) return { counts: [], next } as CountPage;

  const placeholders = counts.map(() => "?").join(", ");
  const rows = yield* db.all(
    CountLineRow,
    `SELECT cl.count_id AS countId, cl.item_id AS itemId, i.name AS itemName,
            cl.units_expected AS expected, cl.units_found AS found
     FROM count_lines cl JOIN items i ON i.id = cl.item_id
     WHERE cl.count_id IN (${placeholders})
     ORDER BY i.normalized_name, i.id`,
    ...counts.map((count) => count.id),
  );

  const listed = counts.map(
    (count): RecordedCount => ({
      ...count,
      lines: rows
        .filter((row) => row.countId === count.id)
        .map(
          ({ countId, ...line }): CountLine => ({
            ...line,
            difference: line.found - line.expected,
          }),
        ),
    }),
  );
  return { counts: listed, next } as CountPage;
});
