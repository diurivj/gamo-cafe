/**
 * A new opaque identifier for any record (spec §7.1): a random UUID from the
 * platform. It says nothing about when or in what order it was made; order
 * records by their instant.
 */
export function newId(): string {
  return crypto.randomUUID();
}
