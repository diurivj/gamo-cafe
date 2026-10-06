/**
 * Names of Items, Categories and Customers, as stored and as compared.
 *
 * Safe in the browser, and in Node scripts: no imports.
 */

/** A name as it is stored: trimmed, with single spaces. */
export function tidyName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * The form in which two names are compared: lower case, without accents or
 * other marks, with single spaces. `"  Café  Olé "` and `"cafe ole"` are the
 * same name (spec §5.1, §5.2). The `ñ` loses its tilde too, so `"Piña"` and
 * `"pina"` are the same.
 */
export function normalizeName(name: string): string {
  return tidyName(name)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}
