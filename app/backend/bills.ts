import { Data, Effect, Schema } from "effect";

import { BILL_STATES, type BillState, isOpenBill } from "~/shared/bill-state";
import { chunk } from "~/shared/chunk";
import { dayOf, type Day, type Instant } from "~/shared/day";
import { newId } from "~/shared/id";
import type { Centavos } from "~/shared/money";
import { normalizeName, prefixRange } from "~/shared/normalize-name";
import { PAYMENT_METHODS, type PaymentMethod } from "~/shared/payment";
import { trimToNull } from "~/shared/text";

import { CurrentUser, requireAdmin } from "./current-user";
import { CustomerNotFound } from "./customers";
import { Db, type Param, statement, type Condition, type Statement } from "./db";
import {
  BillChanged,
  BillIsVoided,
  CustomerBillsChanged,
  handoverStatements,
  paymentStatements,
  PaymentExceedsOwed,
  PaymentNotPositive,
} from "./payments";
import { both, json, notYetRecorded, recordedAnswer, submissionOf, submissionStatement } from "./submissions";
import { now } from "./time";

/**
 * Bills and Lines (spec §5.3, §5.4). A Bill comes into existence with its
 * first Line, and its state is derived from its records, never set by hand
 * (spec §5.6).
 *
 * `getBill` and `listOpenBills` are the reads Cuentas abiertas and Cuenta are
 * built on (ticket 07); `getBill` carries the §4.1 gate for a Bill that is not
 * Open and lists its Payments.
 *
 * "Record a selection" (spec §7.3.1) is one batch: the new Bill when one is
 * needed, one Line per distinct Item at the price the Item had, the Bill's
 * projections, the Stock of every stock-tracked Item and, when the sale is
 * paid on the spot (**Cobrar**), its Payment (ticket 08). Adding Lines never
 * conflicts: totals and Stock change by relative amounts, so two phones
 * adding to the same Bill both succeed. `takePayment` (spec §7.3.2) records a
 * Payment on one Bill, conditionally on the revision the page showed.
 * `takeCustomerPayment` (ticket 09) spreads one amount over a Customer's Open
 * Bills, oldest first, all of them or none (spec §5.5, §7.3.2). `editBill`
 * (spec §7.3.4, ticket 10) sets the Bill's Customer or note, one `bill_edits`
 * fact per field that changed.
 */

const BillStateSchema = Schema.Literals(BILL_STATES);

/** A note as long as §5.3 allows. */
export const NOTE_LIMIT = 80;

/** A selection with nothing in it. */
export class EmptySelection extends Data.TaggedError("EmptySelection")<{}> {}

/** A quantity that is not a whole number of at least 1. */
export class InvalidQuantity extends Data.TaggedError("InvalidQuantity")<{
  readonly itemId: string;
  readonly quantity: number;
}> {}

/** A note longer than its 80 characters (spec §5.3). */
export class NoteTooLong extends Data.TaggedError("NoteTooLong")<{}> {}

/** Items that do not exist, or that were retired after the screen offered them. */
export class ItemUnavailable extends Data.TaggedError("ItemUnavailable")<{
  readonly itemIds: ReadonlyArray<string>;
}> {}

/** The chosen Customer does not exist or is retired: they cannot be chosen (spec §5.2). */
export class CustomerUnavailable extends Data.TaggedError("CustomerUnavailable")<{
  readonly customerId: string;
}> {}

export class BillNotFound extends Data.TaggedError("BillNotFound")<{ readonly billId: string }> {}

/**
 * The Bill is Paid or Voided and the User is a Worker: a Worker opens only
 * Open Bills (spec §4.1, §4.2). Mi día (ticket 14) is the one place their own
 * Paid or Voided records appear.
 */
export class BillNotVisible extends Data.TaggedError("BillNotVisible")<{ readonly billId: string }> {}

/** The target Bill is not Open: no more Lines can be added (spec §5.3). */
export class BillNotOpen extends Data.TaggedError("BillNotOpen")<{
  readonly billId: string;
  readonly state: BillState;
}> {}

/** A target Bill given together with a Customer or a note, which only a new Bill takes. */
export class TargetConflict extends Data.TaggedError("TargetConflict")<{}> {}

/** One Item and how many units of it the selection has. */
export interface SelectionItem {
  readonly itemId: string;
  readonly quantity: number;
}

export interface NewSelection {
  /** One Line per distinct Item; the same Item sent twice is added together. */
  readonly items: ReadonlyArray<SelectionItem>;
  /**
   * The Customer to bill. Their most recently opened Open Bill of the current
   * Day, or a new Bill (spec §5.3).
   */
  readonly customerId?: string | null;
  /** Up to 80 characters. Only a new Bill takes it. */
  readonly note?: string | null;
  /**
   * Add to this Open Bill instead of routing by Customer: how ticket 07 adds
   * Items from Cuenta. No Customer and no note with it.
   */
  readonly billId?: string | null;
  /**
   * The Payment taken together with the selection (**Cobrar** on Vender,
   * spec §6.1, §7.3.1). Its amount defaults to the selection's total and may
   * be less, and it is never more than the selection's total: a Vender
   * payment settles what is being sold now, and prior debt is paid from
   * Cuenta. The amount handed over for cash is not stored, so it is not here.
   */
  readonly payment?: NewSelectionPayment | null;
  /**
   * The key of the form this selection came from, made when the form was
   * rendered (spec §3.4). A second selection with the same key records
   * nothing and is answered as the first.
   */
  readonly submissionKey?: string | null;
}

/** The Payment of **Cobrar**: a method, and at most the selection's total. */
export interface NewSelectionPayment {
  readonly method: PaymentMethod;
  /** Centavos. Absent or null pays the selection's total; never more than it. */
  readonly amount?: Centavos | null;
}

export interface BillSummary {
  readonly id: string;
  readonly day: Day;
  readonly openedBy: string;
  readonly openedAt: Instant;
  readonly customer: { readonly id: string; readonly name: string } | null;
  readonly note: string | null;
  readonly total: Centavos;
  readonly paid: Centavos;
  /** What the Bill still owes: its total minus its Payments (spec §5.6). */
  readonly owed: Centavos;
  readonly state: BillState;
  readonly revision: number;
}

/**
 * A correction as Cuenta shows it: who made it, when and why. A removed Line
 * or Payment carries one (ticket 11); so does a Voided Bill. The record it
 * corrects is never touched (spec §2.1, ADR 0002).
 */
export interface Correction {
  /** The User who removed or voided. */
  readonly by: string;
  readonly byName: string;
  readonly at: Instant;
  /** The reason, required for an Admin's correction; null for a removal from a Bill with no Payment. */
  readonly reason: string | null;
}

