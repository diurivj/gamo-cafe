/**
 * Splits a list into consecutive parts of at most `size`. Backend SQL uses it
 * to carry a set in several statements without ever reaching D1's 100 bound
 * parameters per query (spec §2.4).
 *
 * No imports: plain data, safe in the Worker.
 */
export function chunk<A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> {
  const parts: Array<ReadonlyArray<A>> = [];
  for (let at = 0; at < items.length; at += size) parts.push(items.slice(at, at + size));
  return parts;
}
