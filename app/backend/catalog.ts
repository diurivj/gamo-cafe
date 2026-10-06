import { Data, Effect, Schema } from "effect";

import { newId } from "~/shared/id";
import type { Centavos } from "~/shared/money";
import { normalizeName } from "~/shared/normalize-name";

import { requireAdmin } from "./current-user";
import { Db, statement } from "./db";
import { adjustmentStatements } from "./stock";
import { now, today } from "./time";

/**
 * Items and Categories (spec §5.1). Managing them is for Admins: every
 * operation here except `activeItemsByCategory` starts with `requireAdmin`.
 *
 * Both are entities, changed in place and retired instead of deleted. The one
 * fact written here is the Restock that records an Item's starting Stock.
 */

/** A name as it is stored: trimmed, with single spaces. */
const tidyName = (name: string) => name.trim().replace(/\s+/g, " ");

/** A name was empty. */
export class NameMissing extends Data.TaggedError("NameMissing")<{}> {}

/** A price that is not a whole number of centavos greater than zero. */
export class InvalidPrice extends Data.TaggedError("InvalidPrice")<{}> {}

/** A Minimum or a starting Stock that is not a whole number of zero or more. */
export class InvalidUnits extends Data.TaggedError("InvalidUnits")<{
  readonly field: "minimum" | "startingStock";
}> {}

/** Another active Item has this name, ignoring case and accents. */
export class ItemNameTaken extends Data.TaggedError("ItemNameTaken")<{}> {}

/** The Category does not exist or is retired, so it cannot hold an active Item. */
export class CategoryUnavailable extends Data.TaggedError("CategoryUnavailable")<{}> {}

/** Retiring a Category that still has an active Item (spec §5.1). */
export class CategoryHasActiveItems extends Data.TaggedError("CategoryHasActiveItems")<{}> {}

export class ItemNotFound extends Data.TaggedError("ItemNotFound")<{}> {}

export class CategoryNotFound extends Data.TaggedError("CategoryNotFound")<{}> {}

export interface Category {
  readonly id: string;
  readonly name: string;
}

/** Adds a Category after the last one. */
export const addCategory = Effect.fn("addCategory")(function* (name: string) {
  yield* requireAdmin;
  const db = yield* Db;
  const category: Category = { id: newId(), name: tidyName(name) };
  if (category.name === "") return yield* new NameMissing();

  yield* db.run(
    "INSERT INTO categories (id, name, position) SELECT ?, ?, COALESCE(MAX(position), 0) + 1 FROM categories",
    category.id,
    category.name,
  );
  return category;
});

export interface Item {
  readonly id: string;
  readonly name: string;
  readonly price: Centavos;
  readonly categoryId: string;
  /** Whether its units are counted. Off for Items prepared to order. */
  readonly stockTracked: boolean;
  readonly minimum: number | null;
}

export interface NewItem {
  readonly name: string;
  readonly price: Centavos;
  readonly categoryId: string;
  /** Defaults to on. */
  readonly stockTracked?: boolean;
  readonly minimum?: number | null;
  /** Units on the shelf today. Ignored for an Item that is not stock-tracked. */
  readonly startingStock?: number;
}

const isUnits = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** The rules an Item's own fields obey, whoever else exists. */
const checkItem = Effect.fnUntraced(function* (item: Omit<Item, "id" | "categoryId">) {
  if (item.name === "") return yield* new NameMissing();
  if (!Number.isSafeInteger(item.price) || item.price <= 0) return yield* new InvalidPrice();
  if (item.minimum !== null && !isUnits(item.minimum)) return yield* new InvalidUnits({ field: "minimum" });
});

const ItemState = Schema.Struct({
  active: Schema.Int,
  nameTaken: Schema.Int,
  categoryRetired: Schema.NullOr(Schema.Int),
});

/**
 * Why a conditional write to an Item wrote nothing: the Item as it is, whether
 * another active Item holds `normalized`, and whether `categoryId` (the Item's
 * own Category when omitted) is retired or missing.
 */