export interface BillLine {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly quantity: number;
  readonly unitPrice: Centavos;
  /** The User who added the Line. */
  readonly by: string;
  /** Their name, for Cuenta and Mi día to show (spec §6.1). */
  readonly byName: string;
  readonly at: Instant;
  readonly day: Day;
  /** Its removal, or null while the Line counts (spec §5.7). */
  readonly removal: Correction | null;
}

export interface BillPayment {
  readonly id: string;
  readonly amount: Centavos;
  readonly method: PaymentMethod;
  /** The User who received it. */
  readonly by: string;
  /** Their name, for Cuenta and Mi día to show (spec §6.1). */
  readonly byName: string;
  readonly at: Instant;
  readonly day: Day;
  /** Its removal, or null while the Payment counts (spec §5.7). */
  readonly removal: Correction | null;
}

export type Bill = BillSummary & {
  readonly lines: ReadonlyArray<BillLine>;
  readonly payments: ReadonlyArray<BillPayment>;
  /** The void, when an Admin voided it; a Voided Bill counts toward nothing (spec §5.7). */
  readonly voided: Correction | null;
};

const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");

/**
 * How many Lines one statement carries. Each Line binds four parameters, the
 * statement five more and the shared condition at most six (the Items, a
 * target Bill and the form's key), so 20 Lines bind at most 91 and stay
 * under D1's 100 bound parameters per query (spec §2.4). A selection of every
 * Item in the catalog is then a handful of statements, well under the 50 a
 * request may issue.
 */
const LINES_PER_STATEMENT = 20;

const lineRows = (size: number) => Array.from({ length: size }, () => "(?, ?, ?, ?)").join(", ");
const stockRows = (size: number) => Array.from({ length: size }, () => "(?, ?)").join(", ");

/** One Line per distinct Item: the same Item twice is one Line of both quantities. */
function mergeSelection(items: ReadonlyArray<SelectionItem>): ReadonlyArray<SelectionItem> {
  const quantities = new Map<string, number>();
  for (const { itemId, quantity } of items) {
    quantities.set(itemId, (quantities.get(itemId) ?? 0) + quantity);
  }
  return [...quantities].map(([itemId, quantity]) => ({ itemId, quantity }));
}

const TargetRow = Schema.Struct({ id: Schema.String, state: BillStateSchema });

const CustomerRoute = Schema.Struct({
  billId: Schema.NullOr(Schema.String),
  billState: Schema.NullOr(BillStateSchema),
});

const ChosenRow = Schema.Struct({ id: Schema.String, price: Schema.Int });

const IdRow = Schema.Struct({ id: Schema.String });

const StateRow = Schema.Struct({ state: BillStateSchema });

/** One of a Customer's Open Bills, as their page and an Abonar see it. */
export interface CustomerBill {
  readonly id: string;
  readonly day: Day;
  readonly total: Centavos;
  readonly paid: Centavos;
  /** What the Bill still owes (spec §5.6). */
  readonly owed: Centavos;
  readonly state: BillState;
  readonly revision: number;
}

const CustomerBillRow = Schema.Struct({
  id: Schema.String,
  day: Schema.String,
  total: Schema.Int,
  paid: Schema.Int,
  state: BillStateSchema,
  revision: Schema.Int,
});

/**
 * A Customer's Open Bills that still owe something, oldest first (spec §5.2,
 * §5.5). One index-driven read; retired Customers are included, because their
 * Open Bills stay collectable.
 */
export const listCustomerOpenBills = Effect.fn("listCustomerOpenBills")(function* (customerId: string) {
  const db = yield* Db;
  const rows = yield* db.all(
    CustomerBillRow,
    `SELECT id, day, total, paid, state, revision
     FROM bills
     WHERE customer_id = ? AND state IN ('open', 'partial') AND total > paid
     ORDER BY opened_at, rowid`,
    customerId,
  );
  return rows.map((row) => ({ ...row, owed: row.total - row.paid }));
});

const HandoverRow = Schema.Struct({
  id: Schema.String,
  amount: Schema.Int,
  method: Schema.Literals(PAYMENT_METHODS),
  reference: Schema.NullOr(Schema.String),
  by: Schema.String,
  byName: Schema.String,
  at: Schema.Int,
  day: Schema.String,
});

/** One Payment, or the several Payments of one handover, on the Customer page. */
export interface Handover {
  /** The newest Payment of the event, for keys. */
  readonly id: string;
  /** The shared reference; null for a Payment taken on one Bill. */
  readonly reference: string | null;
  /** The event's money: one Payment's amount, or the Payments' sum. */
  readonly amount: Centavos;
  readonly method: PaymentMethod;
  readonly by: string;
  readonly byName: string;
  readonly at: Instant;
  readonly day: Day;
  /** How many Bills the money reached; 1 for a Payment on one Bill. */
  readonly billCount: number;
}

/** How many Payment rows a Customer's handover list reads at most. */
export const HANDOVER_ROWS = 60;
/** How many events a Customer's handover list shows at most. */
export const HANDOVER_LIMIT = 10;

/**
 * A Customer's Payments, newest first, with the Payments of one handover (the
 * same `handover_reference` of §5.5) collapsed into one event. `LIMIT` bounds
 * the rows read to the Customer's recent money, whatever the rest of the
 * history holds (spec §2.4).
 *
 * Only the Payments that count: a removed Payment and the Payments of a
 * Voided Bill count toward nothing (spec §5.7), as every §5.9 read excludes
 * them too.
 */
export const listCustomerHandovers = Effect.fn("listCustomerHandovers")(function* (customerId: string) {
  const db = yield* Db;
  const rows = yield* db.all(
    HandoverRow,
    `SELECT p.id, p.amount, p.method, p.handover_reference AS reference,
            p.received_by AS "by", u.name AS byName, p.received_at AS at, p.day
     FROM payments p
     JOIN bills b ON b.id = p.bill_id
     JOIN users u ON u.id = p.received_by
     WHERE b.customer_id = ?
       AND b.state <> 'voided'
       AND NOT EXISTS (SELECT 1 FROM payment_removals r WHERE r.payment_id = p.id)
     ORDER BY p.received_at DESC, p.rowid DESC
     LIMIT ?`,
    customerId,
    HANDOVER_ROWS,
  );

  const totals = new Map<string, { amount: Centavos; billCount: number }>();
  for (const row of rows) {
    if (row.reference === null) continue;
    const total = totals.get(row.reference) ?? { amount: 0, billCount: 0 };
    totals.set(row.reference, { amount: total.amount + row.amount, billCount: total.billCount + 1 });
  }

  const events: Array<Handover> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.reference === null) {
      events.push({ ...row, billCount: 1 });
      continue;
    }
    if (seen.has(row.reference)) continue;
    seen.add(row.reference);
    const total = totals.get(row.reference)!;
    events.push({ ...row, amount: total.amount, billCount: total.billCount });
  }
  return events.slice(0, HANDOVER_LIMIT);
});

