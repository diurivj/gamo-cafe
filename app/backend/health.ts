import { Effect, Schema } from "effect";

import type { Day } from "~/shared/day";

import { Db } from "./db";
import { today } from "./time";

// The reference operation: an Effect program whose dependencies are services.
// It reads through `Db`, decodes the row with a Schema, and takes "now" from
// the Clock via `today`.

const AppMeta = Schema.Struct({ value: Schema.String });

export type Health = { readonly ok: true; readonly day: Day } | { readonly ok: false };

/**
 * Whether the Worker reaches a migrated D1. Being unable to is this
 * operation's answer rather than its failure, so it handles `DbError` itself.
 */
export const checkHealth: Effect.Effect<Health, never, Db> = Effect.gen(function* () {
  const db = yield* Db;
  const app = yield* db.first(AppMeta, "SELECT value FROM app_meta WHERE key = ?", "app");
  if (!app) return { ok: false } as const;
  return { ok: true, day: yield* today } as const;
}).pipe(Effect.catchTag("DbError", () => Effect.succeed({ ok: false } as const)));
