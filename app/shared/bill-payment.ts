import { type Centavos, changeFor, formatMoney } from "./money";
import { paidByMethod, type PaymentMethod } from "./payment";
import { NEW_PAYMENT, type PaymentDraft, readPaymentDraft } from "./payment-draft";
import { paymentMessages } from "./payment-messages";
import type { Recorded, Refusal } from "./record-request";

/**
 * Cuenta's Payment (UI redesign §5.3, §6): typed, then sent as a frozen
 * snapshot, then confirmed, refused or of unknown outcome. `billPaymentAfter`
 * is every change the screen can make to it, so what may be typed, sent again
 * or started over is decided here and nowhere else:
 *
 *     const [payment, dispatch] = useReducer(billPaymentAfter, NEW_BILL_PAYMENT);
 *     dispatch({ type: "typed", draft });
 *
 * Whether the Bill or its Cobrar step is on screen is the address's business
 * (`app/routes/bill.tsx`), not this state's.
 *
 * Safe in the browser: no Effect import.
 */

/** What the screen knows of the Bill a Payment is for. */
export interface PayableBill {
  readonly id: string;
  /** The revision the screen showed (spec §7.3): a Bill that moved since refuses the Payment. */
  readonly revision: number;
  readonly owed: Centavos;
  readonly customerName: string | null;
}

/**
 * A Payment as it was sent: its content and its identity, frozen at the tap.
 * A retry sends this very snapshot, so the server takes it for the same form
 * and records nothing twice.
 */
export interface BillPaymentSnapshot {
  /** The submission key (README, "One submission per form"). */
  readonly key: string;
  readonly billId: string;
  readonly revision: number;
  readonly customerName: string | null;
  readonly method: PaymentMethod;
  readonly amount: Centavos;
  /** For the change the screen shows; it is never sent. */
  readonly handedOver: Centavos | null;
}

/** The Bill as the Payment left it, in the server's answer. */
export interface BillPaymentResult {
  /** Centavos the Payment recorded. */
  readonly amount: Centavos;
  readonly total: Centavos;
  readonly owed: Centavos;
  /** Whether the Payment left the Bill Paid. */
  readonly paid: boolean;
  /** Whether this User may open the Bill: a Worker may not open a Paid one (spec §4.1). */
  readonly canOpen: boolean;
}

/** What the route answers a recorded Payment with. */
export interface BillPaymentAnswer {
  readonly payment: BillPaymentResult;
}

export const isBillPaymentAnswer = (answer: object): answer is BillPaymentAnswer =>
  "payment" in answer && typeof answer.payment === "object" && answer.payment !== null;

/** A refused Payment's answer: the reason, and what the screen has to do about it. */
export interface BillPaymentRefusal extends Refusal {
  /**
   * The Bill is not what the screen showed. With `canOpen` the screen reads
   * it again; without, this User may not open it any more (spec §4.1).
   */
  readonly changed?: { readonly canOpen: boolean };
}

export type BillPaymentState =
  | { readonly phase: "editing"; readonly draft: PaymentDraft; readonly refusal: string | null }
  /** Sent, not answered. `draft` is what comes back if it is refused. */
  | { readonly phase: "recording"; readonly draft: PaymentDraft; readonly snapshot: BillPaymentSnapshot; readonly attempt: number }
  /**
   * No answer came: recorded or not, nobody knows yet. `sessionEnded` when a
   * retry was answered by Entrar: that attempt recorded nothing, an earlier
   * one may have, and no retry can tell until the User signs in again.
   */
  | {
      readonly phase: "unknown";
      readonly draft: PaymentDraft;
      readonly snapshot: BillPaymentSnapshot;
      readonly attempt: number;
      readonly sessionEnded: boolean;
    }
  | { readonly phase: "confirmed"; readonly snapshot: BillPaymentSnapshot; readonly result: BillPaymentResult }
  /** Refused, and the Bill is no longer this User's to open: nothing was recorded and nothing can be typed. */
  | { readonly phase: "gone"; readonly snapshot: BillPaymentSnapshot };

export type BillPaymentEvent =
  | { readonly type: "typed"; readonly draft: PaymentDraft }
  | { readonly type: "submitted"; readonly snapshot: BillPaymentSnapshot }
  | { readonly type: "answered"; readonly key: string; readonly outcome: Recorded<BillPaymentAnswer, BillPaymentRefusal> }
  | { readonly type: "retried" }
  /** The confirmed result was left: the next Payment starts from nothing. */
  | { readonly type: "started" };