/**
 * Records a selection as Lines on a Bill (spec §7.3.1), in one batch:
 *
 * - the Bill: the given Open Bill, else the Customer's most recently opened
 *   Open Bill of the current Day, else a new one;
 * - one Line per distinct Item, at the price read now;
 * - the Bill's projections: total, revision and the derived state (§5.6);
 * - Stock, down by the quantity of every stock-tracked Item;
 * - the Payment of **Cobrar**, when the selection is paid on the spot; it is
 *   never more than the selection's total, so it can never make
 *   `paid + amount` outrun the Bill's `total` once these Lines are written.
 *
 * The Lines and their Stock moves travel as chunked multi-row statements, the
 * way a Count's do: one Line and one Stock move per Item would be `2N + 2`
 * statements, and a selection of the whole ~60-Item catalog would breach the
 * 50 a request may issue (spec §2.4). The set of Items also travels as one
 * JSON parameter read with `json_each`, so no statement comes near D1's 100
 * bound parameters however many Items are selected.
 *
 * Every statement carries the same condition (`Condition`), because a D1
 * batch cannot branch: when an Item was retired or a target Bill stopped
 * being Open since it was read, nothing at all is written, the Payment
 * included. So is "this form's key recorded nothing yet" (`./submissions`):
 * a selection sent twice is recorded once, and the second is answered with
 * the Bill as the first left it.
 */
export const recordSelection = Effect.fn("recordSelection")(function* (input: NewSelection) {
  const db = yield* Db;
  const user = yield* CurrentUser;

  const submission = submissionOf("selection", user.id, input.submissionKey);
  const earlier = yield* recordedAnswer(SummaryRow, submission);
  if (earlier) return summary(earlier);

  const customerId = input.customerId || null;
  const billId = input.billId || null;
  const note = trimToNull(input.note);

  if (input.items.length === 0) return yield* new EmptySelection();
  for (const { itemId, quantity } of input.items) {
    if (!Number.isSafeInteger(quantity) || quantity < 1) return yield* new InvalidQuantity({ itemId, quantity });
  }
  if (note !== null && note.length > NOTE_LIMIT) return yield* new NoteTooLong();
  if (billId !== null && (customerId !== null || note !== null)) return yield* new TargetConflict();

  // One instant for the whole operation, so the Bill, its Lines and their Day
  // cannot disagree.
  const at = yield* now;
  const day = dayOf(at);
  const chosen = mergeSelection(input.items);

  // Where the Lines go: a given Open Bill, the Customer's Open Bill of today,
  // or a new Bill.
  let target: { readonly id: string; readonly state: BillState } | undefined;
  if (billId !== null) {
    const bill = yield* db.first(TargetRow, "SELECT id, state FROM bills WHERE id = ?", billId);
    if (!bill) return yield* new BillNotFound({ billId });
    if (!isOpenBill(bill.state)) return yield* new BillNotOpen({ billId, state: bill.state });
    target = bill;
  } else if (customerId !== null) {
    const route = yield* db.first(
      CustomerRoute,
      `SELECT b.id AS billId, b.state AS billState
       FROM customers c
       LEFT JOIN bills b ON b.customer_id = c.id AND b.day = ? AND b.state IN ('open', 'partial')
       WHERE c.id = ? AND c.retired_at IS NULL
       ORDER BY b.opened_at DESC, b.id DESC
       LIMIT 1`,
      day,
      customerId,
    );
    if (!route) return yield* new CustomerUnavailable({ customerId });
    if (route.billId !== null && route.billState !== null) target = { id: route.billId, state: route.billState };
  }

  // The prices are read once and bound into every statement, so the Bill's
  // total is exactly the sum of the Lines it creates. A retired Item cannot
  // be added.
  const itemIds = chosen.map((item) => item.itemId);
  const rows = yield* db.all(
    ChosenRow,
    `SELECT id, price FROM items WHERE id IN (${placeholders(itemIds.length)}) AND retired_at IS NULL`,
    ...itemIds,
  );
  const prices = new Map(rows.map((row) => [row.id, row.price]));
  const unavailable = itemIds.filter((id) => !prices.has(id));
  if (unavailable.length > 0) return yield* new ItemUnavailable({ itemIds: unavailable });

  const lines = chosen.map(({ itemId, quantity }) => ({
    id: newId(),
    itemId,
    quantity,
    unitPrice: prices.get(itemId)!,
  }));
  const delta = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);

  /**
   * The Payment of **Cobrar** (spec §6.1, §7.3.1), when there is one. Its
   * amount defaults to the selection's total and may be less; it is never more
   * than the selection's total, so prior debt is paid from Cuenta, not from
   * Vender.
   *
   * That bound is what keeps the batch's own `paid + amount <= total`
   * condition from ever failing once the Lines are written: at batch time
   * `paid <= total` (the column's CHECK), so `paid + amount <= total + delta`
   * whenever `amount <= delta`. A concurrent partial payment from another
   * phone therefore cannot leave a committed batch whose Lines are written and
   * whose Payment silently is not.
   */
  const payment = input.payment ?? null;
  let paymentAmount: Centavos | null = null;
  if (payment) {
    paymentAmount = payment.amount ?? delta;
    if (!Number.isSafeInteger(paymentAmount) || paymentAmount < 1) return yield* new PaymentNotPositive();
    if (paymentAmount > delta) return yield* new PaymentExceedsOwed({ owed: delta });
  }

  /**
   * What every statement of the batch asks for, so a refused selection writes
   * nothing: all chosen Items are still active, and, when the Lines go onto
   * an existing Bill, that Bill is still Open. The set of Items travels as one
   * JSON parameter read with `json_each`, as a Count's condition does, so the
   * condition fits every statement's parameter budget whatever the number of
   * Items (spec §2.4).
   */
  const rules: Condition = {
    sql: [
      `(SELECT COUNT(*) FROM json_each(?) AS j JOIN items i ON i.id = j.value AND i.retired_at IS NULL) = ?`,
      ...(target ? ["EXISTS (SELECT 1 FROM bills WHERE id = ? AND state IN ('open', 'partial'))"] : []),
    ].join(" AND "),
    params: [JSON.stringify(itemIds), itemIds.length, ...(target ? [target.id] : [])],
  };
  // ... and this form's key has recorded nothing yet (spec §3.4).
  const condition = both(rules, notYetRecorded(submission));

  const bill = target ?? { id: newId() };

  const statements: Statement[] = [
    target
      ? statement(
          // Relative totals: two phones adding at once both count (§7.3). The
          // state is derived in the same statement from the totals, never set
          // by hand (§5.6).
          `UPDATE bills
           SET total = total + ?,
               revision = revision + 1,
               state = CASE WHEN paid >= total + ? THEN 'paid'
                            WHEN paid > 0 THEN 'partial'
                            ELSE 'open' END
           WHERE id = ? AND (${condition.sql})`,
          delta,
          delta,
          target.id,
          ...condition.params,
        )
      : statement(
          // A Bill comes into existence with its first Line (§5.3): the insert
          // happens only if every chosen Item is still active. Its state is
          // derived from its totals (§5.6); with no Payment it is Open, unless
          // it owes nothing, when it is Paid. `opened_customer_id` and
          // `opened_note` are the facts of the Customer and note it was
          // created for; `customer_id` and `note` are the current values the
          // edits move, identical until the first edit, and what the rebuild
          // of ticket 19 derives from (spec §7.1).
          `INSERT INTO bills (id, day, opened_by, opened_at, opened_customer_id, opened_note, customer_id, note, total, paid, state, revision)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CASE WHEN 0 >= ? THEN 'paid' ELSE 'open' END, 0
           WHERE (${condition.sql})`,
          bill.id,
          day,
          user.id,
          at,
          customerId,
          note,
          customerId,
          note,
          delta,
          delta,
          ...condition.params,
        ),
  ];

  for (const part of chunk(lines, LINES_PER_STATEMENT)) {
    statements.push(
      statement(
        // `moved_stock` is a fact about each Line, set from the Item's flag at
        // this moment, as the Stock statement below reads it too. The join to
        // `bills` keeps a new Bill's Lines out of the batch when the Bill's
        // own insert wrote nothing.
        `INSERT INTO lines (id, bill_id, item_id, quantity, unit_price, moved_stock, added_by, added_at, day)
         SELECT v.column1, ?, v.column2, v.column3, v.column4, i.stock_tracked, ?, ?, ?
         FROM (VALUES ${lineRows(part.length)}) AS v
         JOIN items i ON i.id = v.column2
         JOIN bills b ON b.id = ?
         WHERE (${condition.sql})`,
        bill.id,
        user.id,
        at,
        day,
        ...part.flatMap((line) => [line.id, line.itemId, line.quantity, line.unitPrice]),
        bill.id,
        ...condition.params,
      ),
    );
  }

  for (const part of chunk(lines, LINES_PER_STATEMENT)) {
    statements.push(
      statement(
        // Stock moves by relative amounts, once per stock-tracked Item, so two
        // phones adding at once both count (§7.3); an Item that is not
        // stock-tracked at this moment gets no row, as `changeStock` does.
        `INSERT INTO stock_levels (item_id, units)
         SELECT v.column1, SUM(v.column2)
         FROM (VALUES ${stockRows(part.length)}) AS v
         JOIN items i ON i.id = v.column1 AND i.stock_tracked = 1
         WHERE (${condition.sql})
         GROUP BY v.column1
         ON CONFLICT (item_id) DO UPDATE SET units = units + excluded.units`,
        ...part.flatMap((line) => [line.itemId, -line.quantity]),
        ...condition.params,
      ),
    );
  }

  if (payment && paymentAmount !== null) {
    // The Payment rides in the same batch and under the same condition as the
    // Lines it pays for: a refused selection records no Payment either.
    statements.push(
      ...paymentStatements(
        { id: newId(), billId: bill.id, amount: paymentAmount, method: payment.method, by: user.id, at, day },
        condition,
      ),
    );
  }

  // The form's key, with the Bill as this batch leaves it: what a repeat of
  // this submission is answered with.
  statements.push(
    submissionStatement(submission, {
      at,
      answer: { sql: `(${SUMMARY_JSON} WHERE b.id = ?)`, params: [bill.id] },
      wrote: { sql: "EXISTS (SELECT 1 FROM lines WHERE id = ?)", params: [lines[0]!.id] },
    }),
  );

  const results = yield* db.batch(statements);
  if (results[0]!.changes === 0) {
    // Another request with this form's key recorded it meanwhile: answer as
    // that one did.
    const meanwhile = yield* recordedAnswer(SummaryRow, submission);
    if (meanwhile) return summary(meanwhile);
    // The shared condition refused the selection: learn which rule it was.
    if (target) {
      const state = yield* db.first(StateRow, "SELECT state FROM bills WHERE id = ?", target.id);
      if (!state) return yield* new BillNotFound({ billId: target.id });
      if (!isOpenBill(state.state)) return yield* new BillNotOpen({ billId: target.id, state: state.state });
    }
    const stillThere = yield* db.all(
      IdRow,
      `SELECT id FROM items WHERE id IN (${placeholders(itemIds.length)}) AND retired_at IS NULL`,
      ...itemIds,
    );
    const present = new Set(stillThere.map((row) => row.id));
    return yield* new ItemUnavailable({ itemIds: itemIds.filter((id) => !present.has(id)) });
  }

  return yield* summaryOf(bill.id);
});

