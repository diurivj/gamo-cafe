import { Data, Effect, Schema } from "effect";

import { BILL_STATES } from "~/shared/bill-state";
import { newId } from "~/shared/id";
import type { Centavos } from "~/shared/money";
import { trimToNull } from "~/shared/text";

import { BillNotFound } from "./bills";
import { AdminOnly, CurrentUser, requireAdmin } from "./current-user";
import { Db, statement } from "./db";
import { BillChanged, BillIsVoided } from "./payments";
import { billVoidStock, lineRemovalStock } from "./stock";
import { now } from "./time";

/**
 * Corrections (spec §5.7, §7.3.3, ADR 0002): removing a Line, removing a
 * Payment and voiding a Bill. Each is one fact of its own, written in one
 * batch with the effect on the Bill's projections and on Stock, and the
 * record it corrects is never touched. Every statement of a correction other
 * than the fact itself is keyed by the fact's id, so a refused correction
 * writes nothing at all: a D1 batch cannot branch, and the conditions live in
 * the fact's `INSERT ... SELECT` (spec §7.3).
 *
 * The conditions include the Bill's revision, so a submission from a page
 * that has since moved changes nothing and is told the Bill changed. The
 * operations classify a refusal again from the rows as they are now, so the
 * route can answer the exact rule.
 *
 * The projection rules a correction keeps true:
 *
 * - the Bill's `total` is the sum of its unremoved Lines and its `paid` the
 *   sum of its unremoved Payments, so `paid <= total` (the column's CHECK)
 *   keeps holding and "has a Payment" stays `paid > 0` for the routes and
 *   ticket 10;
 * - the state is derived from those totals in the same statement (§5.6), and
 *   a Bill left with no Lines is Paid with a zero total;
 * - Stock moves from the Line's `moved_stock` fact, once per Line, never from
 *   the Item's flag today.
 */

const BillStateSchema = Schema.Literals(BILL_STATES);

/** A Line that is not on the Bill, or whose removal is already recorded. */
export class LineNotFound extends Data.TaggedError("LineNotFound")<{ readonly lineId: string }> {}

/** A Payment that is not on the Bill, or whose removal is already recorded. */
export class PaymentNotFound extends Data.TaggedError("PaymentNotFound")<{ readonly paymentId: string }> {}

/** An Admin-only correction without the reason it requires (spec §5.7). */
export class ReasonRequired extends Data.TaggedError("ReasonRequired")<{}> {}

/**
 * Removing the Line would leave the Bill's total below its Payments (spec
 * §5.7). The Admin removes a Payment first.
 */
export class TotalBelowPayments extends Data.TaggedError("TotalBelowPayments")<{
  readonly paid: Centavos;
  /** What the total would become. */
  readonly remaining: Centavos;
}> {}

const BillRow = Schema.Struct({
  total: Schema.Int,
  paid: Schema.Int,
  state: BillStateSchema,
  revision: Schema.Int,
});

const LineRow = Schema.Struct({
  quantity: Schema.Int,
  unitPrice: Schema.Int,
  removalId: Schema.NullOr(Schema.String),
});

const PaymentRow = Schema.Struct({ amount: Schema.Int, removalId: Schema.NullOr(Schema.String) });

type BillFigures = typeof BillRow.Type;

/**
 * What a recorded correction answers: its fact's id and the Bill's figures as
 * it left them, which is all the screen says afterwards. Nothing is read again
 * for it.
 */
export interface Corrected {
  readonly id: string;
  readonly total: Centavos;
  readonly paid: Centavos;
  readonly voided: boolean;
}

const readBill = (billId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.first(
      BillRow,
      "SELECT total, paid, state, revision FROM bills WHERE id = ?",
      billId,
    );
  });

/** The Line as it is now, with whether its removal is already recorded. */
const readLine = (billId: string, lineId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.first(
      LineRow,
      `SELECT l.quantity, l.unit_price AS unitPrice, r.id AS removalId
       FROM lines l LEFT JOIN line_removals r ON r.line_id = l.id
       WHERE l.id = ? AND l.bill_id = ?`,
      lineId,
      billId,
    );
  });

/** The Payment as it is now, with whether its removal is already recorded. */
const readPayment = (billId: string, paymentId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.first(
      PaymentRow,
      `SELECT p.amount, r.id AS removalId
       FROM payments p LEFT JOIN payment_removals r ON r.payment_id = p.id
       WHERE p.id = ? AND p.bill_id = ?`,
      paymentId,
      billId,
    );
  });

