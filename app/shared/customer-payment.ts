import { type Centavos, changeFor, formatMoney } from "./money";
import { paidByMethod, type PaymentMethod } from "./payment";
import { NEW_PAYMENT, type PaymentDraft, readPaymentDraft } from "./payment-draft";
import { paymentMessages } from "./payment-messages";
import type { Recorded, Refusal } from "./record-request";

/**
 * Abonar (UI redesign §5.3, §6): one handover across a Customer's Open Bills,
 * typed, then sent as a frozen snapshot, then confirmed, refused or of unknown
 * outcome. `customerPaymentAfter` is every change the screen can make to it,
 * so what may be typed, sent again or started over is decided here and
 * nowhere else:
 *
 *     const [handover, dispatch] = useReducer(customerPaymentAfter, NEW_CUSTOMER_PAYMENT);
 *     dispatch({ type: "typed", draft });
 *
 * Whether the Customer or their Abonar step is on screen is the address's
 * business (`app/routes/customer.tsx`), not this state's. It is Cuenta's
 * Payment (`./bill-payment`) without `gone`: every User may open every
 * Customer.
 *
 * Safe in the browser: no Effect import.
 */

/** What the screen knows of the Customer a handover is for. */
export interface OwingCustomer {
  readonly id: string;
  readonly name: string;
  /** Everything their Open Bills owe. */
  readonly owed: Centavos;
  /** Their Open Bills, oldest first, at the revision the screen showed (spec §7.3). */
  readonly bills: ReadonlyArray<{ readonly id: string; readonly revision: number }>;
}

/**
 * A handover as it was sent: its content and its identity, frozen at the tap.
 * A retry sends this very snapshot, so the server takes it for the same form
 * and records nothing twice.
 */
export interface CustomerPaymentSnapshot {
  /** The submission key (README, "One submission per form"). */
  readonly key: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly method: PaymentMethod;
  readonly amount: Centavos;
  /** For the change the screen shows; it is never sent. */
  readonly handedOver: Centavos | null;
  /** Every Open Bill the screen showed: one that moved since refuses the whole handover. */
  readonly bills: ReadonlyArray<{ readonly billId: string; readonly revision: number }>;
}

/** The Customer as the handover left them, in the server's answer. */
export interface CustomerPaymentResult {
  /** Centavos the handover recorded, over all its Payments. */
  readonly amount: Centavos;
  /** How many Bills it reached: one Payment each. */
  readonly bills: number;
  /** What the Customer's Open Bills still owed once it was recorded. */
  readonly owed: Centavos;
}

/** What the route answers a recorded handover with. */
export interface CustomerPaymentAnswer {
  readonly handover: CustomerPaymentResult;
}

export const isCustomerPaymentAnswer = (answer: object): answer is CustomerPaymentAnswer =>
  "handover" in answer && typeof answer.handover === "object" && answer.handover !== null;

/** A refused handover's answer: the reason, and what the screen has to do about it. */
export interface CustomerPaymentRefusal extends Refusal {
  /** The Customer's Open Bills are not what the screen showed: it reads them again. */
  readonly changed?: true;
}

export type CustomerPaymentState =
  | { readonly phase: "editing"; readonly draft: PaymentDraft; readonly refusal: string | null }
  /** Sent, not answered. `draft` is what comes back if it is refused. */
  | {
      readonly phase: "recording";
      readonly draft: PaymentDraft;
      readonly snapshot: CustomerPaymentSnapshot;
      readonly attempt: number;
    }
  /**
   * No answer came: recorded or not, nobody knows yet. `sessionEnded` when a
   * retry was answered by Entrar: that attempt recorded nothing, an earlier
   * one may have, and no retry can tell until the User signs in again.
   */
  | {
      readonly phase: "unknown";
      readonly draft: PaymentDraft;
      readonly snapshot: CustomerPaymentSnapshot;
      readonly attempt: number;
      readonly sessionEnded: boolean;
    }
  | { readonly phase: "confirmed"; readonly snapshot: CustomerPaymentSnapshot; readonly result: CustomerPaymentResult };

export type CustomerPaymentEvent =
  | { readonly type: "typed"; readonly draft: PaymentDraft }
  | { readonly type: "submitted"; readonly snapshot: CustomerPaymentSnapshot }
  | {
      readonly type: "answered";
      readonly key: string;
      readonly outcome: Recorded<CustomerPaymentAnswer, CustomerPaymentRefusal>;
    }
  | { readonly type: "retried" }
  /** The confirmed result was left: the next handover starts from nothing. */
  | { readonly type: "started" };