const EditableBillRow = Schema.Struct({
  customerId: Schema.NullOr(Schema.String),
  note: Schema.NullOr(Schema.String),
  paid: Schema.Int,
  state: BillStateSchema,
  revision: Schema.Int,
});

/**
 * A Worker tried to change a Bill that has a Payment, which only an Admin may
 * do (spec §4.1). "Has a Payment" is read from the Bill's `paid` projection,
 * so a Payment ticket 11 removes stops counting.
 */
export class BillHasPayment extends Data.TaggedError("BillHasPayment")<{ readonly billId: string }> {}

/** One of the two fields an edit can change. */
export type BillEditField = "customer" | "note";

/** What an edit of a Bill's Customer or note carries: the values to store. */
export interface BillEditInput {
  readonly billId: string;
  /** The Customer to link; null leaves the Bill with none. */
  readonly customerId: string | null;
  /** Up to 80 characters (spec §5.3); null or empty means no note. */
  readonly note: string | null;
  /**
   * The revision of the Bill as the User's page showed it. A submission that
   * carries another one is stale and changes nothing (spec §7.3).
   */
  readonly expectedRevision: number;
}

/**
 * Sets or changes a Bill's Customer or note (spec §7.3.4), in one batch: a
 * `bill_edits` fact for each field that actually changed, with its previous
 * and new value, and the Bill's projections (`customer_id`, `note`,
 * `revision`).
 *
 * Any User may while the Bill has no Payment; an Admin may afterwards
 * (spec §4.1). "Has a Payment" is the projection `paid`, so a Payment that
 * ticket 11 removes stops counting. A retired Customer cannot be chosen
 * (spec §5.2); one already linked stays linked when only the note changes.
 *
 * A D1 batch cannot branch, so the revision, the Voided state, the role's
 * right to edit now and the chosen Customer still being active all live in
 * the SQL every statement of the batch shares. When it refuses, nothing at
 * all is written and the Bill is read again to answer the exact rule.
 */
