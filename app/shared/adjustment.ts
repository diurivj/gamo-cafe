/**
 * Why an Adjustment was made (spec §5.8): a Restock adds units; Waste and
 * Internal use subtract them. The stored values are English, as every stored
 * term is (CONTEXT.md); the label is what a screen shows.
 *
 * Safe in the browser: no Effect import.
 */

export const ADJUSTMENT_REASONS = ["restock", "waste", "internal_use"] as const;

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** What each reason is called on screen. */
export const adjustmentReasonLabel: Record<AdjustmentReason, string> = {
  restock: "Entrada",
  waste: "Merma",
  internal_use: "Consumo interno",
};

/** Entrada adds its units; Merma and Consumo interno subtract them (spec §5.8). */
export const adjustmentSign = (reason: AdjustmentReason): 1 | -1 => (reason === "restock" ? 1 : -1);
