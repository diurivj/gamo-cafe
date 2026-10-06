/**
 * Reads what a person typed as a whole number of units, zero or more:
 * `"24"` → `24`, `" 007 "` → `7`. Gives `undefined` for anything else,
 * including an empty field, a sign and a decimal point.
 *
 * Safe in the browser: no Effect import.
 */
export function parseUnits(text: string): number | undefined {
  const digits = text.trim();
  if (!/^\d+$/.test(digits)) return undefined;
  const units = Number(digits);
  return Number.isSafeInteger(units) ? units : undefined;
}