/** How every handover starts: cash, for everything the Customer owes. */
export const NEW_CUSTOMER_PAYMENT: Extract<CustomerPaymentState, { phase: "editing" }> = {
  phase: "editing",
  draft: NEW_PAYMENT,
  refusal: null,
};

/** The handover after `event`. An event the phase does not allow changes nothing. */
export function customerPaymentAfter(state: CustomerPaymentState, event: CustomerPaymentEvent): CustomerPaymentState {
  switch (event.type) {
    case "typed":
      // A refusal is about the handover as it was sent: a change answers it.
      return state.phase === "editing" ? { phase: "editing", draft: event.draft, refusal: null } : state;
    case "submitted":
      if (state.phase !== "editing") return state;
      return { phase: "recording", draft: state.draft, snapshot: event.snapshot, attempt: 1 };
    case "answered": {
      if (state.phase !== "recording" || state.snapshot.key !== event.key) return state;
      const { outcome } = event;
      if (outcome.outcome === "unknown") return { ...state, phase: "unknown", sessionEnded: false };
      if (outcome.outcome === "confirmed") {
        return { phase: "confirmed", snapshot: state.snapshot, result: outcome.answer.handover };
      }
      // Entrar answered a retry: an earlier attempt may have been recorded,
      // so this is no evidence that nothing was, and the snapshot is kept.
      if (outcome.answer.sessionEnded && state.attempt > 1) return { ...state, phase: "unknown", sessionEnded: true };
      return { phase: "editing", draft: state.draft, refusal: outcome.answer.error };
    }
    case "retried":
      if (state.phase !== "unknown") return state;
      return { phase: "recording", draft: state.draft, snapshot: state.snapshot, attempt: state.attempt + 1 };
    case "started":
      return state.phase === "confirmed" ? NEW_CUSTOMER_PAYMENT : state;
  }
}

/**
 * The snapshot the draft is sent as, or why it cannot be sent yet. `key` is
 * new for every snapshot: `newId()` at the tap.
 */
export function customerPaymentSnapshot(handover: {
  readonly draft: PaymentDraft;
  readonly customer: OwingCustomer;
  readonly key: string;
}): CustomerPaymentSnapshot | { readonly problem: string } {
  const { draft, customer, key } = handover;
  const read = readPaymentDraft(draft, customer.owed, paymentMessages.CustomerPaymentExceedsOwed);
  if (read.amount === null) return { problem: read.amountProblem! };
  return {
    key,
    customerId: customer.id,
    customerName: customer.name,
    method: draft.method,
    amount: read.amount,
    handedOver: read.handedOver,
    bills: customer.bills.map((bill) => ({ billId: bill.id, revision: bill.revision })),
  };
}

/**
 * The form a snapshot is sent as: the same fields, in the same order, every
 * time, with one `bill` field per Open Bill (`billId:revision`). The amount is
 * always the one the screen said, never "whatever is owed by then".
 */
export function customerPaymentBody(snapshot: CustomerPaymentSnapshot): URLSearchParams {
  const body = new URLSearchParams({
    method: snapshot.method,
    amount: formatMoney(snapshot.amount),
    submissionKey: snapshot.key,
  });
  for (const bill of snapshot.bills) body.append("bill", `${bill.billId}:${bill.revision}`);
  return body;
}

/** What the screen says while a snapshot is on its way. */
export const customerPaymentRecordingText = (snapshot: CustomerPaymentSnapshot) =>
  `Registrando abono de ${formatMoney(snapshot.amount)}…`;

/**
 * What a confirmed handover says (UI redesign §5.4): what the server recorded,
 * how many Bills it reached and what the Customer still owes.
 */
export function customerPaymentOutcome(snapshot: CustomerPaymentSnapshot, result: CustomerPaymentResult) {
  const reached = `en ${result.bills} ${result.bills === 1 ? "cuenta" : "cuentas"}`;
  const owed =
    result.owed === 0
      ? `${snapshot.customerName} ya no debe nada.`
      : `${snapshot.customerName} todavía debe ${formatMoney(result.owed)}.`;
  const change =
    snapshot.method === "cash" && snapshot.handedOver !== null && snapshot.handedOver >= result.amount
      ? formatMoney(changeFor(snapshot.handedOver, result.amount))
      : null;
  return {
    title: "Abono registrado",
    details: `${formatMoney(result.amount)} ${paidByMethod[snapshot.method]}, ${reached}. ${owed}`,
    change,
  };
}

/** The address that says the Abonar step is on screen: `/clientes/:customerId?paso=abonar`. */
export const ABONAR_STEP_PARAM = "paso";
export const ABONAR_STEP = "abonar";