/** How every Payment starts: cash, for everything the Bill owes. */
export const NEW_BILL_PAYMENT: Extract<BillPaymentState, { phase: "editing" }> = {
  phase: "editing",
  draft: NEW_PAYMENT,
  refusal: null,
};

/** The Payment after `event`. An event the phase does not allow changes nothing. */
export function billPaymentAfter(state: BillPaymentState, event: BillPaymentEvent): BillPaymentState {
  switch (event.type) {
    case "typed":
      // A refusal is about the Payment as it was sent: a change answers it.
      return state.phase === "editing" ? { phase: "editing", draft: event.draft, refusal: null } : state;
    case "submitted":
      if (state.phase !== "editing") return state;
      return { phase: "recording", draft: state.draft, snapshot: event.snapshot, attempt: 1 };
    case "answered": {
      if (state.phase !== "recording" || state.snapshot.key !== event.key) return state;
      const { outcome } = event;
      if (outcome.outcome === "unknown") return { ...state, phase: "unknown", sessionEnded: false };
      if (outcome.outcome === "confirmed") {
        return { phase: "confirmed", snapshot: state.snapshot, result: outcome.answer.payment };
      }
      // Entrar answered a retry: an earlier attempt may have been recorded,
      // so this is no evidence that nothing was, and the snapshot is kept.
      if (outcome.answer.sessionEnded && state.attempt > 1) return { ...state, phase: "unknown", sessionEnded: true };
      if (outcome.answer.changed?.canOpen === false) return { phase: "gone", snapshot: state.snapshot };
      return { phase: "editing", draft: state.draft, refusal: outcome.answer.error };
    }
    case "retried":
      if (state.phase !== "unknown") return state;
      return { phase: "recording", draft: state.draft, snapshot: state.snapshot, attempt: state.attempt + 1 };
    case "started":
      return state.phase === "confirmed" ? NEW_BILL_PAYMENT : state;
  }
}

/**
 * The snapshot the draft is sent as, or why it cannot be sent yet. `key` is
 * new for every snapshot: `newId()` at the tap.
 */
export function billPaymentSnapshot(payment: {
  readonly draft: PaymentDraft;
  readonly bill: PayableBill;
  readonly key: string;
}): BillPaymentSnapshot | { readonly problem: string } {
  const { draft, bill, key } = payment;
  const read = readPaymentDraft(draft, bill.owed, paymentMessages.PaymentExceedsOwed);
  if (read.amount === null) return { problem: read.amountProblem! };
  return {
    key,
    billId: bill.id,
    revision: bill.revision,
    customerName: bill.customerName,
    method: draft.method,
    amount: read.amount,
    handedOver: read.handedOver,
  };
}

/**
 * The form a snapshot is sent as: the same fields, in the same order, every
 * time. The amount is always the one the screen said, never "whatever is owed
 * by then".
 */
export function billPaymentBody(snapshot: BillPaymentSnapshot): URLSearchParams {
  return new URLSearchParams({
    method: snapshot.method,
    amount: formatMoney(snapshot.amount),
    revision: String(snapshot.revision),
    submissionKey: snapshot.key,
  });
}

/** What the screen says while a snapshot is on its way. */
export const billPaymentRecordingText = (snapshot: BillPaymentSnapshot) =>
  `Registrando pago de ${formatMoney(snapshot.amount)}…`;

/**
 * What a confirmed Payment says (UI redesign §5.4): what the server recorded
 * and what the Bill still owes. The Bill is called Paid only when the server
 * says nothing is owed.
 */
export function billPaymentOutcome(snapshot: BillPaymentSnapshot, result: BillPaymentResult) {
  const bill = snapshot.customerName ? `La cuenta de ${snapshot.customerName}` : "La cuenta";
  const owed = result.owed === 0 ? "Cuenta pagada." : `${bill} todavía debe ${formatMoney(result.owed)}.`;
  const change =
    snapshot.handedOver !== null && snapshot.handedOver >= result.amount
      ? formatMoney(changeFor(snapshot.handedOver, result.amount))
      : null;
  return {
    title: "Pago registrado",
    details: `${formatMoney(result.amount)} ${paidByMethod[snapshot.method]}. ${owed}`,
    change,
  };
}

/** The address's parameter that says the Cobrar step is on screen: `/cuentas/:billId?paso=cobrar`. */
export const PAY_STEP_PARAM = "paso";
export const PAY_STEP = "cobrar";
