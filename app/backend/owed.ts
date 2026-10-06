import { Effect, Schema } from "effect";

import type { Day } from "~/shared/day";
import type { Centavos } from "~/shared/money";

import { requireAdmin } from "./current-user";
import { Db } from "./db";
import { today } from "./time";

/**
 * Por cobrar (spec §5.3, §5.9, §6.2): what each Customer owes and the Day of
 * their oldest Open Bill, then the Open Bills with no Customer, flagged when
 * they are still Open on a later Day than they were opened on. Admin only
 * (spec §4.1).
 *
 * One index-driven read over `bills_by_state`; the Customer totals are folded
 * here. The rows read are the Open Bills themselves, so they are proportional
 * to the Open Bills and never to the Paid or Voided history (spec §2.4, §7.4).
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
  readonly total: Centavos;
  readonly paid: Centavos;
  readonly owed: Centavos;
  /** Still Open on a later Day than the one it was opened on. */
  readonly fromEarlierDay: boolean;
}

/** The Owed list: the overall figure, then the Customers, then the loose Bills. */
export interface Owed {
  readonly total: Centavos;
  readonly customers: ReadonlyArray<OwedCustomer>;
  readonly bills: ReadonlyArray<OwedBill>;
}

const OwedRow = Schema.Struct({
  id: Schema.String,
  day: Schema.String,
  total: Schema.Int,
  paid: Schema.Int,
  customerId: Schema.NullOr(Schema.String),
  customerName: Schema.NullOr(Schema.String),
  normalizedName: Schema.NullOr(Schema.String),
});

/**
 * The Owed list at this moment: everything the Open Bills still owe, each
 * Customer's share with the Day of their oldest one, and the Open Bills with
 * no Customer, oldest first.
 *
 * A Customer's owed figure is the sum of what their Open Bills still owe, so
 * a Paid or Voided Bill contributes nothing (spec §5.9); a retired Customer's
 * Open Bills stay collectable and are listed like any other (spec §5.2).
 */
export const listOwed = Effect.fn("listOwed")(function* () {
  yield* requireAdmin;
  const db = yield* Db;
  const day = yield* today;

  const rows = yield* db.all(
    OwedRow,
    `SELECT b.id, b.day, b.total, b.paid,
            b.customer_id AS customerId, c.name AS customerName,
            c.normalized_name AS normalizedName
     FROM bills b
     LEFT JOIN customers c ON c.id = b.customer_id
     WHERE b.state IN ('open', 'partial') AND b.total > b.paid
     ORDER BY b.opened_at, b.rowid`,
  );

  // Oldest first, so the first row of a Customer is their oldest Open Bill.
  const customers = new Map<
    string,
    { customerId: string; name: string; normalizedName: string; owed: number; oldestDay: Day }
  >();
  const bills: Array<OwedBill> = [];
  let total = 0;

  for (const row of rows) {
    const owed = row.total - row.paid;
    total += owed;
    if (row.customerId === null || row.customerName === null) {
      bills.push({
        id: row.id,
        day: row.day,
        total: row.total,
        paid: row.paid,
        owed,
        fromEarlierDay: row.day < day,
      });
      continue;
    }
    const customer = customers.get(row.customerId);
    if (customer) {
      customer.owed += owed;
      if (row.day < customer.oldestDay) customer.oldestDay = row.day;
    } else {
      customers.set(row.customerId, {
        customerId: row.customerId,
        name: row.customerName,
        normalizedName: row.normalizedName ?? "",
        owed,
        oldestDay: row.day,
      });
    }
  }

  const ordered = [...customers.values()]
    .sort((left, right) => {
      if (left.oldestDay !== right.oldestDay) return left.oldestDay < right.oldestDay ? -1 : 1;
      // The same order as the `normalized_name` column: case and accents are
      // already stripped, and the comparison is not locale-dependent.
      if (left.normalizedName === right.normalizedName) return 0;
      return left.normalizedName < right.normalizedName ? -1 : 1;
    })
    .map(({ customerId, name, owed, oldestDay }) => ({ customerId, name, owed, oldestDay }));

  return { total, customers: ordered, bills };
});
