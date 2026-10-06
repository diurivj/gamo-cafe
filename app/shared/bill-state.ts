/**
 * A Bill's state (spec §5.6). It is derived from the Bill's records and never
 * set by hand; `billStateLabel` is what each one is called on screen.
 *
 * Safe in the browser: no Effect import.
 */

/** The states of §5.6, as they are stored. */
export const BILL_STATES = ["open", "partial", "paid", "voided"] as const;

export type BillState = (typeof BILL_STATES)[number];

/** What each state is called on screen. */
export const billStateLabel: Record<BillState, string> = {
  open: "Abierta",
  partial: "Pago parcial",
  paid: "Pagada",
  voided: "Cancelada",
};

/** A Bill that is Abierta or Pago parcial: Lines may be added to it. */
export const isOpenBill = (state: BillState) => state === "open" || state === "partial";
