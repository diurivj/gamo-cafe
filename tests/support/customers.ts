import { env } from "cloudflare:workers";
import { Effect } from "effect";

import type { CurrentUser } from "~/backend/current-user";
import { addCustomer, retireCustomer } from "~/backend/customers";
import { Db } from "~/backend/db";

import { as, seedUser } from "./auth";

type User = CurrentUser["Service"];

export interface CustomerSeed {
  /** Who adds the Customer. A new Worker when left out. */
  readonly by?: User;
  readonly note?: string;
  /** Adds the Customer and retires them. */
  readonly retired?: boolean;
}

/**
 * Adds a Customer through the real operations, for a program run with
 * `runTest`:
 *
 *     const ruiz = yield* seedCustomer("Familia Ruiz");
 *     const gone = yield* seedCustomer("Don Paco", { by: beto, retired: true });
 *
 * Tests in one file share a D1 and active names are unique: use a different
 * name in each test.
 */
export const seedCustomer = Effect.fnUntraced(function* (name: string, seed: CustomerSeed = {}) {
  const by = seed.by ?? (yield* seedUser("worker"));
  const customer = yield* addCustomer({ name, note: seed.note }).pipe(as(by));
  // Retiring records no author, so whoever added them stands in as the Admin.
  if (seed.retired) yield* retireCustomer(customer.id).pipe(as({ ...by, role: "admin" }));
  return customer;
});

/**
 * `seedCustomer` for tests that go through the Worker, which run no program
 * of their own:
 *
 *     const ruiz = await savedCustomer("Familia Ruiz", { by: beto.user });
 */
export function savedCustomer(name: string, seed: CustomerSeed = {}) {
  return Effect.runPromise(seedCustomer(name, seed).pipe(Effect.provide(Db.layer(env.DB))));
}