export interface RemoveLineInput {
  readonly billId: string;
  readonly lineId: string;
  /**
   * Required when the Bill has a Payment; optional, and kept when given,
   * otherwise (spec §5.7).
   */
  readonly reason?: string | null;
  /** The revision the User's page showed: a stale submission changes nothing. */
  readonly expectedRevision: number;
}

/**
 * Removes a Line whole (spec §5.7): any User while the Bill has no Payment,
 * an Admin with a reason otherwise, refused when the removal would leave the
 * Bill's total below its Payments. The Line's units return to Stock from the
 * Line's own `moved_stock` fact.
 */
export const removeLine = Effect.fn("removeLine")(function* (input: RemoveLineInput) {
  const db = yield* Db;
  const user = yield* CurrentUser;
  const { billId, lineId, expectedRevision } = input;
  const reason = trimToNull(input.reason);
  const isAdmin = user.role === "admin";

  const bill = yield* readBill(billId);
  if (!bill) return yield* new BillNotFound({ billId });
  if (bill.state === "voided") return yield* new BillIsVoided({ billId });
  if (bill.revision !== expectedRevision) return yield* new BillChanged({ billId });

  const line = yield* readLine(billId, lineId);
  if (!line || line.removalId !== null) return yield* new LineNotFound({ lineId });
  if (bill.paid > 0 && !isAdmin) return yield* new AdminOnly();
  if (bill.paid > 0 && reason === null) return yield* new ReasonRequired();

  const lineTotal = line.quantity * line.unitPrice;
  const remaining = bill.total - lineTotal;
  if (remaining < bill.paid) return yield* new TotalBelowPayments({ paid: bill.paid, remaining });

  const at = yield* now;
  const id = newId();
  const [recorded] = yield* db.batch([
    statement(
      // The fact, conditional on the revision, the Bill still being Open, the
      // Line still counting, the total staying at or above the Payments and,
      // once there is a Payment, the author being an Admin.
      `INSERT INTO line_removals (id, line_id, reason, removed_by, removed_at)
       SELECT ?, l.id, ?, ?, ?
       FROM lines l JOIN bills b ON b.id = l.bill_id
       WHERE l.id = ? AND l.bill_id = ?
         AND b.revision = ?
         AND b.state IN ('open', 'partial')
         AND b.total - l.quantity * l.unit_price >= b.paid
         AND NOT EXISTS (SELECT 1 FROM line_removals r WHERE r.line_id = l.id)
         AND (b.paid = 0 OR ? = 1)`,
      id,
      reason,
      user.id,
      at,
      lineId,
      billId,
      expectedRevision,
      isAdmin ? 1 : 0,
    ),
    statement(
      // The projections, tied to the fact: total down, revision up, and the
      // state derived from the new totals (§5.6).
      `UPDATE bills
       SET total = total - ?,
           revision = revision + 1,
           state = CASE WHEN paid >= total - ? THEN 'paid'
                        WHEN paid > 0 THEN 'partial'
                        ELSE 'open' END
       WHERE id = ? AND EXISTS (SELECT 1 FROM line_removals WHERE id = ?)`,
      lineTotal,
      lineTotal,
      billId,
      id,
    ),
    lineRemovalStock(id),
  ]);

  if (recorded!.changes === 0) return yield* classifyRemoveLine(billId, lineId, expectedRevision, reason, user);
  return { id, total: remaining, paid: bill.paid, voided: false } satisfies Corrected;
});

/** Why the removal's fact wrote nothing, from the rows as they are now. */
const classifyRemoveLine = Effect.fnUntraced(function* (
  billId: string,
  lineId: string,
  expectedRevision: number,
  reason: string | null,
  user: CurrentUser["Service"],
) {
  const bill: BillFigures | undefined = yield* readBill(billId);
  if (!bill) return yield* new BillNotFound({ billId });
  if (bill.state === "voided") return yield* new BillIsVoided({ billId });
  if (bill.revision !== expectedRevision) return yield* new BillChanged({ billId });
  if (bill.paid > 0 && user.role !== "admin") return yield* new AdminOnly();
  if (bill.paid > 0 && reason === null) return yield* new ReasonRequired();
  const line = yield* readLine(billId, lineId);
  if (!line || line.removalId !== null) return yield* new LineNotFound({ lineId });
  return yield* new TotalBelowPayments({
    paid: bill.paid,
    remaining: bill.total - line.quantity * line.unitPrice,
  });
});

