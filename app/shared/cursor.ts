/**
 * Where a paged list's next page starts: the last row of the page before it,
 * as its place in the list's order — an instant, and what breaks a tie between
 * rows of the same instant. A page is "everything after this row", so a row
 * added or removed between two pages neither repeats nor skips one, which a
 * page number cannot promise (spec §3.4).
 */
export interface Cursor {
  readonly at: number;
  /** The list's own tie-breaker, as text. */
  readonly id: string;
}

/** The URL parameter every paged list carries its cursor in. */
export const CURSOR_PARAM = "desde";

/** A cursor as the URL carries it. */
export function cursorText(cursor: Cursor): string {
  return `${cursor.at}~${cursor.id}`;
}

/** A page's `next` as its loader answers it: the cursor's text, or null on the last page. */
export function nextText(cursor: Cursor | null): string | null {
  return cursor === null ? null : cursorText(cursor);
}

/** The cursor of the page this URL asks for; null is the first page. */
export function cursorOf(url: string): Cursor | null {
  return cursorFrom(new URL(url).searchParams.get(CURSOR_PARAM));
}

/** The cursor a URL carries, or null — the first page — when it is unreadable. */
export function cursorFrom(typed: string | null): Cursor | null {
  const match = /^(\d{1,16})~(.+)$/s.exec(typed ?? "");
  if (!match) return null;
  return { at: Number(match[1]), id: match[2]! };
}
