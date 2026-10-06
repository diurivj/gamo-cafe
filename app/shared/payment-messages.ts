/**
 * What a Payment's rule violations say on screen (spec §2.3, §5.5). Vender's
 * **Cobrar** and Cuenta take Payments, so they answer with the same words.
 *
 * Safe in the browser: no Effect import.
 */

export const paymentMessages = {
  /** A Payment of zero or less (spec §2.3). */
  PaymentNotPositive: "El pago debe ser mayor que cero.",
  /** More than the Bill still owes when paying on Cuenta (spec §2.3, §5.5). */
  PaymentExceedsOwed: "El pago no puede ser mayor que lo que debe la cuenta.",
  /** More than the selection's total when paying on Vender (spec §6.1). */
  PaymentExceedsSelection: "El pago no puede ser mayor que el total de la selección.",
  /** The Bill was Voided (spec §5.7). */
  BillIsVoided: "Esta cuenta está cancelada.",
  /** Another phone changed the Bill first (spec §5.5). */
  BillChanged: "La cuenta cambió mientras registrabas el pago. Revisa el monto y vuelve a intentar.",
  /** The amount field could not be read as pesos. */
  InvalidAmount: "El monto no es válido. Escríbelo como 18.50.",
  /** No method was chosen. */
  MethodMissing: "Elige cómo se pagó.",
} as const;
