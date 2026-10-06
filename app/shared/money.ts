/**
 * Money is an integer number of centavos everywhere (spec §2.3, §7.1). These
 * helpers only move digits around as text, so no amount is ever divided or
 * multiplied as a floating-point number. Add and subtract centavos with plain
 * integer `+` and `-`.
 *
 * Safe in the browser: no Effect import.
 */

/** An integer number of centavos: 1850 is $18.50. */
export type Centavos = number;

/** `1850` → `"$18.50"`, `123456` → `"$1,234.56"`, as es-MX writes pesos. */
export function formatMoney(amount: Centavos): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`not a whole number of centavos: ${amount}`);
  }
  const digits = String(Math.abs(amount)).padStart(3, "0");
  const pesos = digits.slice(0, -2).replace(/\B(?=(\d{3})+$)/g, ",");
  return `${amount < 0 ? "-" : ""}$${pesos}.${digits.slice(-2)}`;
}

// Pesos with optional thousands commas, then at most two decimals.
const PESOS = /^(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d{0,2}))?$/;

/**
 * The change to hand back for cash: what was handed over minus what was paid
 * (spec §5.5). The amount handed over is never stored, so this is only what
 * the screen shows while it is typed.
 */
export function changeFor(handedOver: Centavos, amount: Centavos): Centavos {
  if (!Number.isSafeInteger(handedOver) || !Number.isSafeInteger(amount)) {
    throw new RangeError(`not whole centavos: ${handedOver} and ${amount}`);
  }
  return handedOver - amount;
}

/**
 * Reads what a person typed as a peso amount: `"18.5"` → `1850`,
 * `"$1,234.56"` → `123456`. Gives `undefined` for anything else, including
 * negative amounts, a third decimal and a decimal comma (`"12,50"`).
 */
export function parsePesos(text: string): Centavos | undefined {
  const match = PESOS.exec(text.trim().replace(/^\$\s*/, ""));
  if (!match) return undefined;
  const pesos = match[1]!.replaceAll(",", "");
  const centavos = match[2] ?? "";
  if (pesos === "" && centavos === "") return undefined;
  const amount = Number(pesos + centavos.padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : undefined;
}
