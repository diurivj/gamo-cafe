import { data } from "react-router";
import { Effect, Result, Schema } from "effect";

import { type ExpectedBillRevision, takeCustomerPayment } from "~/backend/bills";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";
import type { CustomerPaymentAnswer, CustomerPaymentRefusal } from "~/shared/customer-payment";
import { parsePesos } from "~/shared/money";
import { PAYMENT_METHODS } from "~/shared/payment";
import { paymentMessages } from "~/shared/payment-messages";

import type { Route } from "./+types/record-handover";

// Where a Customer's page sends an Abonar (UI redesign §5.3, §6):
// `takeCustomerPayment`, one amount across their Open Bills, oldest first, at
// the revisions the screen showed (spec §5.5, §7.3.2). It answers JSON to the
// browser's own `fetch` (`sendForRecord` in ~/shared/record-request): what the
// handover recorded and what the Customer still owes, or the Spanish reason it
// was refused. A handover sent again with its key and content is answered as
// the first time and records nothing (README, "One submission per form"),
// which is what makes Abonar's retry safe. Any User may collect (spec §4.1).

const refuse = (refusal: CustomerPaymentRefusal, status = 400) => data(refusal, { status });

/** The Bills as the screen showed them: `billId:revision`, one form field each. */
function billRevisions(form: FormData): Array<ExpectedBillRevision> | null {
  const revisions: Array<ExpectedBillRevision> = [];
  for (const value of form.getAll("bill")) {
    const [billId, revision] = String(value).split(":");
    const parsed = revision === undefined || revision.trim() === "" ? Number.NaN : Number(revision);
    if (!billId || !Number.isSafeInteger(parsed)) return null;
    revisions.push({ billId, revision: parsed });
  }
  return revisions;
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();

  const method = Schema.decodeUnknownResult(Schema.Literals(PAYMENT_METHODS))(String(form.get("method") ?? ""));
  if (!Result.isSuccess(method)) return refuse({ error: paymentMessages.MethodMissing });

  // The screen always says the amount; one that is not there cannot be read.
  const amount = parsePesos(String(form.get("amount") ?? ""));
  if (amount === undefined) return refuse({ error: paymentMessages.InvalidAmount });

  const revisions = billRevisions(form);
  if (revisions === null) return refuse({ error: "Recarga la página e intenta de nuevo." });

  const program = takeCustomerPayment({
    customerId: params.customerId,
    amount,
    method: method.success,
    expectedRevisions: revisions,
    submissionKey: String(form.get("submissionKey") ?? "") || null,
  }).pipe(Effect.provideService(CurrentUser, user));
  const recorded = await run(context, program, (error) => {
    switch (error._tag) {
      case "CustomerNotFound":
        return { error: "Ese cliente ya no existe.", status: 404 };
      case "PaymentNotPositive":
        return { error: paymentMessages.CustomerPaymentNotPositive, status: 400 };
      case "PaymentExceedsOwed":
        return { error: paymentMessages.CustomerPaymentExceedsOwed, status: 400 };
      case "CustomerBillsChanged":
        // The Bills are not what the screen showed: it reads them again.
        return { error: paymentMessages.CustomerBillsChanged, status: 400, changed: true as const };
    }
  });

  if ("error" in recorded) {
    const { status, ...refusal } = recorded;
    return refuse(refusal, status);
  }
  return {
    handover: { amount: recorded.amount, bills: recorded.shares.length, owed: recorded.owed },
  } satisfies CustomerPaymentAnswer;
}
