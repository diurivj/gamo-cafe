import { Data, Effect, Schema } from "effect";

import { newId } from "~/shared/id";
import { normalizeName } from "~/shared/normalize-name";

import { CurrentUser, requireAdmin } from "./current-user";
import { Db } from "./db";
import { now } from "./time";

/**
 * Customers (spec §5.2): whoever settles Bills, saved by name. Any User adds
 * one; an Admin edits, retires and restores. Names are compared and searched
 * by their normalized form, which ignores case and accents.
 */

/** No Customer has this id. */
export class CustomerNotFound extends Data.TaggedError("CustomerNotFound")<{}> {}

const CustomerRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  note: Schema.NullOr(Schema.String),
  retired_at: Schema.NullOr(Schema.Int),
  added_by: Schema.String,
  added_by_name: Schema.String,
  added_at: Schema.Int,
});

/** The name typed for a Customer has nothing in it. */
export class CustomerNameRequired extends Data.TaggedError("CustomerNameRequired")<{}> {}

/** An active Customer already has this name, ignoring case and accents. */
export class CustomerNameTaken extends Data.TaggedError("CustomerNameTaken")<{}> {}

/** What a User types about a Customer. */
export interface CustomerInput {
  readonly name: string;
  readonly note?: string | null;
}

/** Typed text as it is stored: space trimmed and collapsed. */
const tidy = (text: string) => text.trim().replace(/\s+/g, " ");

/** The input as it is stored, or the reason its name cannot be. */
const parse = Effect.fnUntraced(function* (input: CustomerInput) {
  const name = tidy(input.name);
  const normalizedName = normalizeName(name);
  if (normalizedName === "") return yield* new CustomerNameRequired();
  return { name, normalizedName, note: tidy(input.note ?? "") || null };
});

/**
 * Adds a Customer, with the signed-in User as who added it. Any User may
 * (spec §4.1). Refused when an active Customer has the same name.
 */
export const addCustomer = Effect.fn("addCustomer")(function* (input: CustomerInput) {
  const db = yield* Db;
  const user = yield* CurrentUser;
  const { name, normalizedName, note } = yield* parse(input);

  // One statement, so two phones adding the same name at once add it once.
  const id = newId();
  const { changes } = yield* db.run(
    `INSERT INTO customers (id, name, normalized_name, note, added_by, added_at)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM customers WHERE normalized_name = ? AND retired_at IS NULL)`,
    id, name, normalizedName, note, user.id, yield* now, normalizedName,
  );
  if (changes !== 1) return yield* new CustomerNameTaken();
  return { id, name };
});

const FoundRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  note: Schema.NullOr(Schema.String),
  retired_at: Schema.NullOr(Schema.Int),
});

/** Sorts after every name that starts with the text before it. */
const LAST_CHARACTER = "\u{10FFFF}";

/** How many Customers a search answers with at most. */
export const SEARCH_LIMIT = 50;

/**
 * Customers whose name starts with what was typed, ignoring case and accents,
 * in name order; with nothing typed, the first ones in name order. Retired
 * Customers are left out unless asked for: they cannot be chosen for a Bill.
 *
 * A range on `normalized_name`, not `LIKE`, so that an index answers it (spec
 * §7.4) and nothing typed is a wildcard.
 */
export const searchCustomers = Effect.fn("searchCustomers")(function* (
  typed: string,
  options: { readonly includeRetired?: boolean } = {},
) {
  const db = yield* Db;
  const prefix = normalizeName(typed);
  const rows = yield* db.all(
    FoundRow,
    `SELECT id, name, note, retired_at FROM customers
     WHERE normalized_name >= ? AND normalized_name < ?
       ${options.includeRetired ? "" : "AND retired_at IS NULL"}
     ORDER BY normalized_name, added_at
     LIMIT ?`,
    prefix, prefix + LAST_CHARACTER, SEARCH_LIMIT,
  );
  return rows.map((row) => ({ id: row.id, name: row.name, note: row.note, retiredAt: row.retired_at }));
});

/** One Customer, with who added it and when. */
export const getCustomer = Effect.fn("getCustomer")(function* (id: string) {
  const db = yield* Db;
  const row = yield* db.first(
    CustomerRow,
    `SELECT customers.id, customers.name, customers.note, customers.retired_at,
            customers.added_by, users.name AS added_by_name, customers.added_at
     FROM customers JOIN users ON users.id = customers.added_by
     WHERE customers.id = ?`,
    id,
  );
  if (!row) return yield* new CustomerNotFound();
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    retiredAt: row.retired_at,
    addedBy: { id: row.added_by, name: row.added_by_name },
    addedAt: row.added_at,
  };
});

const Exists = Schema.Struct({ id: Schema.String });

/** Fails with `CustomerNotFound` unless a Customer has this id. */
const requireCustomer = Effect.fnUntraced(function* (id: string) {
  const db = yield* Db;
  const row = yield* db.first(Exists, "SELECT id FROM customers WHERE id = ?", id);
  if (!row) return yield* new CustomerNotFound();
});

/**
 * Changes a Customer's name and note. Admin only (spec §4.1). Refused when
 * another active Customer has the new name.
 */
export const editCustomer = Effect.fn("editCustomer")(function* (id: string, input: CustomerInput) {
  yield* requireAdmin;
  const db = yield* Db;
  yield* requireCustomer(id);
  const { name, normalizedName, note } = yield* parse(input);

  const { changes } = yield* db.run(
    `UPDATE customers SET name = ?, normalized_name = ?, note = ?
     WHERE id = ? AND NOT EXISTS (
       SELECT 1 FROM customers AS other
       WHERE other.normalized_name = ? AND other.retired_at IS NULL AND other.id <> customers.id
     )`,
    name, normalizedName, note, id, normalizedName,
  );
  if (changes !== 1) return yield* new CustomerNameTaken();
});

/**
 * Retires a Customer: they can no longer be chosen for a Bill, and their name
 * is free for another Customer. Admin only. Retiring a retired Customer
 * changes nothing.
 */
export const retireCustomer = Effect.fn("retireCustomer")(function* (id: string) {
  yield* requireAdmin;
  const db = yield* Db;
  yield* requireCustomer(id);
  yield* db.run(
    "UPDATE customers SET retired_at = ? WHERE id = ? AND retired_at IS NULL",
    yield* now, id,
  );
});

/**
 * Makes a retired Customer active again. Admin only. Refused when an active
 * Customer took their name meanwhile; restoring an active Customer changes
 * nothing.
 */
export const restoreCustomer = Effect.fn("restoreCustomer")(function* (id: string) {
  yield* requireAdmin;
  const db = yield* Db;
  yield* requireCustomer(id);
  const { changes } = yield* db.run(
    `UPDATE customers SET retired_at = NULL
     WHERE id = ? AND NOT EXISTS (
       SELECT 1 FROM customers AS other
       WHERE other.normalized_name = customers.normalized_name
         AND other.retired_at IS NULL AND other.id <> customers.id
     )`,
    id,
  );
  if (changes !== 1) return yield* new CustomerNameTaken();
});
