/**
 * A Payment's method (spec §5.5, §7.2): cash or transfer, and nothing else.
 * The stored value is English, as every stored term is (CONTEXT.md); the
 * label is what a screen shows.
 *
 * Safe in the browser: no Effect import.
 */

export const PAYMENT_METHODS = ["cash", "transfer"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** What each method is called on screen. */
export const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
};

/** How a recorded Payment says it was paid: "$18.50 en efectivo". */
export const paidByMethod: Record<PaymentMethod, string> = { cash: "en efectivo", transfer: "por transferencia" };