export const editBill = Effect.fn("editBill")(function* (input: BillEditInput) {
  const db = yield* Db;
  const user = yield* CurrentUser;
  const billId = input.billId;

  const bill = yield* db.first(
    EditableBillRow,
    "SELECT customer_id AS customerId, note, paid, state, revision FROM bills WHERE id = ?",
    billId,
  );
  if (!bill) return yield* new BillNotFound({ billId });
  if (bill.revision !== input.expectedRevision) return yield* new BillChanged({ billId });
  if (bill.state === "voided") return yield* new BillIsVoided({ billId });
  if (user.role !== "admin" && bill.paid > 0) return yield* new BillHasPayment({ billId });

  const customerId = input.customerId || null;
  const note = trimToNull(input.note);
  if (note !== null && note.length > NOTE_LIMIT) return yield* new NoteTooLong();

  // Only what changed becomes a fact: each change is a History entry, and a
  // submission that changes nothing is answered as it stands.
  const edits: Array<{ field: BillEditField; previous: string | null; next: string | null }> = [];
  if (customerId !== bill.customerId) {
    edits.push({ field: "customer", previous: bill.customerId, next: customerId });
  }
  if (note !== bill.note) edits.push({ field: "note", previous: bill.note, next: note });

  const choosingCustomer = customerId !== null && customerId !== bill.customerId;
  if (choosingCustomer) {
    const chosen = yield* db.first(
      IdRow,
      "SELECT id FROM customers WHERE id = ? AND retired_at IS NULL",
      customerId,
    );
    if (!chosen) return yield* new CustomerUnavailable({ customerId });
  }
  if (edits.length === 0) return { revision: bill.revision };

  const at = yield* now;
  const conditions = [
    "EXISTS (SELECT 1 FROM bills WHERE id = ? AND revision = ? AND state <> 'voided' AND (paid = 0 OR ? = 1))",
  ];
  const conditionParams: Param[] = [billId, input.expectedRevision, user.role === "admin" ? 1 : 0];
  if (choosingCustomer) {
    conditions.push("EXISTS (SELECT 1 FROM customers WHERE id = ? AND retired_at IS NULL)");
    conditionParams.push(customerId);
  }
  const condition: Condition = { sql: conditions.join(" AND "), params: conditionParams };

  const statements: Statement[] = edits.map(({ field, previous, next }) =>
    statement(
      `INSERT INTO bill_edits (id, bill_id, field, previous_value, new_value, edited_by, edited_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE (${condition.sql})`,
      newId(),
      billId,
      field,
      previous,
      next,
      user.id,
      at,
      ...condition.params,
    ),
  );
  statements.push(
    statement(
      `UPDATE bills SET customer_id = ?, note = ?, revision = revision + 1
       WHERE id = ? AND (${condition.sql})`,
      customerId,
      note,
      billId,
      ...condition.params,
    ),
  );

  const [first] = yield* db.batch(statements);
  if (first!.changes === 0) {
    // The condition refused it: learn which rule it was, from the Bill as it
    // is now, as `takePayment` does.
    const after = yield* db.first(
      EditableBillRow,
      "SELECT customer_id AS customerId, note, paid, state, revision FROM bills WHERE id = ?",
      billId,
    );
    if (!after) return yield* new BillNotFound({ billId });
    if (after.revision !== input.expectedRevision) return yield* new BillChanged({ billId });
    if (after.state === "voided") return yield* new BillIsVoided({ billId });
    if (user.role !== "admin" && after.paid > 0) return yield* new BillHasPayment({ billId });
    return yield* new CustomerUnavailable({ customerId: customerId! });
  }
  return { revision: bill.revision + 1 };
});

const PaymentBillRow = Schema.Struct({
  total: Schema.Int,
  paid: Schema.Int,
  state: BillStateSchema,
  revision: Schema.Int,
});

export interface NewPaymentInput {
  readonly billId: string;
  /** Centavos; absent or null pays everything the Bill still owes (spec §5.5). */
  readonly amount?: Centavos | null;
  readonly method: PaymentMethod;
  /**
   * The revision of the Bill as the User's page showed it. A submission that
   * carries another one is stale and changes nothing (spec §5.5, §7.3).
   */
  readonly expectedRevision: number;
  /** The key of the form this Payment came from (spec §3.4); see `NewSelection`. */
  readonly submissionKey?: string | null;
}

/** What `takePayment` answers, and what a repeat of its form is answered with. */
const PaymentAnswer = Schema.Struct({
  id: Schema.String,
  amount: Schema.Int,
  paid: Schema.Boolean,
  total: Schema.Int,
  owed: Schema.Int,
});

/**
 * Takes a Payment on one Bill (spec §7.3.2): the fact and the Bill's
 * projections, in one batch. The amount defaults to what the Bill still owes
 * and may be less; it is greater than zero and never more than what is owed.
 *
 * The write is conditional on the Bill's revision, so of two phones paying
 * the same Bill at the same moment exactly one records a Payment and the
 * other is told that the Bill has changed (spec §2.3, §10.3). A D1 batch
 * cannot branch: both statements carry the revision in their SQL.
 *
 * The same form sent twice is another matter: it is the same Payment, so it
 * is recorded once and the second is answered as the first, not told that the
 * Bill changed (spec §3.4, `./submissions`).
 */
export const takePayment = Effect.fn("takePayment")(function* (input: NewPaymentInput) {
  const db = yield* Db;
  const user = yield* CurrentUser;
  const billId = input.billId;

  const submission = submissionOf("payment", user.id, input.submissionKey);
  const earlier = yield* recordedAnswer(PaymentAnswer, submission);
  if (earlier) return earlier;

  const bill = yield* db.first(
    PaymentBillRow,
    "SELECT total, paid, state, revision FROM bills WHERE id = ?",
    billId,
  );
  if (!bill) return yield* new BillNotFound({ billId });
  if (bill.revision !== input.expectedRevision) return yield* new BillChanged({ billId });
  if (bill.state === "voided") return yield* new BillIsVoided({ billId });

  const owed = bill.total - bill.paid;
  const amount = input.amount ?? owed;
  if (!Number.isSafeInteger(amount) || amount < 1) return yield* new PaymentNotPositive();
  if (amount > owed) return yield* new PaymentExceedsOwed({ owed });

  const id = newId();
  const at = yield* now;
  const rules: Condition = {
    sql: `EXISTS (SELECT 1 FROM bills
                  WHERE id = ? AND revision = ? AND state IN ('open', 'partial') AND total - paid >= ?)`,
    params: [billId, input.expectedRevision, amount],
  };
  // On success the batch saw the very figures just read (the revision held),
  // so this says whether the Payment left the Bill Paid; the route needs it to
  // know whether a Worker may stay on the page (§4.1). `total` and `owed` are
  // the Bill's figures after the Payment, for what the screen says.
  const answer = { id, amount, paid: bill.paid + amount === bill.total, total: bill.total, owed: owed - amount };
  const [recorded] = yield* db.batch([
    ...paymentStatements(
      { id, billId, amount, method: input.method, by: user.id, at, day: dayOf(at) },
      both(rules, notYetRecorded(submission)),
    ),
    submissionStatement(submission, {
      at,
      answer: json(answer),
      wrote: { sql: "EXISTS (SELECT 1 FROM payments WHERE id = ?)", params: [id] },
    }),
  ]);

  if (recorded!.changes === 0) {
    // Another request with this form's key recorded it meanwhile.
    const meanwhile = yield* recordedAnswer(PaymentAnswer, submission);
    if (meanwhile) return meanwhile;
    // The condition refused it: learn which rule it was, from the Bill as it
    // is now (spec §5.5: a stale submission is told the Bill has changed).
    const after = yield* db.first(
      PaymentBillRow,
      "SELECT total, paid, state, revision FROM bills WHERE id = ?",
      billId,
    );
    if (!after) return yield* new BillNotFound({ billId });
    if (after.revision !== input.expectedRevision) return yield* new BillChanged({ billId });
    if (after.state === "voided") return yield* new BillIsVoided({ billId });
    return yield* new PaymentExceedsOwed({ owed: after.total - after.paid });
  }
  return answer;
});