export interface RemovePaymentInput {
  readonly billId: string;
  readonly paymentId: string;
  /** Required; its absence is refused with `ReasonRequired`. */
  readonly reason?: string | null;
  /** The revision the User's page showed: a stale submission changes nothing. */
  readonly expectedRevision: number;
}

/**
 * Removes a Payment: an Admin, with a reason (spec §5.7). The Bill's `paid`
 * projection falls in the same batch, so "has a Payment" and `paid <= total`
 * keep holding — a Paid Bill becomes Abierta or Pago parcial again. A Payment
 * on a Voided Bill, which counts toward nothing, is refused.
 */
export const removePayment = Effect.fn("removePayment")(function* (input: RemovePaymentInput) {
  const db = yield* Db;
  const user = yield* requireAdmin;
  const { billId, paymentId, expectedRevision } = input;
  const reason = trimToNull(input.reason);

  const bill = yield* readBill(billId);
  if (!bill) return yield* new BillNotFound({ billId });
  if (bill.state === "voided") return yield* new BillIsVoided({ billId });
  if (bill.revision !== expectedRevision) return yield* new BillChanged({ billId });
  if (reason === null) return yield* new ReasonRequired();
  const payment = yield* readPayment(billId, paymentId);
  if (!payment || payment.removalId !== null) return yield* new PaymentNotFound({ paymentId });

  const id = newId();
  const at = yield* now;
  const [recorded] = yield* db.batch([
    statement(
      `INSERT INTO payment_removals (id, payment_id, reason, removed_by, removed_at)
       SELECT ?, p.id, ?, ?, ?
       FROM payments p JOIN bills b ON b.id = p.bill_id
       WHERE p.id = ? AND p.bill_id = ?
         AND b.revision = ?
         AND b.state IN ('open', 'partial', 'paid')
         AND NOT EXISTS (SELECT 1 FROM payment_removals r WHERE r.payment_id = p.id)`,
      id,
      reason,
      user.id,
      at,
      paymentId,
      billId,
      expectedRevision,
    ),
    statement(
      // paid falls; the state follows it, so a Paid Bill becomes Abierta or
      // Pago parcial again (§5.6). The CHECK paid >= 0 holds because the sum
      // of the unremoved Payments is `paid` and this one is part of it.
      `UPDATE bills
       SET paid = paid - ?,
           revision = revision + 1,
           state = CASE WHEN paid - ? >= total THEN 'paid'
                        WHEN paid - ? > 0 THEN 'partial'
                        ELSE 'open' END
       WHERE id = ? AND EXISTS (SELECT 1 FROM payment_removals WHERE id = ?)`,
      payment.amount,
      payment.amount,
      payment.amount,
      billId,
      id,
    ),
  ]);

  if (recorded!.changes === 0) return yield* classifyRemovePayment(billId, paymentId, expectedRevision, reason);
  return { id, total: bill.total, paid: bill.paid - payment.amount, voided: false } satisfies Corrected;
});

/** Why the removal's fact wrote nothing, from the rows as they are now. */
const classifyRemovePayment = Effect.fnUntraced(function* (
  billId: string,
  paymentId: string,
  expectedRevision: number,
  reason: string | null,
) {
  const bill: BillFigures | undefined = yield* readBill(billId);
  if (!bill) return yield* new BillNotFound({ billId });
  if (bill.state === "voided") return yield* new BillIsVoided({ billId });
  if (bill.revision !== expectedRevision) return yield* new BillChanged({ billId });
  if (reason === null) return yield* new ReasonRequired();
  return yield* new PaymentNotFound({ paymentId });
});

export interface VoidBillInput {
  readonly billId: string;
  /** Required; its absence is refused with `ReasonRequired`. */
  readonly reason?: string | null;
  /** The revision the User's page showed: a stale submission changes nothing. */
  readonly expectedRevision: number;
}

/**
 * Voids a Bill: an Admin, with a reason, and it cannot be undone (spec §5.7).
 * It keeps its Lines, Payments and totals on record; its unremoved Lines'
 * units return to Stock, once per Line, while its Lines leave Sold and its
 * Payments leave Collected. A Voided Bill refuses the later corrections, and
 * `listOpenBills` and takePayment never touch it because its state is no
 * longer Open.
 */
