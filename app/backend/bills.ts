import { Data, Effect, Schema } from "effect";

import { BILL_STATES, type BillState, isOpenBill } from "~/shared/bill-state";
import { dayOf, type Day, type Instant } from "~/shared/day";
import { newId } from "~/shared/id";
import type { Centavos } from "~/shared/money";
import { normalizeName } from "~/shared/normalize-name";

import { CurrentUser } from "./current-user";
import { Db, statement, type Condition, type Statement } from "./db";
import { changeStock } from "./stock";
import { now } from "./time";

/**
 * Bills and Lines (spec §5.3, §5.4). A Bill comes into existence with its
 * first Line, and its state is derived from its records, never set by hand
 * (spec §5.6).
 *
 * `getBill` and `listOpenBills` are the reads Cuentas abiertas and Cuenta are
 * built on (ticket 07); `getBill` carries the §4.1 gate for a Bill that is not
 * Open.
 *
 * "Record a selection" (spec §7.3.1) is one batch: the new Bill when one is
 * needed, one Line per distinct Item at the price the Item had, the Bill's
 * projections and the Stock of every stock-tracked Item. Adding Lines never
 * conflicts: totals and Stock change by relative amounts, so two phones
 * adding to the same Bill both succeed. Ticket 08 appends the on-the-spot
 * Payment's statements to that same batch.
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
}

export type Bill = BillSummary & { readonly lines: ReadonlyArray<BillLine> };

const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");

/** The note as stored: space trimmed; empty is no note. */
const tidyNote = (note: string | null | undefined) => (note ?? "").trim();

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

/**
 * Records a selection as Lines on a Bill (spec §7.3.1), in one batch:
 *
 * - the Bill: the given Open Bill, else the Customer's most recently opened
 *   Open Bill of the current Day, else a new one;
 * - one Line per distinct Item, at the price read now;
 * - the Bill's projections: total, revision and the derived state (§5.6);
 * - Stock, down by the quantity of every stock-tracked Item.
 *
 * Every statement carries the same condition (`Condition`), because a D1
 * batch cannot branch: when an Item was retired or a target Bill stopped
 * being Open since it was read, nothing at all is written. Ticket 08 adds the
 * Payment's statements after these, carrying the same condition.
 */
export const recordSelection = Effect.fn("recordSelection")(function* (input: NewSelection) {
  const db = yield* Db;
  const user = yield* CurrentUser;

  const customerId = input.customerId || null;
  const billId = input.billId || null;
  const note = tidyNote(input.note) || null;

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
   * What every statement of the batch asks for, so a refused selection writes
   * nothing: all chosen Items are still active, and, when the Lines go onto
   * an existing Bill, that Bill is still Open.
   */
  const condition: Condition = {
    sql: [
      `(SELECT COUNT(*) FROM items WHERE id IN (${placeholders(itemIds.length)}) AND retired_at IS NULL) = ?`,
      ...(target ? ["EXISTS (SELECT 1 FROM bills WHERE id = ? AND state IN ('open', 'partial'))"] : []),
    ].join(" AND "),
    params: [...itemIds, itemIds.length, ...(target ? [target.id] : [])],
  };

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
          // it owes nothing, when it is Paid.
          `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, note, total, paid, state, revision)
           SELECT ?, ?, ?, ?, ?, ?, ?, 0, CASE WHEN 0 >= ? THEN 'paid' ELSE 'open' END, 0
           WHERE (${condition.sql})`,
          bill.id,
          day,
          user.id,
          at,
          customerId,
          note,
          delta,
          delta,
          ...condition.params,
        ),
  ];

  for (const line of lines) {
    statements.push(
      statement(
        // `moved_stock` is a fact about this Line, set from the Item's flag at
        // this moment, as `changeStock` below reads it too.
        `INSERT INTO lines (id, bill_id, item_id, quantity, unit_price, moved_stock, added_by, added_at, day)
         SELECT ?, ?, id, ?, ?, stock_tracked, ?, ?, ?
         FROM items
         WHERE id = ? AND EXISTS (SELECT 1 FROM bills WHERE id = ?) AND (${condition.sql})`,
        line.id,
        bill.id,
        line.quantity,
        line.unitPrice,
        user.id,
        at,
        day,
        line.itemId,
        bill.id,
        ...condition.params,
      ),
    );
  }

  for (const line of lines) statements.push(changeStock(line.itemId, -line.quantity, condition));

  const results = yield* db.batch(statements);
  if (results[0]!.changes === 0) {
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

/** The end of a prefix on `normalized_name`, as `searchCustomers` uses. */
const LAST_CHARACTER = "\u{10FFFF}";

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
    ...(prefix === "" ? [] : [prefix, prefix + LAST_CHARACTER]),
  );
  return rows.map(summary);
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
});

/**
 * One Bill with its Lines, oldest first, each with its Item, author and
 * moment. The read Cuenta (ticket 07) builds on.
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
  const lines = yield* db.all(
    LineRow,
    `SELECT l.id, l.item_id AS itemId, i.name AS itemName, l.quantity,
            l.unit_price AS unitPrice, l.added_by AS "by", u.name AS byName,
            l.added_at AS at, l.day
     FROM lines l
     JOIN items i ON i.id = l.item_id
     JOIN users u ON u.id = l.added_by
     WHERE l.bill_id = ?
     ORDER BY l.added_at, l.rowid`,
    billId,
  );
  return { ...bill, lines };
});