/** One Bill and the revision the User's page showed it at (spec §7.3). */
export interface ExpectedBillRevision {
  readonly billId: string;
  readonly revision: number;
}

export interface NewCustomerPayment {
  readonly customerId: string;
  /** Centavos; absent or null pays everything the Customer owes (spec §5.5). */
  readonly amount?: Centavos | null;
  readonly method: PaymentMethod;
  /**
   * Every Open Bill and the revision the User's page showed it at. A
   * submission whose Bills do not match these exactly changes nothing
   * (spec §5.5, §7.3).
   */
  readonly expectedRevisions: ReadonlyArray<ExpectedBillRevision>;
  /** The key of the form this Payment came from (spec §3.4); see `NewSelection`. */
  readonly submissionKey?: string | null;
}

/** What one Bill received from a handover. */
export interface CustomerPaymentShare {
  readonly billId: string;
  readonly paymentId: string;
  readonly amount: Centavos;
}

/** What `takeCustomerPayment` answers, and what a repeat of its form is answered with. */
const HandoverAnswer = Schema.Struct({
  reference: Schema.String,
  amount: Schema.Int,
  shares: Schema.Array(
    Schema.Struct({ billId: Schema.String, paymentId: Schema.String, amount: Schema.Int }),
  ),
});

/**
 * Takes one amount across a Customer's Open Bills (spec §7.3.2, §5.5, flow
 * §8.3): the amount defaults to everything the Customer owes and may be less,
 * never more. It reaches the Bills oldest first, one Payment per Bill with the
 * same method, User, moment and `handover_reference`, and the last Bill it
 * touches may be left Pago parcial.
 *
 * All of it is recorded or none of it. The batch holds two multi-row
 * statements (one insert, one update) under one shared condition, so 30 Open
 * Bills cost two statements and no query comes near 100 bound parameters
 * (spec §2.4, §10.3). The condition is the set of Open Bills that still owe,
 * with each revision: any Bill that changed since the page was rendered —
 * another phone paying it, adding Lines to it — makes every statement refuse,
 * and the User is told the Bills changed.
 *
 * A retired Customer's Bills stay collectable (spec §5.2): nothing here looks
 * at `retired_at`.
 *
 * The same form sent twice is recorded once, and the second is answered as
 * the first (spec §3.4, `./submissions`).
 */
export const takeCustomerPayment = Effect.fn("takeCustomerPayment")(function* (
  input: NewCustomerPayment,
) {
  const db = yield* Db;
  const user = yield* CurrentUser;

  const submission = submissionOf("handover", user.id, input.submissionKey);
  const earlier = yield* recordedAnswer(HandoverAnswer, submission);
  if (earlier) return earlier;

  const customer = yield* db.first(IdRow, "SELECT id FROM customers WHERE id = ?", input.customerId);
  if (!customer) return yield* new CustomerNotFound();

  const bills = yield* listCustomerOpenBills(input.customerId);
  const expected = new Map(input.expectedRevisions.map((bill) => [bill.billId, bill.revision]));
  const unchanged =
    expected.size === bills.length && bills.every((bill) => expected.get(bill.id) === bill.revision);
  if (!unchanged) return yield* new CustomerBillsChanged({ customerId: input.customerId });

  const owed = bills.reduce((sum, bill) => sum + bill.owed, 0);
  const amount = input.amount ?? owed;
  if (!Number.isSafeInteger(amount) || amount < 1) return yield* new PaymentNotPositive();
  if (amount > owed) return yield* new PaymentExceedsOwed({ owed });

  // Oldest first, until the amount is used up (spec §5.5, flow §8.3).
  const shares: Array<CustomerPaymentShare> = [];
  let left = amount;
  for (const bill of bills) {
    if (left === 0) break;
    const share = Math.min(left, bill.owed);
    shares.push({ billId: bill.id, paymentId: newId(), amount: share });
    left -= share;
  }

  const at = yield* now;
  const reference = newId();
  // A D1 batch cannot branch: every statement carries this condition, so any
  // Bill that moved since the read refuses the whole handover (spec §7.3).
  const shown = JSON.stringify(bills.map((bill) => [bill.id, bill.revision]));
  const rules: Condition = {
    sql: `(SELECT COUNT(*) FROM bills b
           WHERE b.customer_id = ? AND b.state IN ('open', 'partial') AND b.total > b.paid
             AND EXISTS (SELECT 1 FROM json_each(?) AS j
                         WHERE json_extract(j.value, '$[0]') = b.id
                           AND json_extract(j.value, '$[1]') = b.revision))
          = (SELECT COUNT(*) FROM json_each(?))`,
    params: [input.customerId, shown, shown],
  };
  const answer = { reference, amount, shares };
  const [recorded] = yield* db.batch([
    ...handoverStatements(
      { reference, shares, method: input.method, by: user.id, at, day: dayOf(at) },
      both(rules, notYetRecorded(submission)),
    ),
    submissionStatement(submission, {
      at,
      answer: json(answer),
      wrote: { sql: "EXISTS (SELECT 1 FROM payments WHERE id = ?)", params: [shares[0]!.paymentId] },
    }),
  ]);
  if (recorded!.changes !== shares.length) {
    // Another request with this form's key recorded it meanwhile.
    const meanwhile = yield* recordedAnswer(HandoverAnswer, submission);
    if (meanwhile) return meanwhile;
    // The condition refused the whole batch: the Bills moved while the
    // submission was in flight, so nothing was recorded (spec §5.5).
    return yield* new CustomerBillsChanged({ customerId: input.customerId });
  }
  return answer;
});

