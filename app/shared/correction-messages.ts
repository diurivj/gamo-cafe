/**
 * What Cuenta's corrections say on screen (spec §5.7): the rule violations of
 * removing a Line or a Payment and of voiding a Bill, and what a successful
 * correction answers.
 *
 * Safe in the browser: no Effect import.
 */

/** The three corrections Cuenta posts, as its submit buttons name them. */
export const CORRECTION_INTENTS = ["quitar-linea", "quitar-pago", "cancelar-cuenta"] as const;

export type CorrectionIntent = (typeof CORRECTION_INTENTS)[number];

export const correctionMessages = {
  /** Another phone changed the Bill first (spec §7.3). */
  BillChanged: "La cuenta cambió mientras intentabas corregirla. Recarga la página y vuelve a intentar.",
  /** The Bill was Voided; it accepts no further corrections (spec §5.7). */
  BillIsVoided: "Esta cuenta está cancelada.",
  /** The Line is not on the Bill, or its removal is already recorded. */
  LineNotFound: "Ese producto ya no está en la cuenta. Recarga la página.",
  /** The Payment is not on the Bill, or its removal is already recorded. */
  PaymentNotFound: "Ese pago ya no está en la cuenta. Recarga la página.",
  /** An Admin-only correction without the reason it requires (spec §5.7). */
  ReasonRequired: "Escribe el motivo.",
  /** Removing the Line would leave the total below the Payments (spec §5.7). */
  TotalBelowPayments: "La cuenta ya tiene pagos: primero quita un pago.",
} as const;

/** What a correction answers when it is recorded. */
export const correctionDone: Record<CorrectionIntent, string> = {
  "quitar-linea": "Producto quitado.",
  "quitar-pago": "Pago quitado.",
  "cancelar-cuenta": "Cuenta cancelada.",
};
