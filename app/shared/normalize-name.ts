/**
 * A name as it is compared and searched: case and accents ignored (spec §5.1,
 * §5.2), space trimmed and collapsed. Two names are "the same" when their
 * normalized forms are equal, and a search matches when the normalized name
 * starts with the normalized query.
 *
 * Every combining mark goes, so `ñ` compares as `n` and `ü` as `u`: someone
 * typing "pena" on a phone finds "Peña" instead of adding it a second time.
 *
 * No imports: the Worker, the browser and the Playwright fixtures share it.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * The exclusive end of a prefix range on a `normalized_name` (spec §5.1,
 * §5.2): a search is `normalized_name >= prefix AND normalized_name <
 * prefixRange(prefix)`, which an index answers and in which nothing typed is
 * a wildcard.
 */
export function prefixRange(prefix: string): string {
  return prefix + "\u{10FFFF}";
}