const itemState = Effect.fnUntraced(function* (itemId: string, normalized: string | null, categoryId: string | null) {
  const db = yield* Db;
  return yield* db.first(
    ItemState,
    `SELECT i.retired_at IS NULL AS active,
            EXISTS (
              SELECT 1 FROM items o
              WHERE o.normalized_name = COALESCE(?, i.normalized_name) AND o.retired_at IS NULL AND o.id <> i.id
            ) AS nameTaken,
            (SELECT c.retired_at IS NOT NULL FROM categories c WHERE c.id = COALESCE(?, i.category_id)) AS categoryRetired
     FROM items i WHERE i.id = ?`,
    normalized,
    categoryId,
    itemId,
  );
});

const One = Schema.Struct({ one: Schema.Int });

/**
 * Adds an Item. Its starting Stock, when there is any, is recorded as a
 * Restock by this Admin (spec §5.8), in the same batch as the Item.
 */
export const addItem = Effect.fn("addItem")(function* (input: NewItem) {
  const admin = yield* requireAdmin;
  const db = yield* Db;

  const item: Item = {
    id: newId(),
    name: tidyName(input.name),
    price: input.price,
    categoryId: input.categoryId,
    stockTracked: input.stockTracked ?? true,
    minimum: input.minimum ?? null,
  };
  const startingStock = item.stockTracked ? (input.startingStock ?? 0) : 0;

  yield* checkItem(item);
  if (!isUnits(startingStock)) return yield* new InvalidUnits({ field: "startingStock" });

  const normalized = normalizeName(item.name);

  // A batch cannot branch: the Item is inserted only into an active Category
  // and only if its name is free, and the Restock only if the Item exists.
  const [inserted] = yield* db.batch([
    statement(
      `INSERT INTO items (id, name, normalized_name, price, category_id, stock_tracked, minimum)
       SELECT ?, ?, ?, ?, id, ?, ? FROM categories
       WHERE id = ? AND retired_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM items WHERE normalized_name = ? AND retired_at IS NULL)`,
      item.id, item.name, normalized, item.price, item.stockTracked ? 1 : 0, item.minimum,
      item.categoryId, normalized,
    ),
    ...(startingStock > 0
      ? adjustmentStatements({
          id: newId(),
          itemId: item.id,
          reason: "restock",
          units: startingStock,
          note: null,
          by: admin.id,
          at: yield* now,
          day: yield* today,
        })
      : []),
  ]);

  if (inserted!.changes === 0) {
    const taken = yield* db.first(
      One,
      "SELECT 1 AS one FROM items WHERE normalized_name = ? AND retired_at IS NULL LIMIT 1",
      normalized,
    );
    return yield* taken ? new ItemNameTaken() : new CategoryUnavailable();
  }
  return item;
});

/** What an Admin may change on an Item. Starting Stock is not among it. */
export type ItemChange = Omit<Item, "id">;

/**
 * Changes an Item in place. A new price reaches only Lines added afterwards,
 * because each Line keeps its own; switching stock tracking touches no Stock
 * record (spec §5.1).
 */
export const updateItem = Effect.fn("updateItem")(function* (itemId: string, input: ItemChange) {
  yield* requireAdmin;
  const db = yield* Db;

  const change: ItemChange = { ...input, name: tidyName(input.name) };
  yield* checkItem(change);
  const normalized = normalizeName(change.name);

  // A retired Item may keep a name that an active one has since taken, and may
  // stay in its retired Category; restoring it is where those are checked.
  const { changes } = yield* db.run(
    `UPDATE items
     SET name = ?, normalized_name = ?, price = ?, category_id = ?, stock_tracked = ?, minimum = ?
     WHERE id = ?
       AND (retired_at IS NOT NULL OR NOT EXISTS (
             SELECT 1 FROM items o WHERE o.normalized_name = ? AND o.retired_at IS NULL AND o.id <> items.id))
       AND EXISTS (
             SELECT 1 FROM categories c
             WHERE c.id = ? AND (c.retired_at IS NULL OR c.id = items.category_id))`,
    change.name, normalized, change.price, change.categoryId, change.stockTracked ? 1 : 0, change.minimum,
    itemId, normalized, change.categoryId,
  );
  if (changes > 0) return;

  const state = yield* itemState(itemId, normalized, change.categoryId);
  if (!state) return yield* new ItemNotFound();
  if (state.active && state.nameTaken) return yield* new ItemNameTaken();
  return yield* new CategoryUnavailable();
});