export const voidBill = Effect.fn("voidBill")(function* (input: VoidBillInput) {
  const db = yield* Db;
  const user = yield* requireAdmin;
  const { billId, expectedRevision } = input;
  const reason = trimToNull(input.reason);

  const bill = yield* readBill(billId);
  if (!bill) return yield* new BillNotFound({ billId });
  if (bill.state === "voided") return yield* new BillIsVoided({ billId });
  if (bill.revision !== expectedRevision) return yield* new BillChanged({ billId });
  if (reason === null) return yield* new ReasonRequired();

  const id = newId();
  const at = yield* now;
  const [recorded] = yield* db.batch([
    statement(
      `INSERT INTO bill_voids (id, bill_id, reason, voided_by, voided_at)
       SELECT ?, b.id, ?, ?, ?
       FROM bills b
       WHERE b.id = ? AND b.revision = ? AND b.state IN ('open', 'partial', 'paid')`,
      id,
      reason,
      user.id,
      at,
      billId,
      expectedRevision,
    ),
    statement(
      `UPDATE bills
       SET state = 'voided', revision = revision + 1
       WHERE id = ? AND EXISTS (SELECT 1 FROM bill_voids WHERE id = ?)`,
      billId,
      id,
    ),
    billVoidStock(id),
  ]);

  if (recorded!.changes === 0) return yield* classifyVoid(billId);
  return { id, total: bill.total, paid: bill.paid, voided: true } satisfies Corrected;
});

/** Why the void's fact wrote nothing, from the Bill as it is now. */
const classifyVoid = Effect.fnUntraced(function* (billId: string) {
  const bill: BillFigures | undefined = yield* readBill(billId);
  if (!bill) return yield* new BillNotFound({ billId });
  if (bill.state === "voided") return yield* new BillIsVoided({ billId });
  return yield* new BillChanged({ billId });
});

/** A correction as a form names it: the Line, the Payment, or the Bill itself. */
export type CorrectionAsked =
  | { readonly intent: "quitar-linea"; readonly billId: string; readonly lineId: string }
  | { readonly intent: "quitar-pago"; readonly billId: string; readonly paymentId: string }
  | { readonly intent: "cancelar-cuenta"; readonly billId: string };

const CorrectedRow = Schema.Struct({
  id: Schema.String,
  total: Schema.Int,
  paid: Schema.Int,
  state: BillStateSchema,
});

/**
 * The correction this User already recorded on that record with that very
 * reason, with the Bill as it is now, or `undefined` when they recorded none.
 * A correction of theirs with another reason is not the form that was sent.
 *
 * It is how a correction sent again is answered (UI redesign §6.1). A record
 * is corrected at most once and every correction moves the Bill's revision,
 * so the same form sent after an answer was lost is refused as stale and
 * writes nothing; this tells the User whose first attempt was recorded that
 * it was, in place of "the Bill changed". It reads and decides nothing: the
 * rules stay in the operations above.
 */
export const recordedCorrection = Effect.fn("recordedCorrection")(function* (
  asked: CorrectionAsked,
  sentReason?: string | null,
) {
  const db = yield* Db;
  const user = yield* CurrentUser;
  const reason = trimToNull(sentReason);

  const row =
    asked.intent === "quitar-linea"
      ? yield* db.first(
          CorrectedRow,
          `SELECT r.id, b.total, b.paid, b.state
           FROM line_removals r
           JOIN lines l ON l.id = r.line_id
           JOIN bills b ON b.id = l.bill_id
           WHERE r.line_id = ? AND l.bill_id = ? AND r.removed_by = ? AND r.reason IS ?`,
          asked.lineId,
          asked.billId,
          user.id,
          reason,
        )
      : asked.intent === "quitar-pago"
        ? yield* db.first(
            CorrectedRow,
            `SELECT r.id, b.total, b.paid, b.state
             FROM payment_removals r
             JOIN payments p ON p.id = r.payment_id
             JOIN bills b ON b.id = p.bill_id
             WHERE r.payment_id = ? AND p.bill_id = ? AND r.removed_by = ? AND r.reason IS ?`,
            asked.paymentId,
            asked.billId,
            user.id,
            reason,
          )
        : yield* db.first(
            CorrectedRow,
            `SELECT v.id, b.total, b.paid, b.state
             FROM bill_voids v JOIN bills b ON b.id = v.bill_id
             WHERE v.bill_id = ? AND v.voided_by = ? AND v.reason IS ?`,
            asked.billId,
            user.id,
            reason,
          );
  if (!row) return undefined;
  return { id: row.id, total: row.total, paid: row.paid, voided: row.state === "voided" } satisfies Corrected;
});
