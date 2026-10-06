import { Effect, Schema } from "effect";

import { sha256Hex } from "~/shared/sha256";
import type { Instant } from "~/shared/day";
import { newId } from "~/shared/id";

import { Db, type Param, statement, type Condition, type Statement } from "./db";

/**
 * One submission per rendered form (spec §3.4). A form that creates a Bill, a
 * Payment, an Adjustment or a Count carries a key made when it was rendered,
 * and the operation records one submission per key and content: a double tap,
 * or a retry after a response lost on a bad connection, writes nothing and is
 * answered as the first one was.
 *
 * The content is the form's fields as the operation reads them, canonicalized
 * and hashed (`digestOf`). The key alone identifies the rendered form, and a
 * restored document (the browser's Back after a recorded submission, say)
 * still carries its used key; the digest is what tells a repeat of that form
 * from a genuinely different one sent from the same document. The same key
 * with the same content is the repeat; the same key with different content is
 * a form nothing was recorded for, and is recorded (or refused by a rule)
 * like any new submission, never answered silently as the earlier one.
 *
 * An operation uses the parts together:
 *
 *     const submission = yield* submissionOf("payment", user.id, input.submissionKey, [
 *       input.billId, input.expectedRevision, input.amount ?? null, input.method,
 *     ]);
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
 * something. Two requests with the same key and content that both got past
 * the first read run one batch after the other: the second finds the key and
 * writes nothing. The table's primary key is the rule underneath: a batch
 * that tried to write a taken (key, digest) would fail whole.
 *
 * A refused operation writes no key, so the same form can be sent again once
 * what was wrong is corrected.
 */

/** The kinds of form that carry a key: what each one creates. */
export type SubmittedForm = "selection" | "payment" | "handover" | "adjustment" | "count";

/** One rendered form as the server knows it: whose, of what kind, its key, and what it carried. */
export interface Submission {
  readonly by: string;
  readonly form: SubmittedForm;
  readonly key: string;
  /** The SHA-256 of the form's canonical content, in hex. */
  readonly digest: string;
}

/** The longest key a form may carry; `newId()` is 36 characters. */
const KEY_LIMIT = 64;

/**
 * What a form carried, in a fixed order: one entry per field the operation
 * records, each as the operation reads it (trimmed text, `null` for nothing
 * said). JSON-serializable, and the same for every send of one rendered form.
 */
type SubmissionContent = ReadonlyArray<unknown>;

/** The digest of a form's content: its canonical JSON, hashed. */
const digestOf = (content: SubmissionContent): Effect.Effect<string> =>
  Effect.promise(() => sha256Hex(JSON.stringify(content)));

/**
 * The submission an operation is asked to record. A request without a key
 * (or with one no form of this app made) gets a key of its own, so it is
 * recorded like any other and repeats nothing.
 */
export const submissionOf = Effect.fnUntraced(function* (
  form: SubmittedForm,
  by: string,
  key: string | null | undefined,
  content: SubmissionContent,
) {
  const digest = yield* digestOf(content);
  return { by, form, key: key && key.length <= KEY_LIMIT ? key : newId(), digest };
});

const identity = (submission: Submission): ReadonlyArray<Param> => [
  submission.by,
  submission.form,
  submission.key,
  submission.digest,
];

/** What a recorded submission answered, or `undefined` when this key and content are new. */
export const recordedAnswer = Effect.fnUntraced(function* <A>(
  answer: Schema.Decoder<A>,
  submission: Submission,
) {
  const db = yield* Db;
  const row = yield* db.first(
    Schema.Struct({ result: Schema.fromJsonString(answer) }),
    "SELECT result FROM submissions WHERE submitted_by = ? AND form = ? AND key = ? AND digest = ?",
    ...identity(submission),
  );
  return row?.result;
});

/** The condition every statement of the batch carries: this key and content recorded nothing yet. */
export function notYetRecorded(submission: Submission): Condition {
  return {
    sql: "NOT EXISTS (SELECT 1 FROM submissions WHERE submitted_by = ? AND form = ? AND key = ? AND digest = ?)",
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
 * The last statement of the batch: the key and the content's digest, with
 * what the operation answers. `wrote` is true when this batch wrote its fact
 * (`EXISTS (SELECT 1 FROM payments WHERE id = ?)`), so a refused operation
 * leaves the key free. `answer` is a SQL value holding JSON: `json(...)`, or a
 * scalar subquery that reads what the batch left.
 */
export function submissionStatement(
  submission: Submission,
  recorded: { readonly at: Instant; readonly answer: SqlValue; readonly wrote: Condition },
): Statement {
  return statement(
    `INSERT INTO submissions (submitted_by, form, key, digest, result, recorded_at)
     SELECT ?, ?, ?, ?, ${recorded.answer.sql}, ?
     WHERE ${recorded.wrote.sql}`,
    ...identity(submission),
    ...recorded.answer.params,
    recorded.at,
    ...recorded.wrote.params,
  );
}
