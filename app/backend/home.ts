import { Effect, Schema } from "effect";

import { CurrentUser } from "./current-user";
import { type Figures, figuresForRange, myFigures } from "./day";
import { Db } from "./db";
import { listInventory } from "./inventory";
import { today } from "./time";
import type { Centavos } from "~/shared/money";

/** What the cards of Inicio say. */
export interface HomeSummary {
  /** The Bills that still owe, and what they owe together. */
  readonly openBills: { readonly count: number; readonly owed: Centavos };
  /** What the signed-in User sold and collected today. */
  readonly mine: Figures;
  /** Today's figures of every User together. An Admin's; null for a Worker. */
  readonly everyone: Figures | null;
  /** How many active Items are at or under their Minimum, or below zero. An Admin's; null for a Worker. */
  readonly toRestock: number | null;
}

const OpenBills = Schema.Struct({ count: Schema.Int, owed: Schema.Int });

/**
 * Inicio (UI redesign §4): the few figures its cards carry. Every User gets
 * their own Day and the Open Bills, which Cuentas abiertas shows them anyway.
 * The Day of everyone and Stock are read only for an Admin (spec §4.1, §4.2):
 * a Worker's answer holds `null` in their place.
 */
export const homeSummary = Effect.gen(function* () {
  const user = yield* CurrentUser;
  const db = yield* Db;

  const openBills = yield* db.first(
    OpenBills,
    `SELECT COUNT(*) AS count, COALESCE(SUM(total - paid), 0) AS owed
     FROM bills WHERE state IN ('open', 'partial')`,
  );
  const summary = { openBills: openBills ?? { count: 0, owed: 0 }, mine: yield* myFigures };
  if (user.role !== "admin") return { ...summary, everyone: null, toRestock: null } satisfies HomeSummary;

  const day = yield* today;
  const { total } = yield* figuresForRange({ from: day, to: day });
  const inventory = yield* listInventory;
  return {
    ...summary,
    everyone: total,
    toRestock: inventory.filter((line) => !line.retired && (line.needsRestock || line.belowZero)).length,
  } satisfies HomeSummary;
});