const SummaryRow = Schema.Struct({
  id: Schema.String,
  day: Schema.String,
  openedBy: Schema.String,
  openedAt: Schema.Int,
  customerId: Schema.NullOr(Schema.String),
  customerName: Schema.NullOr(Schema.String),
  note: Schema.NullOr(Schema.String),
  total: Schema.Int,
  paid: Schema.Int,
  state: BillStateSchema,
  revision: Schema.Int,
});

/** A summary row as the app's shape: the Customer, and what the Bill owes. */
function summary(row: typeof SummaryRow.Type): BillSummary {
  const { customerId, customerName, ...bill } = row;
  return {
    ...bill,
    owed: bill.total - bill.paid,
    customer: customerId === null || customerName === null ? null : { id: customerId, name: customerName },
  };
}

/**
 * A Bill's summary as one JSON value, for the `submissions` row a selection
 * leaves: the fields of `SummaryRow`. It ends at its `FROM`, for the caller's
 * `WHERE`.
 */
const SUMMARY_JSON = `SELECT json_object(
         'id', b.id, 'day', b.day, 'openedBy', b.opened_by, 'openedAt', b.opened_at,
         'customerId', b.customer_id, 'customerName', c.name, 'note', b.note,
         'total', b.total, 'paid', b.paid, 'state', b.state, 'revision', b.revision)
       FROM bills b LEFT JOIN customers c ON c.id = b.customer_id`;

const summaryOf = Effect.fnUntraced(function* (billId: string) {
  const db = yield* Db;
  const row = yield* db.first(
    SummaryRow,
    `SELECT b.id, b.day, b.opened_by AS openedBy, b.opened_at AS openedAt,
            b.customer_id AS customerId, c.name AS customerName, b.note,
            b.total, b.paid, b.state, b.revision
     FROM bills b LEFT JOIN customers c ON c.id = b.customer_id
     WHERE b.id = ?`,
    billId,
  );
  if (!row) return yield* new BillNotFound({ billId });
  return summary(row);
});

/**
 * Every Open Bill, newest first: Cuentas abiertas (spec §6.1). One statement
 * driven by the index on state, so it reads the Open Bills and nothing else,
 * however many Paid Bills the history holds (spec §2.4, §7.4). With `typed`,
 * it keeps only the Bills of Customers whose name starts with it, ignoring
 * case and accents, as on Clientes (spec §5.2).
 */
export const listOpenBills = Effect.fn("listOpenBills")(function* (typed = "") {
  const db = yield* Db;
  const prefix = normalizeName(typed);
  const rows = yield* db.all(
    SummaryRow,
    `SELECT b.id, b.day, b.opened_by AS openedBy, b.opened_at AS openedAt,
            b.customer_id AS customerId, c.name AS customerName, b.note,
            b.total, b.paid, b.state, b.revision
     FROM bills b LEFT JOIN customers c ON c.id = b.customer_id
     WHERE b.state IN ('open', 'partial')${
       prefix === "" ? "" : " AND c.normalized_name >= ? AND c.normalized_name < ?"
     }
     ORDER BY b.opened_at DESC, b.rowid DESC`,
    ...(prefix === "" ? [] : [prefix, prefixRange(prefix)]),
  );
  return rows.map(summary);
});

/** How many Bills one page of Cuentas holds (spec §6.2). */
export const BILLS_PER_PAGE = 50;

/**
 * The last page Cuentas reads; a page beyond it is answered empty. An OFFSET
 * still walks the index entries it skips, so this keeps a page's rows read a
 * constant (spec §2.4) instead of letting a made-up page number walk the
 * whole history. 200 pages are 10,000 Bills.
 */
export const MAX_BILL_PAGE = 200;

/**
 * Which Bills a page of Cuentas holds (spec §6.2): a Day, a state and a
 * Customer, each optional and combined with the others. `settledOnly` is a
 * Customer's past Bills: the ones that are no longer Open (spec §6.1).
 */
export interface BillFilter {
  /** One Day, `YYYY-MM-DD` (spec §5.9). */
  readonly day?: Day | null;
  /** One of §5.6's states. */
  readonly state?: BillState | null;
  /** One Customer's Bills. */
  readonly customerId?: string | null;
  /** Only Bills that are no longer Open: Pagada or Cancelada. */
  readonly settledOnly?: boolean;
  /** 1-based; anything else asks for the first page. */
  readonly page?: number;
}

/** One page of Bills, newest first. */
export interface BillPage {
  readonly bills: ReadonlyArray<BillSummary>;
  /** The page number these Bills belong to, 1-based. */
  readonly page: number;
  /** Whether another page follows this one. */
  readonly hasMore: boolean;
}

/** The page asked for, or the first one. */
const pageNumber = (asked: number | undefined) =>
  asked !== undefined && Number.isSafeInteger(asked) && asked >= 1 ? asked : 1;

/**
 * Every Bill with its state, newest first, one page of 50 at a time, filtered
 * by Day, state or Customer (spec §6.2). An Admin only (spec §4.1, §4.2): a
 * Worker never sees Paid or Voided Bills.
 *
 * The read is index-driven and bounded by the page, never by the history
 * (spec §2.4, §7.4):
 *
 * - one Customer's Bills come from `bills_by_customer_day`, whose order
 *   (`day`, `opened_at`) the reverse scan already provides;
 * - everything else is one statement over one arm per state — at most four —
 *   each `state` (and `day`, when asked) constraining `bills_by_state` or
 *   `bills_by_day_state`, so every arm stops after its page's rows. The arms
 *   are merged and ordered by `opened_at`, which is the newest-first order
 *   across states.
 *
 * `hasMore` comes from reading one row past the page, so a full page says
 * whether another follows without counting the history.
 */
