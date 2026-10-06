import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { Db } from "~/backend/db";
import { adjustmentStatements, changeStock, listAdjustments, stockOf } from "~/backend/stock";

import { as, seedUser } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { runTest } from "./support/effect";

// The Stock statements are parts for other operations' batches (Lines in
// ticket 06, Adjustments in 12). Here they are sent in a batch of their own.

describe("changeStock", () => {
  it("moves Stock by a relative amount, below zero too", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ startingStock: 2, by: ana });

        const [first, second] = yield* db.batch([changeStock(item.id, -1), changeStock(item.id, -2)]);

        expect([first!.changes, second!.changes]).toEqual([1, 1]);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(-1);
      }),
    ));

  it("starts from zero for an Item that never had Stock", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ by: ana });

        yield* db.batch([changeStock(item.id, -1)]);

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(-1);
      }),
    ));

  it("does nothing to an Item that is not stock-tracked, and says so", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ stockTracked: false, by: ana });

        const [result] = yield* db.batch([changeStock(item.id, -4)]);

        expect(result!.changes).toBe(0);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(0);
      }),
    ));
});

describe("adjustmentStatements", () => {
  const adjustment = { note: null, at: 1_000, day: "1969-12-31" } as const;

  it("adds a Restock's units and subtracts those of Waste and Internal use", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ by: ana });
        const record = (id: string, reason: "restock" | "waste" | "internal_use", units: number) =>
          adjustmentStatements({ ...adjustment, id, itemId: item.id, reason, units, by: ana.id });

        yield* db.batch([
          ...record(`${item.id}-1`, "restock", 10),
          ...record(`${item.id}-2`, "waste", 3),
          ...record(`${item.id}-3`, "internal_use", 2),
        ]);

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(5);
        expect((yield* listAdjustments(item.id).pipe(as(ana))).map(({ reason, units }) => [reason, units])).toEqual([
          ["restock", 10],
          ["waste", 3],
          ["internal_use", 2],
        ]);
      }),
    ));

  it("records nothing for an Item that is not stock-tracked", () =>
    runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        const ana = yield* seedUser("admin");
        const category = yield* seedCategory("Cocina", ana);
        const item = yield* seedItem({ categoryId: category.id, stockTracked: false, by: ana });

        const [fact, projection] = yield* db.batch(
          adjustmentStatements({ ...adjustment, id: `${item.id}-1`, itemId: item.id, reason: "restock", units: 5, by: ana.id }),
        );

        expect([fact!.changes, projection!.changes]).toEqual([0, 0]);
        expect(yield* listAdjustments(item.id).pipe(as(ana))).toEqual([]);
      }),
    ));
});
