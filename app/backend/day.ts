import { Effect, Schema } from "effect";

import type { Day, Instant } from "~/shared/day";
import type { Centavos } from "~/shared/money";
import { PAYMENT_METHODS, type PaymentMethod } from "~/shared/payment";

import { CurrentUser, requireAdmin } from "./current-user";
import { Db } from "./db";
import { today } from "./time";

/**
 * The figures of a Day (spec §5.9): Sold, attributed to the author of each
 * Line, and Collected, attributed to the receiver of each Payment, split into
 * cash and transfer. A removed Line, a removed Payment and the Lines and
 * Payments of a Voided Bill count toward nothing (spec §5.7).
 *
 * `myDay` is Mi día (spec §6.1): the signed-in User's own records of today,
 * taken from the session and never from an argument, so no request can ask
 * for another User's Day (spec §4.2). The reads ticket 15's Día reuses for
 * every User and any range of Days sit here too.
 *
 * Every read is driven by an index (spec §7.4): `lines_by_author_day` and
 * `payments_by_receiver_day` for one User, `lines_by_day` and `payments_by_day`
 * for a range. A Day's figures never read rows in proportion to the rest of
 * the history (spec §2.4).
 */

/** A range of Days, both ends included. */
export interface DayRange {
  readonly from: Day;
  readonly to: Day;
}

/** Sold and Collected over a range of Days, in cash and by transfer (spec §5.9). */
export interface Figures {
  /** Centavos of the range's Lines that count. */
  readonly sold: Centavos;
  /** Centavos received in cash. */
  readonly cash: Centavos;
  /** Centavos received by transfer. */
  readonly transfer: Centavos;
  /** Cash plus transfer. */
  readonly collected: Centavos;
}

/** One User's figures over a range of Days. */
export interface UserFigures extends Figures {
  readonly userId: string;
  readonly userName: string;
}

/** A range of Days, everyone together and each User apart. */
export interface DayFigures {
  readonly total: Figures;
  /** One entry per User with a record in the range, in name order. */
  readonly byUser: ReadonlyArray<UserFigures>;
}

const SoldTotal = Schema.Struct({ sold: Schema.Int });
const CollectedTotals = Schema.Struct({ cash: Schema.Int, transfer: Schema.Int });
const SoldByUser = Schema.Struct({
  userId: Schema.String,
  userName: Schema.String,
  sold: Schema.Int,
});
const CollectedByUser = Schema.Struct({
  userId: Schema.String,
  userName: Schema.String,
  cash: Schema.Int,
  transfer: Schema.Int,
});

const figuresOf = (sold: Centavos, cash: Centavos, transfer: Centavos): Figures => ({
  sold,
  cash,
  transfer,
  collected: cash + transfer,
});

/**
 * One User's figures over a range of Days. Not exported: the way to ask is
 * `myDay`, which reads the session's User, while Día reads `figuresForRange`.
 */
const userFigures = Effect.fnUntraced(function* (userId: string, range: DayRange) {
  const db = yield* Db;
  const sold = yield* db.first(
    SoldTotal,
    `SELECT COALESCE(SUM(l.quantity * l.unit_price), 0) AS sold
     FROM lines l
     JOIN bills b ON b.id = l.bill_id
     WHERE b.state <> 'voided'
       AND NOT EXISTS (SELECT 1 FROM line_removals r WHERE r.line_id = l.id)
       AND l.added_by = ? AND l.day >= ? AND l.day <= ?`,
    userId,
    range.from,
    range.to,
  );
  const collected = yield* db.first(
    CollectedTotals,
    `SELECT COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount ELSE 0 END), 0) AS cash,
            COALESCE(SUM(CASE WHEN p.method = 'transfer' THEN p.amount ELSE 0 END), 0) AS transfer
     FROM payments p
     JOIN bills b ON b.id = p.bill_id
     WHERE b.state <> 'voided'
       AND NOT EXISTS (SELECT 1 FROM payment_removals r WHERE r.payment_id = p.id)
       AND p.received_by = ? AND p.day >= ? AND p.day <= ?`,
    userId,
    range.from,
    range.to,
  );
  return figuresOf(sold?.sold ?? 0, collected?.cash ?? 0, collected?.transfer ?? 0);
});

/**
 * Every User's figures over a range of Days (spec §5.9), which is what Día
 * (ticket 15) shows for a date or a from–to range: an Admin's read, as the
 * permission matrix says (spec §4.1). The overall totals are the sums of the
 * per-User entries, so one pass over each of two indexes answers the screen.
 */
