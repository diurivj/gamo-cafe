/**
 * Text from a form as the backend stores it: space trimmed, and empty or
 * absent is no text at all — `null`, so a `NULL` column holds "nothing said".
 *
 * Safe in the browser: no Effect import.
 */
export function trimToNull(text: string | null | undefined): string | null {
  return (text ?? "").trim() || null;
}
