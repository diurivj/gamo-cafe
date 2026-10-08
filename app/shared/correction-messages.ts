/**
 * What Cuenta's corrections say on screen (spec §5.7): the rule violations of
 * removing a Line or a Payment and of voiding a Bill, and what a recorded
 * correction is called. Each refusal says what the User can do next.
 *
 * Safe in the browser: no Effect import.
 */

/** The three corrections Cuenta sends, as its address and its form name them. */
export const CORRECTION_INTENTS = ["quitar-linea", "quitar-pago", "cancelar-cuenta"] as const;

export type CorrectionIntent = (typeof CORRECTION_INTENTS)[number];

export const correctionMessages = {
  /** Another phone changed the Bill first (spec §7.3). */
  BillChanged: "La cuenta cambió mientras intentabas corregirla y no se registró nada. Revísala y vuelve a intentar.",
  /** The Bill was Voided; it accepts no further corrections (spec §5.7). */
  BillIsVoided: "Esta cuenta está cancelada y ya no admite correcciones.",
  /** The Line is not on the Bill, or its removal is already recorded. */
  LineNotFound: "Ese producto ya estaba quitado de la cuenta. No se registró nada.",
  /** The Payment is not on the Bill, or its removal is already recorded. */
  PaymentNotFound: "Ese pago ya estaba quitado de la cuenta. No se registró nada.",
  /** An Admin-only correction without the reason it requires (spec §5.7). */
  ReasonRequired: "Escribe el motivo.",
  /** Removing the Line would leave the total below the Payments (spec §5.7). */
  TotalBelowPayments: "No se puede quitar: la cuenta quedaría por debajo de lo que ya se pagó. Primero quita un pago.",
  /** An Admin's correction asked for by someone else (spec §4.1). */
  AdminOnly: "Solo un administrador puede hacer esta corrección.",
  /** The Bill is not there. */
  BillNotFound: "Esa cuenta ya no existe.",
  /** A form this app did not make. */
  NotUnderstood: "No entendimos esa corrección. Recarga la página e intenta de nuevo.",
} as const;

/** What a recorded correction is called: the title of its result. */
export const correctionDone: Record<CorrectionIntent, string> = {
  "quitar-linea": "Producto quitado",
  "quitar-pago": "Pago quitado",
  "cancelar-cuenta": "Cuenta cancelada",
};
