import { Effect } from "effect";

import { addCategory, addItem, type NewItem } from "~/backend/catalog";
import type { CurrentUser } from "~/backend/current-user";

import { as, seedUser } from "./auth";

type User = CurrentUser["Service"];

// Tests in one file share a D1, and active Item names are unique.
let serial = 0;

/** The Admin who adds the seed, or a new one when the test does not care who. */
const admin = (by: User | undefined) => (by ? Effect.succeed(by) : seedUser("admin", "Semilla"));

/**
 * Adds a Category through the real operation, for a program run with
 * `runTest`: `const bebidas = yield* seedCategory("Bebidas")`. Categories are
 * positioned in the order they are added.
 */
export const seedCategory = Effect.fnUntraced(function* (name?: string, by?: User) {
  return yield* addCategory(name ?? `Categoría ${++serial}`).pipe(as(yield* admin(by)));
});

export interface SeedItem extends Partial<NewItem> {
  /** The Admin who adds it, and the author of the Restock for `startingStock`. */
  readonly by?: User;
}

/**
 * Adds an Item through the real operation. Everything has a default: a name
 * that no other seeded Item has, $10.00, a Category of its own, stock-tracked,
 * no Minimum and no Stock.
 *
 *     const agua = yield* seedItem({ name: "Agua", price: 1850, startingStock: 24 });
 */
export const seedItem = Effect.fnUntraced(function* ({ by, ...item }: SeedItem = {}) {
  const author = yield* admin(by);
  return yield* addItem({
    ...item,
    name: item.name ?? `Producto ${++serial}`,
    price: item.price ?? 1000,
    categoryId: item.categoryId ?? (yield* seedCategory(undefined, author)).id,
  }).pipe(as(author));
});