/** Retires an Item: it leaves the Sell screen, and every record of it stays. */
export const retireItem = Effect.fn("retireItem")(function* (itemId: string) {
  yield* requireAdmin;
  const db = yield* Db;
  const { changes } = yield* db.run(
    "UPDATE items SET retired_at = ? WHERE id = ? AND retired_at IS NULL",
    yield* now,
    itemId,
  );
  // Already retired is not an error: the Admin has what they asked for.
  if (changes === 0 && !(yield* itemState(itemId, null, null))) return yield* new ItemNotFound();
});

/** Restores a retired Item, unless its name was taken or its Category is retired. */
export const restoreItem = Effect.fn("restoreItem")(function* (itemId: string) {
  yield* requireAdmin;
  const db = yield* Db;
  const { changes } = yield* db.run(
    `UPDATE items SET retired_at = NULL
     WHERE id = ? AND retired_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM categories c WHERE c.id = items.category_id AND c.retired_at IS NULL)
       AND NOT EXISTS (
             SELECT 1 FROM items o WHERE o.normalized_name = items.normalized_name AND o.retired_at IS NULL)`,
    itemId,
  );
  if (changes > 0) return;

  const state = yield* itemState(itemId, null, null);
  if (!state) return yield* new ItemNotFound();
  if (state.active) return;
  if (state.nameTaken) return yield* new ItemNameTaken();
  return yield* new CategoryUnavailable();
});

/** Gives a Category another name. */
export const renameCategory = Effect.fn("renameCategory")(function* (categoryId: string, name: string) {
  yield* requireAdmin;
  const db = yield* Db;
  const tidy = tidyName(name);
  if (tidy === "") return yield* new NameMissing();

  const { changes } = yield* db.run("UPDATE categories SET name = ? WHERE id = ?", tidy, categoryId);
  if (changes === 0) return yield* new CategoryNotFound();
});

const Position = Schema.Struct({ id: Schema.String, position: Schema.Int });

/**
 * Moves an active Category one place earlier or later on the Sell screen, by
 * trading positions with its neighbour. At the end of the list it stays put.
 */
export const moveCategory = Effect.fn("moveCategory")(function* (categoryId: string, direction: "earlier" | "later") {
  yield* requireAdmin;
  const db = yield* Db;
  const active = yield* db.all(
    Position,
    "SELECT id, position FROM categories WHERE retired_at IS NULL ORDER BY position, id",
  );
  const index = active.findIndex((category) => category.id === categoryId);
  const moved = active[index];
  if (!moved) return yield* new CategoryNotFound();
  const neighbour = active[direction === "earlier" ? index - 1 : index + 1];
  if (!neighbour) return;

  const setPosition = "UPDATE categories SET position = ? WHERE id = ?";
  yield* db.batch([
    statement(setPosition, neighbour.position, moved.id),
    statement(setPosition, moved.position, neighbour.id),
  ]);
});

const CategoryState = Schema.Struct({ retired: Schema.Int, activeItems: Schema.Int });

/** Retires a Category that has no active Item (spec §5.1). */
export const retireCategory = Effect.fn("retireCategory")(function* (categoryId: string) {
  yield* requireAdmin;
  const db = yield* Db;
  const { changes } = yield* db.run(
    `UPDATE categories SET retired_at = ?
     WHERE id = ? AND retired_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM items WHERE category_id = categories.id AND retired_at IS NULL)`,
    yield* now,
    categoryId,
  );
  if (changes > 0) return;

  const state = yield* db.first(
    CategoryState,
    `SELECT retired_at IS NOT NULL AS retired,
            EXISTS (SELECT 1 FROM items WHERE category_id = categories.id AND retired_at IS NULL) AS activeItems
     FROM categories WHERE id = ?`,
    categoryId,
  );
  if (!state) return yield* new CategoryNotFound();
  if (!state.retired && state.activeItems) return yield* new CategoryHasActiveItems();
});

