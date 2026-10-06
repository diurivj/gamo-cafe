/**
 * Page numbers in a list's URL (spec §2.4: long lists are paged). Plain and
 * safe in the browser, like the rest of `app/shared/`.
 */

/** The page a URL asked for, or the first one. */
export function pageFrom(typed: string | null): number {
  const asked = Number(typed);
  return Number.isSafeInteger(asked) && asked >= 1 ? asked : 1;
}

/** The URL of page `page`, with no query at all for the first page. */
export function pageUrl(base: string, page: number): string {
  return page > 1 ? `${base}?pagina=${page}` : base;
}
