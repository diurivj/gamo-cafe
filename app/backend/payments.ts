import { Data } from "effect";

import type { Day, Instant } from "~/shared/day";
import type { Centavos } from "~/shared/money";
import type { PaymentMethod } from "~/shared/payment";

import { statement, type Condition, type Statement } from "./db";

/**
 * Payments (spec §2.3, §5.5, §7.2). A Payment is a fact: it is written once
 * and never updated; removing one is a `payment_removals` row (ticket 11).
 * The Bill's `paid` projection is written only in the same batch as the
 * Payment that moves it (spec §7.1).
 *
 * A batch cannot branch, so every rule about a Payment lives in the SQL of
 * its two statements: the amount is greater than zero and never more than the
 * Bill still owes, and the Bill is still Open at the revision the User's page
 * was rendered from. The conditions travel with the statements, so a refused
 * Payment writes neither the fact nor the projection.
 *
 * The operations that take a Payment live with the Bills they settle
 * (`recordSelection` and `takePayment` in `./bills`).
 */

/** A Payment of zero or less, or not a whole number of centavos (spec §2.3). */
export class PaymentNotPositive extends Data.TaggedError("PaymentNotPositive")<{}> {}

/** A Payment greater than what the Bill still owes (spec §2.3, §5.5). */
export class PaymentExceedsOwed extends Data.TaggedError("PaymentExceedsOwed")<{
  readonly owed: Centavos;
}> {}

/** A Payment on a Voided Bill, which counts toward nothing (spec §5.7). */
export class BillIsVoided extends Data.TaggedError("BillIsVoided")<{ readonly billId: string }> {}

/**
 * The Bill moved since the User's page was rendered: the submission is stale
 * and changes nothing (spec §5.5, §7.3).
 */
export class BillChanged extends Data.TaggedError("BillChanged")<{ readonly billId: string }> {}

export interface NewPayment {
  readonly id: string;
  readonly billId: string;
  readonly amount: Centavos;
  readonly method: PaymentMethod;
  /** The User who received it. */
  readonly by: string;
  readonly at: Instant;
  readonly day: Day;
}

/**
 * The two statements that record a Payment, for a batch: the fact, then the
 * Bill's projections (`paid`, `revision` and the derived state of §5.6).
 *
 * `when` is the condition every statement of the batch shares, so a refused
 * operation writes nothing at all; both statements also carry
 * `paid + amount <= total` themselves, the conditional write that says a
 * Payment is never more than the Bill still owes. When the first statement's
 * `changes` is 0, nothing was recorded.
 */
export function paymentStatements(payment: NewPayment, when: Condition): ReadonlyArray<Statement> {
  const { id, billId, amount, method, by, at, day } = payment;
  return [
    statement(
      `INSERT INTO payments (id, bill_id, amount, method, handover_reference, received_by, received_at, day)
       SELECT ?, b.id, ?, ?, NULL, ?, ?, ?
       FROM bills b
       WHERE b.id = ? AND (${when.sql}) AND b.paid + ? <= b.total`,
      id,
      amount,
      method,
      by,
      at,
      day,
      billId,
      ...when.params,
      amount,
    ),
    statement(
      // The state is derived from the totals in the same statement, never set
      // by hand (spec §5.6).
      `UPDATE bills
       SET paid = paid + ?,
           revision = revision + 1,
           state = CASE WHEN paid + ? >= total THEN 'paid'
                        WHEN paid + ? > 0 THEN 'partial'
                        ELSE 'open' END
       WHERE id = ? AND (${when.sql}) AND paid + ? <= total`,
      amount,
      amount,
      amount,
      billId,
      ...when.params,
      amount,
    ),
  ];
}
