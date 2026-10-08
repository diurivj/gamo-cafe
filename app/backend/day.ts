import { Data, Effect, Schema } from "effect";

import { type Day, type Instant, parseDay } from "~/shared/day";
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
 * for another User's Day (spec §4.2). `everyonesDay` is Día (spec §6.2):
 * every User's figures and the Items sold over the range of Days that was
 * asked for, an Admin's read. `todaysFigures` is what Inicio says of today.
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
interface DayFigures {
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
 * One User's figures over a range of Days. Not exported: the ways to ask are
 * `myDay` and `todaysFigures`, which read the session's User, while Día reads
 * `everyonesDay`.
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
 * Every User's figures over a range of Days (spec §5.9). The overall totals
 * are the sums of the per-User entries, so one pass over each of two indexes
 * answers. Not exported, and it asks nobody who they are: `everyonesDay` and
 * `todaysFigures` read it for an Admin only (spec §4.1).
 */
const figuresForRange = Effect.fnUntraced(function* (range: DayRange) {
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
  return { total, byUser } satisfies DayFigures;
});

const ItemSoldRow = Schema.Struct({
  itemId: Schema.String,
  itemName: Schema.String,
  quantity: Schema.Int,
  sold: Schema.Int,
});

/** One Item sold over a range of Days: its units and their value. */
export interface ItemSold {
  readonly itemId: string;
  readonly itemName: string;
  /** Units of every Line of this Item in the range that counts. */
  readonly quantity: number;
  /** Centavos of those units, at each Line's own price (spec §5.4). */
  readonly sold: Centavos;
}

/**
 * The Items sold over a range of Days, with their quantities and value
 * (spec §6.2), the companion of `figuresForRange` with the same exclusions:
 * a removed Line and the Lines of a Voided Bill count toward nothing
 * (spec §5.7). One statement over `lines_by_day`, so the rows read follow the
 * Days asked for and never the rest of the history (spec §2.4, §7.4). The
 * most valuable Item comes first. Not exported: Día reads `everyonesDay`.
 */
const itemsSoldForRange = Effect.fnUntraced(function* (range: DayRange) {
  const db = yield* Db;

  return yield* db.all(
    ItemSoldRow,
    `SELECT l.item_id AS itemId,
            i.name AS itemName,
            SUM(l.quantity) AS quantity,
            SUM(l.quantity * l.unit_price) AS sold
     FROM lines l
     JOIN bills b ON b.id = l.bill_id
     JOIN items i ON i.id = l.item_id
     WHERE b.state <> 'voided'
       AND NOT EXISTS (SELECT 1 FROM line_removals r WHERE r.line_id = l.id)
       AND l.day >= ? AND l.day <= ?
     GROUP BY l.item_id
     ORDER BY sold DESC, itemName, l.item_id`,
    range.from,
    range.to,
  );
});

/** What Día was asked for: the text of each end of the range, as the URL carried it. */
export interface AskedRange {
  /** The first Day. Missing or blank: the last one, or today when that is missing too. */
  readonly from?: string | null;
  /** The last Day. Missing or blank: the first one, or today when that is missing too. */
  readonly to?: string | null;
}

/** An end of the range was written, and what was written is not a Day. */
export class DayUnreadable extends Data.TaggedError("DayUnreadable")<{
  /** The end that could not be read; the first one when neither could. */
  readonly field: "from" | "to";
  /** Each end as far as it was read: `null` for one that is missing or not a Day. */
  readonly from: Day | null;
  readonly to: Day | null;
}> {}

/** Both ends are Days, and the last comes before the first. */
export class RangeEndsBeforeItStarts extends Data.TaggedError("RangeEndsBeforeItStarts")<{
  readonly from: Day;
  readonly to: Day;
}> {}

/** The Day of everyone: a range of Days, its figures and what was sold in it. */
export interface EveryonesDay extends DayFigures {
  /** The range that was read, which is the one to show. */
  readonly range: DayRange;
  /** The Items sold in the range, the most valuable first. */
  readonly items: ReadonlyArray<ItemSold>;
}

/** `null` for an end that was not written, the Day it names, or `undefined` when it names none. */
const askedDay = (text: string | null | undefined): Day | null | undefined => {
  const typed = (text ?? "").trim();
  return typed === "" ? null : (parseDay(typed) ?? undefined);
};

/**
 * Día (spec §6.2): Sold, Collected in cash and by transfer, the same per User
 * and the Items sold, for the Days that were asked for. An Admin's read
 * (spec §4.1).
 *
 *     yield* everyonesDay({});                                       // today
 *     yield* everyonesDay({ from: "2026-10-05" });                   // that Day
 *     yield* everyonesDay({ from: "2026-10-05", to: "2026-10-11" }); // that week
 *
 * It takes the text of the URL and decides the range itself, so the range
 * shown is always the one that was read: nothing asked is today, one end
 * alone is that single Day. An end that is written and is not a Day is
 * refused, never read as today, and so is a range that ends before it
 * starts; a refusal reads no figures.
 *
 * Three statements, each driven by a by-Day index, so the rows read follow
 * the range asked for and never the rest of the history (spec §2.4, §7.4).
 */
export const everyonesDay = Effect.fn("everyonesDay")(function* (asked: AskedRange) {
  yield* requireAdmin;

  const first = askedDay(asked.from);
  const last = askedDay(asked.to);
  if (first === undefined || last === undefined) {
    return yield* new DayUnreadable({
      field: first === undefined ? "from" : "to",
      from: first ?? null,
      to: last ?? null,
    });
  }
  const day = yield* today;
  const range: DayRange = { from: first ?? last ?? day, to: last ?? first ?? day };
  if (range.to < range.from) return yield* new RangeEndsBeforeItStarts(range);

  const figures = yield* figuresForRange(range);
  const items = yield* itemsSoldForRange(range);
  return { range, ...figures, items } satisfies EveryonesDay;
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

/** Today's figures as Inicio says them, without the records behind them. */
export interface TodaysFigures {
  /** The Day they were read for, which is the one to show. */
  readonly day: Day;
  /** What the signed-in User sold and collected. */
  readonly mine: Figures;
  /** What every User did together. An Admin's; `null` for a Worker, for whom it is not read. */
  readonly everyone: Figures | null;
}

/**
 * What Inicio says of today (UI redesign §4): the signed-in User's own
 * figures, and for an Admin those of everyone together (spec §4.1, §4.2). The
 * Day is read once, so both are about the Day that is returned.
 */
export const todaysFigures = Effect.gen(function* () {
  const user = yield* CurrentUser;
  const day = yield* today;
  const range = { from: day, to: day };

  const mine = yield* userFigures(user.id, range);
  const everyone = user.role === "admin" ? (yield* figuresForRange(range)).total : null;
  return { day, mine, everyone } satisfies TodaysFigures;
});

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
