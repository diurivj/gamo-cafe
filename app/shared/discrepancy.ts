/**
 * The words on screen for a Discrepancy (spec §5.8): units missing are
 * Faltante, extra units are Sobrante, and none is Sin diferencia. Safe in the
 * browser: no Effect import.
 */
export function discrepancyText(difference: number): string {
  if (difference < 0) return `Faltante: ${-difference}`;
  if (difference > 0) return `Sobrante: ${difference}`;
  return "Sin diferencia";
}
