import { Effect, Schema } from "effect";

import type { Cursor } from "~/shared/cursor";
import type { Day } from "~/shared/day";
import type { Centavos } from "~/shared/money";

import { requireAdmin } from "./current-user";
import { Db, type Param } from "./db";
import { today } from "./time";

/**
 * Por cobrar (spec §5.3, §5.9, §6.2): what each Customer owes and the Day of
 * their oldest Open Bill, then the Open Bills with no Customer, flagged when
 * they are still Open on a later Day than they were opened on. Admin only
 * (spec §4.1).
 *
 * Index-driven reads over `bills_by_state`. The rows read are the Open Bills
 * themselves, so they are proportional to the Open Bills and never to the
 * Paid or Voided history (spec §2.4, §7.4).
 */

/** One Customer and what their Open Bills still owe (spec §5.2, §5.9). */
export interface OwedCustomer {
  readonly customerId: string;
  readonly name: string;
  readonly owed: Centavos;
  /** The Day of their oldest Open Bill. */
  readonly oldestDay: Day;
}

/** One Open Bill with no Customer, as the list flags it (spec §5.3). */
export interface OwedBill {
  readonly id: string;
  readonly day: Day;
  /** What was written on it when it was left Open: all that says whose it is. */
  readonly note: string | null;
  readonly total: Centavos;
  readonly paid: Centavos;
  readonly owed: Centavos;
  /** Still Open on a later Day than the one it was opened on. */
  readonly fromEarlierDay: boolean;
}

/** How many Open Bills with no Customer one page of Por cobrar holds. */
export const OWED_BILLS_PER_PAGE = 50;

/**
 * The Owed list: the overall figure, then the Customers, then one page of the
 * loose Bills and where the page after it starts.
 */
export interface Owed {
  readonly total: Centavos;
  readonly customers: ReadonlyArray<OwedCustomer>;
  readonly bills: ReadonlyArray<OwedBill>;
  /** null when this is the last page of `bills`. */
  readonly next: Cursor | null;
}

const OwedGroup = Schema.Struct({
  customerId: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  normalizedName: Schema.NullOr(Schema.String),
  owed: Schema.Int,
  oldestDay: Schema.String,
});

const LooseRow = Schema.Struct({
  id: Schema.String,
  day: Schema.String,
  note: Schema.NullOr(Schema.String),
  total: Schema.Int,
  paid: Schema.Int,
  at: Schema.Int,
  rowid: Schema.Int,
});

/**
 * The Owed list at this moment: everything the Open Bills still owe, each
 * Customer's share with the Day of their oldest one, and a page of the Open
 * Bills with no Customer, oldest first.
 *
 * A Customer's owed figure is the sum of what their Open Bills still owe, so
 * a Paid or Voided Bill contributes nothing (spec §5.9); a retired Customer's
 * Open Bills stay collectable and are listed like any other (spec §5.2).
 *
 * Two statements. The figures are one grouped read of the Open Bills: the
 * Customers are bounded by who buys on credit and are not paged, and the
 * group of no Customer is what the loose Bills owe together. The loose Bills
 * grow with time, so they come a page at a time, one arm per Open state on
 * `bills_by_state`, seeking to the cursor: `opened_at`, then `rowid`.
 *
 * A Bill is Open only while it owes something, so `total` is what Inicio's
 * card of the Open Bills says they owe (`homeSummary`): the same Bills, read
 * there without the Customers.
 */
export const listOwed = Effect.fn("listOwed")(function* (cursor: Cursor | null = null) {
  yield* requireAdmin;
  const db = yield* Db;
  const day = yield* today;

  const groups = yield* db.all(
    OwedGroup,
    `SELECT g.customerId, c.name, c.normalized_name AS normalizedName, g.owed, g.oldestDay
     FROM (
       SELECT b.customer_id AS customerId, SUM(b.total - b.paid) AS owed, MIN(b.day) AS oldestDay
       FROM bills b
       WHERE b.state IN ('open', 'partial') AND b.total > b.paid
       GROUP BY b.customer_id
     ) AS g
     LEFT JOIN customers c ON c.id = g.customerId`,
  );

  const rowid = cursor === null ? Number.NaN : Number(cursor.id);
  const after = cursor !== null && Number.isSafeInteger(rowid);
  const limit = OWED_BILLS_PER_PAGE + 1;
  const arm = `SELECT * FROM (
      SELECT b.id AS id, b.day AS day, b.note AS note, b.total AS total, b.paid AS paid, b.opened_at AS at, b.rowid AS rowid
      FROM bills b
      WHERE b.state = ? AND b.customer_id IS NULL AND b.total > b.paid${
        after ? " AND b.opened_at >= ? AND (b.opened_at > ? OR b.rowid > ?)" : ""
      }
      ORDER BY b.opened_at, b.rowid
      LIMIT ?
    )`;
  const armParams = (state: string): ReadonlyArray<Param> => [
    state,
    ...(after ? [cursor.at, cursor.at, rowid] : []),
    limit,
  ];
  const loose = yield* db.all(
    LooseRow,
    `SELECT * FROM (${arm} UNION ALL ${arm}) ORDER BY at, rowid LIMIT ?`,
    ...armParams("open"),
    ...armParams("partial"),
    limit,
  );
  const shown = loose.slice(0, OWED_BILLS_PER_PAGE);
  const last = shown.at(-1);

  const total = groups.reduce((sum, group) => sum + group.owed, 0);
  const customers = groups
    .flatMap((group) =>
      group.customerId === null || group.name === null
        ? []
        : [{ ...group, customerId: group.customerId, name: group.name, normalizedName: group.normalizedName ?? "" }],
    )
    .sort((left, right) => {
      if (left.oldestDay !== right.oldestDay) return left.oldestDay < right.oldestDay ? -1 : 1;
      // The same order as the `normalized_name` column: case and accents are
      // already stripped, and the comparison is not locale-dependent.
      if (left.normalizedName === right.normalizedName) return 0;
      return left.normalizedName < right.normalizedName ? -1 : 1;
    })
    .map(({ customerId, name, owed, oldestDay }): OwedCustomer => ({ customerId, name, owed, oldestDay }));

  const owed: Owed = {
    total,
    customers,
    bills: shown.map(
      (row): OwedBill => ({
        id: row.id,
        day: row.day,
        note: row.note,
        total: row.total,
        paid: row.paid,
        owed: row.total - row.paid,
        fromEarlierDay: row.day < day,
      }),
    ),
    next: loose.length > OWED_BILLS_PER_PAGE && last ? { at: last.at, id: String(last.rowid) } : null,
  };
  return owed;
});
