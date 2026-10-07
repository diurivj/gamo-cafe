import { data } from "react-router";
import { Effect, Result, Schema } from "effect";

import { type BillNotFound, getBill, takePayment } from "~/backend/bills";
import { CurrentUser } from "~/backend/current-user";
import type { BillChanged, BillIsVoided, PaymentExceedsOwed, PaymentNotPositive } from "~/backend/payments";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";
import type { BillPaymentAnswer, BillPaymentRefusal } from "~/shared/bill-payment";
import { type Centavos, parsePesos } from "~/shared/money";
import { PAYMENT_METHODS } from "~/shared/payment";
import { paymentMessages } from "~/shared/payment-messages";

import type { Route } from "./+types/record-payment";

// Where Cuenta sends a Payment (UI redesign §5.3, §6): `takePayment` on one
// Bill, at the revision the screen showed (spec §7.3.2). It answers JSON to
// the browser's own `fetch` (`sendForRecord` in ~/shared/record-request): the
// Bill as the Payment left it, or the Spanish reason it was refused. A Payment
// sent again with its key and content is answered as the first time and
// records nothing (README, "One submission per form"), which is what makes
// Cuenta's retry safe.

type PaymentError = BillNotFound | BillChanged | BillIsVoided | PaymentExceedsOwed | PaymentNotPositive;

/** A refusal and its status. `stale`: the Bill is not what the screen showed. */
interface Refused {
  readonly error: string;
  readonly status: 400 | 404;
  readonly stale: boolean;
}

/** What each rule violation of `takePayment` answers, in Spanish. */
function answerPaymentError(error: PaymentError): Refused {
  switch (error._tag) {
    case "BillNotFound":
      return { error: "Esa cuenta ya no existe.", status: 404, stale: true };
    case "BillChanged":
      return { error: paymentMessages.BillChanged, status: 400, stale: true };
    case "BillIsVoided":
      return { error: paymentMessages.BillIsVoided, status: 400, stale: true };
    case "PaymentExceedsOwed":
      return { error: paymentMessages.PaymentExceedsOwed, status: 400, stale: true };
    case "PaymentNotPositive":
      return { error: paymentMessages.PaymentNotPositive, status: 400, stale: false };
  }
}

const refuse = (refusal: BillPaymentRefusal, status = 400) => data(refusal, { status });

export async function action({ context, params, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();

  const method = Schema.decodeUnknownResult(Schema.Literals(PAYMENT_METHODS))(String(form.get("method") ?? ""));
  if (!Result.isSuccess(method)) return refuse({ error: paymentMessages.MethodMissing });

  // An empty amount means everything the Bill still owes (spec §5.5).
  const typed = String(form.get("amount") ?? "").trim();
  let amount: Centavos | null = null;
  if (typed !== "") {
    const parsed = parsePesos(typed);
    if (parsed === undefined) return refuse({ error: paymentMessages.InvalidAmount });
    amount = parsed;
  }

  // The revision the screen showed; without it the screen is stale.
  const sent = String(form.get("revision") ?? "").trim();
  const revision = sent === "" ? Number.NaN : Number(sent);
  if (!Number.isSafeInteger(revision)) return refuse({ error: "Recarga la página e intenta de nuevo." });

  const program = takePayment({
    billId: params.billId,
    amount,
    method: method.success,
    expectedRevision: revision,
    submissionKey: String(form.get("submissionKey") ?? "") || null,
  }).pipe(Effect.provideService(CurrentUser, user));
  const recorded = await run(context, program, answerPaymentError);

  if ("error" in recorded) {
    if (!recorded.stale) return refuse({ error: recorded.error });
    // Whether this User may read the Bill again is `getBill`'s gate: a Worker
    // opens only Open Bills (spec §4.1).
    const canOpen = await run(
      context,
      getBill(params.billId).pipe(Effect.as(true), Effect.provideService(CurrentUser, user)),
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

  return {
    payment: {
      amount: recorded.amount,
      total: recorded.total,
      owed: recorded.owed,
      paid: recorded.paid,
      // A Worker is not sent into a Bill their own Payment left Paid.
      canOpen: user.role === "admin" || !recorded.paid,
    },
  } satisfies BillPaymentAnswer;
}
