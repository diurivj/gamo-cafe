import { type Centavos, changeFor, parsePesos } from "./money";
import type { PaymentMethod } from "./payment";
import { paymentMessages } from "./payment-messages";

/**
 * A Payment while it is being typed (UI redesign §5.2), and what it would pay.
 * `PaymentEntry` (~/components/payment-entry) shows one; the screen keeps it,
 * so going back a step loses nothing.
 *
 * Safe in the browser: no Effect import.
 */
export interface PaymentDraft {
  readonly method: PaymentMethod;
  /** Whether less than everything is being paid. */
  readonly partial: boolean;
  /** The part, as typed. Read only while `partial`. */
  readonly amountText: string;
  /** The cash handed over, as typed: for the change, and never stored (spec §5.5). */
  readonly handedText: string;
}

/** How every Payment starts: cash, for everything. A method is never carried over from the last one. */
export const NEW_PAYMENT: PaymentDraft = { method: "cash", partial: false, amountText: "", handedText: "" };

export interface PaymentReading {
  /** Centavos the Payment records, or null while it cannot be recorded. */
  readonly amount: Centavos | null;
  /** Why not, in Spanish. */
  readonly amountProblem: string | null;
  /** The cash handed over, when it was typed and covers the Payment. */
  readonly handedOver: Centavos | null;
  /** The change to hand back. */
  readonly change: Centavos | null;
  /** What is wrong with the cash handed over. It is help, so it stops nothing. */
  readonly handedProblem: string | null;
}

/**
 * What `draft` pays when everything is `full` centavos. `tooMuch` is what the
 * screen says about a part larger than that: the selection's total on Vender,
 * what the Bill owes on Cuenta.
 */
export function readPaymentDraft(draft: PaymentDraft, full: Centavos, tooMuch: string): PaymentReading {
  let amount: Centavos | null = full;
  let amountProblem: string | null = null;
  if (draft.partial) {
    const typed = draft.amountText.trim() === "" ? null : parsePesos(draft.amountText);
    if (typed === null) amountProblem = "Escribe cuánto se cobra.";
    else if (typed === undefined) amountProblem = paymentMessages.InvalidAmount;
    else if (typed <= 0) amountProblem = paymentMessages.PaymentNotPositive;
    else if (typed > full) amountProblem = tooMuch;
    amount = amountProblem === null ? (typed ?? null) : null;
  }

  const none = { amount, amountProblem, handedOver: null, change: null, handedProblem: null };
  if (draft.method !== "cash" || draft.handedText.trim() === "") return none;
  const handedOver = parsePesos(draft.handedText);
  if (handedOver === undefined) return { ...none, handedProblem: "Escribe un monto válido." };
  if (amount === null) return none;
  const change = changeFor(handedOver, amount);
  if (change < 0) return { ...none, handedProblem: "Lo entregado no alcanza para el pago." };
  return { ...none, handedOver, change };
}
