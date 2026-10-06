/**
 * Where a rendered page's **Cargar más** leads: the one link that carries a
 * cursor, as the browser would request it. null when the page has none, which
 * is how the last page of a list looks.
 */
export function nextHref(html: string): string | null {
  const match = /href="([^"]*[?;]desde=[^"]+)"/.exec(html);
  return match ? match[1]!.replaceAll("&amp;", "&") : null;
}