/** Restores a retired Category. */
export const restoreCategory = Effect.fn("restoreCategory")(function* (categoryId: string) {
  yield* requireAdmin;
  const db = yield* Db;
  const { changes } = yield* db.run("UPDATE categories SET retired_at = NULL WHERE id = ?", categoryId);
  if (changes === 0) return yield* new CategoryNotFound();
});

const ItemRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  price: Schema.Int,
  categoryId: Schema.String,
  stockTracked: Schema.Int,
  minimum: Schema.NullOr(Schema.Int),
  retiredAt: Schema.NullOr(Schema.Int),
});

const ITEM_COLUMNS =
  "id, name, price, category_id AS categoryId, stock_tracked AS stockTracked, minimum, retired_at AS retiredAt";

export interface CatalogItem extends Item {
  readonly retired: boolean;
}

function catalogItem(row: (typeof ItemRow)["Type"]): CatalogItem {
  const { stockTracked, retiredAt, ...item } = row;
  return { ...item, stockTracked: stockTracked === 1, retired: retiredAt !== null };
}

/** One Item, retired or not, for an Admin to edit. */
export const getItem = Effect.fn("getItem")(function* (itemId: string) {
  yield* requireAdmin;
  const db = yield* Db;
  const row = yield* db.first(ItemRow, `SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`, itemId);
  if (!row) return yield* new ItemNotFound();
  return catalogItem(row);
});

const CategoryRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  retiredAt: Schema.NullOr(Schema.Int),
});

export interface CatalogCategory extends Category {
  readonly retired: boolean;
  /** Its Items, retired ones too, in name order. */
  readonly items: ReadonlyArray<CatalogItem>;
}

/**
 * Everything on Productos: every Category in position order, retired ones
 * too, each with all of its Items in name order.
 */
export const listCatalog = Effect.gen(function* () {
  yield* requireAdmin;
  const db = yield* Db;
  const categories = yield* db.all(
    CategoryRow,
    "SELECT id, name, retired_at AS retiredAt FROM categories ORDER BY position, id",
  );
  const items = yield* db.all(ItemRow, `SELECT ${ITEM_COLUMNS} FROM items ORDER BY normalized_name, id`);

  return categories.map(
    ({ retiredAt, ...category }): CatalogCategory => ({
      ...category,
      retired: retiredAt !== null,
      items: items.filter((item) => item.categoryId === category.id).map(catalogItem),
    }),
  );
});

const ActiveItemRow = Schema.Struct({
  categoryId: Schema.String,
  categoryName: Schema.String,
  id: Schema.String,
  name: Schema.String,
  price: Schema.Int,
});

/** An Item as the Sell screen needs it. It carries nothing about Stock (spec §4.2). */
export interface ActiveItem {
  readonly id: string;
  readonly name: string;
  readonly price: Centavos;
}

export interface ActiveCategory extends Category {
  readonly items: ReadonlyArray<ActiveItem>;
}

/**
 * The active Items grouped by Category: Categories in position order, Items
 * within each in name order, ignoring case and accents (spec §5.1). A Category
 * with no active Item is left out. For every User; one statement.
 */
export const activeItemsByCategory = Effect.gen(function* () {
  const db = yield* Db;
  const rows = yield* db.all(
    ActiveItemRow,
    `SELECT c.id AS categoryId, c.name AS categoryName, i.id, i.name, i.price
     FROM items i JOIN categories c ON c.id = i.category_id
     WHERE i.retired_at IS NULL
     ORDER BY c.position, c.id, i.normalized_name`,
  );

  const groups: Array<{ id: string; name: string; items: Array<ActiveItem> }> = [];
  for (const { categoryId, categoryName, ...item } of rows) {
    let group = groups.at(-1);
    if (group?.id !== categoryId) groups.push((group = { id: categoryId, name: categoryName, items: [] }));
    group.items.push(item);
  }
  return groups as ReadonlyArray<ActiveCategory>;
});
