import { data } from "react-router";
import { Effect, Result, Schema } from "effect";

import { type BillNotFound, getBill } from "~/backend/bills";
import {
  type Corrected,
  type CorrectionAsked,
  type LineNotFound,
  type PaymentNotFound,
  type ReasonRequired,
  type TotalBelowPayments,
  recordedCorrection,
  removeLine,
  removePayment,
  voidBill,
} from "~/backend/corrections";
import { type AdminOnly, CurrentUser } from "~/backend/current-user";
import type { BillChanged, BillIsVoided } from "~/backend/payments";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";
import type { CorrectionAnswer, CorrectionRefusal } from "~/shared/correction";
import { CORRECTION_INTENTS, correctionMessages } from "~/shared/correction-messages";
import { trimToNull } from "~/shared/text";

import type { Route } from "./+types/record-correction";

// Where Cuenta sends a correction (UI redesign §6, §7.2; spec §5.7, §7.3.3):
// removing a Line, removing a Payment or voiding the Bill, at the revision the
// screen showed. It answers JSON to the browser's own `fetch` (`sendForRecord`
// in ~/shared/record-request): the Bill's figures as the correction left
// them, or the Spanish reason it was refused. The server enforces the
// permissions, not the screen: a Worker sending an Admin's correction is
// answered 403.
//
// A correction sent again after its answer was lost finds the Bill moved and
// is refused, writing nothing. When the record already carries this User's own
// correction, with the reason that was sent, the answer is that correction, so
// the retry says what happened.

type CorrectionError =
  | BillNotFound
  | BillChanged
  | BillIsVoided
  | AdminOnly
  | LineNotFound
  | PaymentNotFound
  | ReasonRequired
  | TotalBelowPayments;

/** A refusal and its status. `stale`: the Bill is not what the screen showed. */
interface Refused {
  readonly error: string;
  readonly status: 400 | 403 | 404;
  readonly stale: boolean;
}

/** What each rule violation of a correction answers, in Spanish (spec §5.7). */
function answerCorrectionError(error: CorrectionError): Refused {
  switch (error._tag) {
    case "BillNotFound":
      return { error: correctionMessages.BillNotFound, status: 404, stale: true };
    case "AdminOnly":
      return { error: correctionMessages.AdminOnly, status: 403, stale: false };
    case "BillChanged":
      return { error: correctionMessages.BillChanged, status: 400, stale: true };
    case "BillIsVoided":
      return { error: correctionMessages.BillIsVoided, status: 400, stale: true };
    case "LineNotFound":
      return { error: correctionMessages.LineNotFound, status: 400, stale: true };
    case "PaymentNotFound":
      return { error: correctionMessages.PaymentNotFound, status: 400, stale: true };
    case "ReasonRequired":
      return { error: correctionMessages.ReasonRequired, status: 400, stale: false };
    case "TotalBelowPayments":
      return { error: correctionMessages.TotalBelowPayments, status: 400, stale: true };
  }
}

const refuse = (refusal: CorrectionRefusal, status = 400) => data(refusal, { status });

export async function action({ context, params, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "");

  const intent = Schema.decodeUnknownResult(Schema.Literals(CORRECTION_INTENTS))(field("intent"));
  if (!Result.isSuccess(intent)) return refuse({ error: correctionMessages.NotUnderstood });

  // The revision the screen showed; without it the screen is stale.
  const sent = field("revision").trim();
  const revision = sent === "" ? Number.NaN : Number(sent);
  if (!Number.isSafeInteger(revision)) return refuse({ error: "Recarga la página e intenta de nuevo." });

  const billId = params.billId;
  const asked: CorrectionAsked =
    intent.success === "quitar-linea"
      ? { intent: intent.success, billId, lineId: field("lineId") }
      : intent.success === "quitar-pago"
        ? { intent: intent.success, billId, paymentId: field("paymentId") }
        : { intent: intent.success, billId };
  const correction = { reason: trimToNull(field("reason")), expectedRevision: revision };

  const program = Effect.gen(function* () {
    switch (asked.intent) {
      case "quitar-linea":
        return yield* removeLine({ ...asked, ...correction });
      case "quitar-pago":
        return yield* removePayment({ ...asked, ...correction });
      case "cancelar-cuenta":
        return yield* voidBill({ ...asked, ...correction });
    }
  });
  const recorded = await run(context, program.pipe(Effect.provideService(CurrentUser, user)), answerCorrectionError);

  // A Worker opens only Open Bills (spec §4.1): not one their own removal left
  // without Lines, which counts as Paid.
  const answer = (bill: Corrected) =>
    ({
      correction: {
        total: bill.total,
        owed: bill.total - bill.paid,
        canOpen: user.role === "admin" || (!bill.voided && bill.total > bill.paid),
      },
    }) satisfies CorrectionAnswer;

  if (!("error" in recorded)) return answer(recorded);
  if (!recorded.stale) return refuse({ error: recorded.error }, recorded.status);

  // The same correction, sent again after its answer was lost.
  const already = await run(context, recordedCorrection(asked, correction.reason).pipe(Effect.provideService(CurrentUser, user)));
  if (already) return answer(already);

  // Whether this User may read the Bill again is `getBill`'s gate.
  const canOpen = await run(
    context,
    getBill(billId).pipe(Effect.as(true), Effect.provideService(CurrentUser, user)),
    (error) => {
      switch (error._tag) {
        case "BillNotFound":
        case "BillNotVisible":
          return false;
      }
    },
  );
  return refuse({ error: recorded.error, changed: { canOpen } }, recorded.status);
}
