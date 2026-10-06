import { Effect, Schema } from "effect";

import type { Instant } from "~/shared/day";
import { newId } from "~/shared/id";

import { Db, type Param, statement, type Condition, type Statement } from "./db";

/**
 * One submission per rendered form (spec §3.4). A form that creates a Bill, a
 * Payment, an Adjustment or a Count carries a key made when it was rendered,
 * and the operation records one submission per key: a double tap, or a retry
 * after a response lost on a bad connection, writes nothing and is answered
 * as the first one was.
 *
 * An operation uses the three parts together:
 *
 *     const submission = submissionOf("payment", user.id, input.submissionKey);
 *     const earlier = yield* recordedAnswer(PaymentAnswer, submission);
 *     if (earlier) return earlier;
 *     ...
 *     const condition = both(rules, notYetRecorded(submission));
 *     const [recorded] = yield* db.batch([
 *       ...paymentStatements(payment, condition),
 *       submissionStatement(submission, { at, answer: json(answer), wrote: paymentWritten }),
 *     ]);
 *     if (recorded.changes === 0) {
 *       const meanwhile = yield* recordedAnswer(PaymentAnswer, submission);
 *       if (meanwhile) return meanwhile;
 *       ...which rule refused it...
 *     }
 *
 * A D1 batch cannot branch, so every statement of the batch carries
 * `notYetRecorded`, and the key is written last, by the batch that recorded
 * something. Two requests with the same key that both got past the first read
 * run one batch after the other: the second finds the key and writes nothing.
 * The table's primary key is the rule underneath: a batch that tried to write
 * a taken key would fail whole.
 *
 * A refused operation writes no key, so the same form can be sent again once
 * what was wrong is corrected.
 */

/** The kinds of form that carry a key: what each one creates. */
export type SubmittedForm = "selection" | "payment" | "handover" | "adjustment" | "count";

/** One rendered form as the server knows it: whose, of what kind, and its key. */
export interface Submission {
  readonly by: string;
  readonly form: SubmittedForm;
  readonly key: string;
}

/** The longest key a form may carry; `newId()` is 36 characters. */
const KEY_LIMIT = 64;

/**
 * The submission an operation is asked to record. A request without a key
 * (or with one no form of this app made) gets a key of its own, so it is
 * recorded like any other and repeats nothing.
 */
export function submissionOf(form: SubmittedForm, by: string, key: string | null | undefined): Submission {
  return { by, form, key: key && key.length <= KEY_LIMIT ? key : newId() };
}

const identity = (submission: Submission): ReadonlyArray<Param> => [
  submission.by,
  submission.form,
  submission.key,
];

/** What a recorded submission answered, or `undefined` when its key is new. */
export const recordedAnswer = Effect.fnUntraced(function* <A>(
  answer: Schema.Decoder<A>,
  submission: Submission,
) {
  const db = yield* Db;
  const row = yield* db.first(
    Schema.Struct({ result: Schema.fromJsonString(answer) }),
    "SELECT result FROM submissions WHERE submitted_by = ? AND form = ? AND key = ?",
    ...identity(submission),
  );
  return row?.result;
});

/** The condition every statement of the batch carries: this key recorded nothing yet. */
export function notYetRecorded(submission: Submission): Condition {
  return {
    sql: "NOT EXISTS (SELECT 1 FROM submissions WHERE submitted_by = ? AND form = ? AND key = ?)",
    params: identity(submission),
  };
}

/** Two conditions as one, for the statements of a batch to share. */
export function both(first: Condition, second: Condition): Condition {
  return { sql: `(${first.sql}) AND (${second.sql})`, params: [...first.params, ...second.params] };
}

/** A SQL expression and its parameters: the answer a submission is recorded with. */
export interface SqlValue {
  readonly sql: string;
  readonly params: ReadonlyArray<Param>;
}

/** An answer known before the batch runs, as the SQL value `submissionStatement` takes. */
export function json(answer: unknown): SqlValue {
  return { sql: "?", params: [JSON.stringify(answer)] };
}

/**
 * The last statement of the batch: the key, with what the operation answers.
 * `wrote` is true when this batch wrote its fact (`EXISTS (SELECT 1 FROM
 * payments WHERE id = ?)`), so a refused operation leaves the key free.
 * `answer` is a SQL value holding JSON: `json(...)`, or a scalar subquery
 * that reads what the batch left.
 */
export function submissionStatement(
  submission: Submission,
  recorded: { readonly at: Instant; readonly answer: SqlValue; readonly wrote: Condition },
): Statement {
  return statement(
    `INSERT INTO submissions (submitted_by, form, key, result, recorded_at)
     SELECT ?, ?, ?, ${recorded.answer.sql}, ?
     WHERE ${recorded.wrote.sql}`,
    ...identity(submission),
    ...recorded.answer.params,
    recorded.at,
    ...recorded.wrote.params,
  );
}