export const figuresForRange = Effect.fn("figuresForRange")(function* (range: DayRange) {
  yield* requireAdmin;
  const db = yield* Db;

  const sold = yield* db.all(
    SoldByUser,
    `SELECT l.added_by AS userId,
            (SELECT name FROM users WHERE id = l.added_by) AS userName,
            SUM(l.quantity * l.unit_price) AS sold
     FROM lines l
     JOIN bills b ON b.id = l.bill_id
     WHERE b.state <> 'voided'
       AND NOT EXISTS (SELECT 1 FROM line_removals r WHERE r.line_id = l.id)
       AND l.day >= ? AND l.day <= ?
     GROUP BY l.added_by
     ORDER BY userName, userId`,
    range.from,
    range.to,
  );
  const collected = yield* db.all(
    CollectedByUser,
    `SELECT p.received_by AS userId,
            (SELECT name FROM users WHERE id = p.received_by) AS userName,
            SUM(CASE WHEN p.method = 'cash' THEN p.amount ELSE 0 END) AS cash,
            SUM(CASE WHEN p.method = 'transfer' THEN p.amount ELSE 0 END) AS transfer
     FROM payments p
     JOIN bills b ON b.id = p.bill_id
     WHERE b.state <> 'voided'
       AND NOT EXISTS (SELECT 1 FROM payment_removals r WHERE r.payment_id = p.id)
       AND p.day >= ? AND p.day <= ?
     GROUP BY p.received_by
     ORDER BY userName, userId`,
    range.from,
    range.to,
  );

  const byId = new Map<
    string,
    { userId: string; userName: string; sold: Centavos; cash: Centavos; transfer: Centavos }
  >();
  for (const row of sold) byId.set(row.userId, { ...row, cash: 0, transfer: 0 });
  for (const row of collected) {
    const user = byId.get(row.userId) ?? { userId: row.userId, userName: row.userName, sold: 0, cash: 0, transfer: 0 };
    byId.set(row.userId, { ...user, cash: row.cash, transfer: row.transfer });
  }
  const byUser = [...byId.values()]
    .sort((a, b) => a.userName.localeCompare(b.userName) || a.userId.localeCompare(b.userId))
    .map((row): UserFigures => ({ ...row, collected: row.cash + row.transfer }));

  const total = byUser.reduce(
    (sum, user) => figuresOf(sum.sold + user.sold, sum.cash + user.cash, sum.transfer + user.transfer),
    figuresOf(0, 0, 0),
  );
  return { total, byUser };
});

const LineRow = Schema.Struct({
  id: Schema.String,
  itemName: Schema.String,
  quantity: Schema.Int,
  unitPrice: Schema.Int,
  at: Schema.Int,
});

const PaymentRow = Schema.Struct({
  id: Schema.String,
  amount: Schema.Int,
  method: Schema.Literals(PAYMENT_METHODS),
  at: Schema.Int,
});

/** One of a User's Lines that counts, as Mi día lists it. */
export interface DayLine {
  readonly id: string;
  readonly itemName: string;
  readonly quantity: number;
  /** The Item's price when the Line was added (spec §5.4). */
  readonly unitPrice: Centavos;
  readonly at: Instant;
}

/** One of a User's Payments that counts, as Mi día lists it. */
export interface DayPayment {
  readonly id: string;
  readonly amount: Centavos;
  readonly method: PaymentMethod;
  readonly at: Instant;
}

/** One User's Day: their figures and the records behind them. */
export interface MyDay {
  readonly day: Day;
  readonly figures: Figures;
  readonly lines: ReadonlyArray<DayLine>;
  readonly payments: ReadonlyArray<DayPayment>;
}

/**
 * Mi día (spec §6.1): what the signed-in User sold and collected today, with
 * their own Lines and Payments. The User comes from the session, so there is
 * no argument and no request that can ask for someone else's Day (spec §4.2).
 */
export const myDay = Effect.fn("myDay")(function* () {
  const user = yield* CurrentUser;
  const db = yield* Db;
  const day = yield* today;

  const figures = yield* userFigures(user.id, { from: day, to: day });
  const lines = yield* db.all(
    LineRow,
    `SELECT l.id, i.name AS itemName, l.quantity, l.unit_price AS unitPrice, l.added_at AS at
     FROM lines l
     JOIN bills b ON b.id = l.bill_id
     JOIN items i ON i.id = l.item_id
     WHERE b.state <> 'voided'
       AND NOT EXISTS (SELECT 1 FROM line_removals r WHERE r.line_id = l.id)
       AND l.added_by = ? AND l.day = ?
     ORDER BY l.added_at, l.rowid`,
    user.id,
    day,
  );
  const payments = yield* db.all(
    PaymentRow,
    `SELECT p.id, p.amount, p.method, p.received_at AS at
     FROM payments p
     JOIN bills b ON b.id = p.bill_id
     WHERE b.state <> 'voided'
       AND NOT EXISTS (SELECT 1 FROM payment_removals r WHERE r.payment_id = p.id)
       AND p.received_by = ? AND p.day = ?
     ORDER BY p.received_at, p.rowid`,
    user.id,
    day,
  );

  return { day, figures, lines, payments };
});