export const listBills = Effect.fn("listBills")(function* (filter: BillFilter = {}) {
  yield* requireAdmin;
  const db = yield* Db;

  const page = pageNumber(filter.page);
  if (page > MAX_BILL_PAGE) return { bills: [], page, hasMore: false };
  const offset = (page - 1) * BILLS_PER_PAGE;
  const limit = BILLS_PER_PAGE + 1;
  const day = filter.day || null;
  const customerId = filter.customerId || null;
  const states: ReadonlyArray<BillState> = filter.state
    ? [filter.state]
    : filter.settledOnly
      ? ["paid", "voided"]
      : BILL_STATES;

  const paged = (rows: ReadonlyArray<typeof SummaryRow.Type>): BillPage => ({
    bills: rows.slice(0, BILLS_PER_PAGE).map(summary),
    page,
    hasMore: rows.length > BILLS_PER_PAGE,
  });

  if (customerId !== null) {
    const rows = yield* db.all(
      SummaryRow,
      `SELECT b.id, b.day, b.opened_by AS openedBy, b.opened_at AS openedAt,
              b.customer_id AS customerId, c.name AS customerName, b.note,
              b.total, b.paid, b.state, b.revision
       FROM bills b LEFT JOIN customers c ON c.id = b.customer_id
       WHERE b.customer_id = ?${day === null ? "" : " AND b.day = ?"}
         AND b.state IN (${placeholders(states.length)})
       ORDER BY b.day DESC, b.opened_at DESC, b.rowid DESC
       LIMIT ? OFFSET ?`,
      customerId,
      ...(day === null ? [] : [day]),
      ...states,
      limit,
      offset,
    );
    return paged(rows);
  }

  // One arm per state, each index-driven on its own; the outer statement
  // merges them into the newest 50 (or 50 of the asked page).
  const arm = `SELECT * FROM (
      SELECT b.id AS id, b.day AS day, b.opened_by AS openedBy, b.opened_at AS openedAt,
             b.customer_id AS customerId, b.note AS note, b.total AS total, b.paid AS paid,
             b.state AS state, b.revision AS revision, b.rowid AS rowid
      FROM bills b
      WHERE b.state = ?${day === null ? "" : " AND b.day = ?"}
      ORDER BY b.opened_at DESC, b.rowid DESC
      LIMIT ?
    )`;
  const params: Param[] = [];
  for (const state of states) {
    params.push(state, ...(day === null ? [] : [day]), offset + limit);
  }
  const rows = yield* db.all(
    SummaryRow,
    `SELECT p.id, p.day, p.openedBy, p.openedAt, p.customerId,
            c.name AS customerName, p.note, p.total, p.paid, p.state, p.revision
     FROM (${states.map(() => arm).join(" UNION ALL ")}) AS p
     LEFT JOIN customers c ON c.id = p.customerId
     ORDER BY p.openedAt DESC, p.rowid DESC
     LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  return paged(rows);
});

/**
 * A Customer's past Bills — Pagada or Cancelada — newest first, one page of 50
 * (spec §6.1): what an Admin sees below the Customer's Open Bills. A Worker is
 * refused, and their page does not even ask for it (spec §4.1, §4.2).
 */
export const listCustomerPastBills = Effect.fn("listCustomerPastBills")(function* (
  customerId: string,
  page = 1,
) {
  return yield* listBills({ customerId, settledOnly: true, page });
});

const LineRow = Schema.Struct({
  id: Schema.String,
  itemId: Schema.String,
  itemName: Schema.String,
  quantity: Schema.Int,
  unitPrice: Schema.Int,
  by: Schema.String,
  byName: Schema.String,
  at: Schema.Int,
  day: Schema.String,
  removalBy: Schema.NullOr(Schema.String),
  removalByName: Schema.NullOr(Schema.String),
  removalAt: Schema.NullOr(Schema.Int),
  removalReason: Schema.NullOr(Schema.String),
});

const PaymentRow = Schema.Struct({
  id: Schema.String,
  amount: Schema.Int,
  method: Schema.Literals(PAYMENT_METHODS),
  by: Schema.String,
  byName: Schema.String,
  at: Schema.Int,
  day: Schema.String,
  removalBy: Schema.NullOr(Schema.String),
  removalByName: Schema.NullOr(Schema.String),
  removalAt: Schema.NullOr(Schema.Int),
  removalReason: Schema.NullOr(Schema.String),
});

const VoidRow = Schema.Struct({
  by: Schema.String,
  byName: Schema.String,
  at: Schema.Int,
  reason: Schema.String,
});

/** A removal's own fields as a `Correction`, or none when the record counts. */
function correction(
  by: string | null,
  byName: string | null,
  at: number | null,
  reason: string | null,
): Correction | null {
  return by === null || byName === null || at === null ? null : { by, byName, at, reason };
}

/**
 * One Bill with its Lines and Payments, oldest first, each with its author
 * and moment, its removals (ticket 11) and its void, when there is one.
 * Removed Lines and Payments are still listed, marked with who removed them,
 * when and why (spec §6.1); the projections exclude them.
 *
 * The §4.1 gate lives here: a Worker requesting a Paid or Voided Bill is
 * refused, and `Mi día` (ticket 14) is the only view that shows them their own
 * records outside this rule. An Admin opens every Bill.
 */
export const getBill = Effect.fn("getBill")(function* (billId: string) {
  const db = yield* Db;
  const user = yield* CurrentUser;
  const bill = yield* summaryOf(billId);
  if (!isOpenBill(bill.state) && user.role !== "admin") return yield* new BillNotVisible({ billId });
  const rows = yield* db.all(
    LineRow,
    `SELECT l.id, l.item_id AS itemId, i.name AS itemName, l.quantity,
            l.unit_price AS unitPrice, l.added_by AS "by", u.name AS byName,
            l.added_at AS at, l.day,
            r.removed_by AS removalBy, ru.name AS removalByName,
            r.removed_at AS removalAt, r.reason AS removalReason
     FROM lines l
     JOIN items i ON i.id = l.item_id
     JOIN users u ON u.id = l.added_by
     LEFT JOIN line_removals r ON r.line_id = l.id
     LEFT JOIN users ru ON ru.id = r.removed_by
     WHERE l.bill_id = ?
     ORDER BY l.added_at, l.rowid`,
    billId,
  );
  const lines = rows.map(({ removalBy, removalByName, removalAt, removalReason, ...line }) => ({
    ...line,
    removal: correction(removalBy, removalByName, removalAt, removalReason),
  }));
  const paymentRows = yield* db.all(
    PaymentRow,
    `SELECT p.id, p.amount, p.method, p.received_by AS "by", u.name AS byName,
            p.received_at AS at, p.day,
            r.removed_by AS removalBy, ru.name AS removalByName,
            r.removed_at AS removalAt, r.reason AS removalReason
     FROM payments p
     JOIN users u ON u.id = p.received_by
     LEFT JOIN payment_removals r ON r.payment_id = p.id
     LEFT JOIN users ru ON ru.id = r.removed_by
     WHERE p.bill_id = ?
     ORDER BY p.received_at, p.rowid`,
    billId,
  );
  const payments = paymentRows.map(({ removalBy, removalByName, removalAt, removalReason, ...payment }) => ({
    ...payment,
    removal: correction(removalBy, removalByName, removalAt, removalReason),
  }));
  const voided = yield* db.first(
    VoidRow,
    `SELECT v.voided_by AS "by", u.name AS byName, v.voided_at AS at, v.reason
     FROM bill_voids v
     JOIN users u ON u.id = v.voided_by
     WHERE v.bill_id = ?`,
    billId,
  );
  return { ...bill, lines, payments, voided: voided ?? null };
});
