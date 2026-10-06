import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { retireItem } from "~/backend/catalog";
import { listCountItems, listCounts, previewCount, recordCount } from "~/backend/counts";
import { Db, type Param } from "~/backend/db";
import { recordAdjustment } from "~/backend/inventory";
import { lastCountedAt, stockOf } from "~/backend/stock";

import { as, seedUser } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { advanceClock, runTest, setClock } from "./support/effect";

// Counts through their operations: what confirming records and sets, what the
// entry and review steps show, and who may do any of it (spec §5.8, §7.3).
// The routes are tested in conteo.test.ts.

describe("recordCount", () => {
  it("sets Stock to the units found and records each line with the Stock it replaced, zero included", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* seedCategory("Conteo básico", ana);
        const pan = yield* seedItem({ name: "Contado pan", categoryId: category.id, startingStock: 4, by: ana });
        const agua = yield* seedItem({ name: "Contada agua", categoryId: category.id, startingStock: 10, by: ana });

        const { id } = yield* recordCount({
          lines: [
            { itemId: agua.id, found: 7 },
            { itemId: pan.id, found: 4 },
          ],
        }).pipe(as(ana));

        expect(yield* stockOf(agua.id).pipe(as(ana))).toBe(7);
        expect(yield* stockOf(pan.id).pipe(as(ana))).toBe(4);
        expect(
          (yield* listCounts().pipe(as(ana))).find((count) => count.id === id)?.lines,
        ).toEqual([
          { itemId: agua.id, itemName: "Contada agua", expected: 10, found: 7, difference: -3 },
          { itemId: pan.id, itemName: "Contado pan", expected: 4, found: 4, difference: 0 },
        ]);
      }),
    ));

  it("reads the Stock expected inside the batch, not off the review page, and updates last counted at", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Contado tras una venta", startingStock: 10, by: ana });
        yield* setClock("2026-10-05T10:00:00");

        const review = yield* previewCount([{ itemId: item.id, found: 7 }]).pipe(as(ana));
        expect(review).toEqual([
          { itemId: item.id, itemName: "Contado tras una venta", expected: 10, found: 7, difference: -3 },
        ]);

        // A sale (an Adjustment stands in) lands between review and confirm.
        yield* advanceClock("5 minutes");
        yield* recordAdjustment({ itemId: item.id, reason: "waste", units: 4 }).pipe(as(ana));
        const { id } = yield* recordCount({ lines: [{ itemId: item.id, found: 7 }] }).pipe(as(ana));

        const count = (yield* listCounts().pipe(as(ana))).find((row) => row.id === id)!;
        expect(count.lines).toEqual([
          { itemId: item.id, itemName: "Contado tras una venta", expected: 6, found: 7, difference: 1 },
        ]);
        expect(count.day).toBe("2026-10-05");
        expect(count.byName).toBe("Ana");
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(7);
        expect(yield* lastCountedAt(item.id).pipe(as(ana))).toBe(count.at);
      }),
    ));

  it("counts an Item that never had a Stock row as expected zero", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Nunca con fila", by: ana });

        const { id } = yield* recordCount({ lines: [{ itemId: item.id, found: 2 }] }).pipe(as(ana));

        expect(
          (yield* listCounts().pipe(as(ana))).find((count) => count.id === id)?.lines,
        ).toEqual([{ itemId: item.id, itemName: "Nunca con fila", expected: 0, found: 2, difference: 2 }]);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(2);
      }),
    ));

  it("ignores a second line for the same Item", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Contado dos veces", startingStock: 3, by: ana });

        const { id } = yield* recordCount({
          lines: [
            { itemId: item.id, found: 5 },
            { itemId: item.id, found: 9 },
          ],
        }).pipe(as(ana));

        expect(
          (yield* listCounts().pipe(as(ana))).find((count) => count.id === id)?.lines,
        ).toEqual([{ itemId: item.id, itemName: "Contado dos veces", expected: 3, found: 5, difference: 2 }]);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(5);
      }),
    ));

  it("refuses units that are not a whole number of zero or more, and an empty Count, writing nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Sin unidades válidas", startingStock: 4, by: ana });
        const before = (yield* listCounts().pipe(as(ana))).length;

        for (const found of [-1, 1.5, Number.NaN]) {
          const error = yield* Effect.flip(recordCount({ lines: [{ itemId: item.id, found }] }).pipe(as(ana)));
          expect(error._tag).toBe("InvalidCountUnits");
        }
        expect((yield* Effect.flip(recordCount({ lines: [] }).pipe(as(ana))))._tag).toBe("NoItemsCounted");

        expect((yield* listCounts().pipe(as(ana))).length).toBe(before);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(4);
      }),
    ));

  it("refuses an Item that does not exist or is not stock-tracked, writing nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* seedCategory("Conteo rechazado", ana);
        const tracked = yield* seedItem({ name: "Contable", categoryId: category.id, startingStock: 1, by: ana });
        const untracked = yield* seedItem({
          name: "Preparado al momento",
          categoryId: category.id,
          stockTracked: false,
          by: ana,
        });
        const before = (yield* listCounts().pipe(as(ana))).length;

        const missing = yield* Effect.flip(recordCount({ lines: [{ itemId: "no-existe", found: 1 }] }).pipe(as(ana)));
        expect(missing._tag).toBe("ItemNotFound");
        const notTracked = yield* Effect.flip(
          recordCount({
            lines: [
              { itemId: tracked.id, found: 1 },
              { itemId: untracked.id, found: 1 },
            ],
          }).pipe(as(ana)),
        );
        expect(notTracked._tag).toBe("ItemNotStockTracked");

        expect((yield* listCounts().pipe(as(ana))).length).toBe(before);
        expect(yield* stockOf(tracked.id).pipe(as(ana))).toBe(1);
        expect(yield* stockOf(untracked.id).pipe(as(ana))).toBe(0);
      }),
    ));

  it("records the note the Admin wrote", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Con nota", startingStock: 2, by: ana });

        const { id } = yield* recordCount({ lines: [{ itemId: item.id, found: 2 }], note: "  Conteo de prueba  " }).pipe(
          as(ana),
        );

        expect((yield* listCounts().pipe(as(ana))).find((count) => count.id === id)?.note).toBe("Conteo de prueba");
      }),
    ));
});

describe("previewCount", () => {
  it("shows nothing recorded and refuses an Item that does not exist or is not stock-tracked", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const untracked = yield* seedItem({ name: "No revisable", stockTracked: false, by: ana });

        expect(
          (yield* Effect.flip(previewCount([{ itemId: "no-existe", found: 0 }]).pipe(as(ana))))._tag,
        ).toBe("ItemNotFound");
        expect(
          (yield* Effect.flip(previewCount([{ itemId: untracked.id, found: 0 }]).pipe(as(ana))))._tag,
        ).toBe("ItemNotStockTracked");
        expect((yield* Effect.flip(previewCount([]).pipe(as(ana))))._tag).toBe("NoItemsCounted");
      }),
    ));
});

describe("listCountItems", () => {
  it("lists each stock-tracked Item's name, retired ones too, and nothing about Stock", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* seedCategory("Entrada del conteo", ana);
        const active = yield* seedItem({ name: "Activo contable", categoryId: category.id, startingStock: 5, by: ana });
        const retired = yield* seedItem({ name: "Retirado contable", categoryId: category.id, startingStock: 5, by: ana });
        const untracked = yield* seedItem({
          name: "No contable",
          categoryId: category.id,
          stockTracked: false,
          by: ana,
        });
        yield* retireItem(retired.id).pipe(as(ana));

        const lines = (yield* listCountItems.pipe(as(ana))).filter((line) =>
          [active.id, retired.id, untracked.id].includes(line.id),
        );

        expect(lines).toEqual([
          { id: active.id, name: "Activo contable", retired: false },
          { id: retired.id, name: "Retirado contable", retired: true },
        ]);
      }),
    ));
});

describe("listCounts", () => {
  it("lists the most recent Counts newest first, and shows only the requested number", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Dos conteos", startingStock: 1, by: ana });
        // Later than every other Count this file writes, so the newest is ours.
        yield* setClock("2027-01-01T09:00:00");
        const first = yield* recordCount({ lines: [{ itemId: item.id, found: 1 }] }).pipe(as(ana));
        yield* advanceClock("1 minute");
        const second = yield* recordCount({ lines: [{ itemId: item.id, found: 2 }] }).pipe(as(ana));

        const lines = yield* listCounts().pipe(as(ana));
        const ours = lines.filter((count) => [first.id, second.id].includes(count.id));
        expect(ours.map((count) => count.id)).toEqual([second.id, first.id]);
        expect((yield* listCounts(1).pipe(as(ana))).length).toBe(1);
        expect((yield* listCounts(1).pipe(as(ana)))[0]!.id).toBe(second.id);
      }),
    ));
});

describe("a Count of every Item", () => {
  interface Budget {
    statements: number;
    maxParams: number;
  }

  /** The real `Db`, counting what the program sends through it (spec §2.4). */
  function countingDb(real: Db["Service"], budget: Budget): Db["Service"] {
    const record = (params: ReadonlyArray<Param>) => {
      budget.statements += 1;
      budget.maxParams = Math.max(budget.maxParams, params.length);
    };
    return Db.of({
      first: <A>(schema: Schema.Decoder<A>, sql: string, ...params: ReadonlyArray<Param>) => {
        record(params);
        return real.first(schema, sql, ...params);
      },
      all: <A>(schema: Schema.Decoder<A>, sql: string, ...params: ReadonlyArray<Param>) => {
        record(params);
        return real.all(schema, sql, ...params);
      },
      run: (sql: string, ...params: ReadonlyArray<Param>) => {
        record(params);
        return real.run(sql, ...params);
      },
      batch: (statements: ReadonlyArray<{ readonly sql: string; readonly params: ReadonlyArray<Param> }>) => {
        for (const one of statements) record(one.params);
        return real.batch(statements);
      },
    });
  }

  it("issues fewer than 50 statements, none with more than 100 bound parameters", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* seedCategory("Conteo completo", ana);
        const items: Array<{ id: string }> = [];
        for (let at = 0; at < 60; at += 1) {
          items.push(
            yield* seedItem({
              name: `Producto contado ${at + 1}`,
              categoryId: category.id,
              startingStock: at,
              by: ana,
            }),
          );
        }
        const counted = items.map((item, at) => ({ itemId: item.id, found: at + (at % 2 === 0 ? 1 : -1) }));

        const budget: Budget = { statements: 0, maxParams: 0 };
        const real = yield* Db;
        const { id } = yield* recordCount({ lines: counted }).pipe(
          as(ana),
          Effect.provideService(Db, countingDb(real, budget)),
        );

        expect(budget.statements).toBeLessThan(50);
        expect(budget.maxParams).toBeLessThanOrEqual(100);
        // And it counted all sixty, each against the Stock of that moment.
        const count = (yield* listCounts().pipe(as(ana))).find((row) => row.id === id)!;
        expect(count.lines).toHaveLength(60);
        for (const [at, item] of items.entries()) {
          const line = count.lines.find((row) => row.itemId === item.id)!;
          expect(line.expected, `item ${at + 1} expected`).toBe(at);
          expect(yield* stockOf(item.id).pipe(as(ana)), `item ${at + 1} stock`).toBe(counted[at]!.found);
        }
      }),
    ));
});

describe("a Worker", () => {
  it("is refused every Count operation", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker");
        const item = yield* seedItem({ name: "Solo para admins", startingStock: 2, by: ana });

        expect((yield* Effect.flip(listCountItems.pipe(as(beto))))._tag).toBe("AdminOnly");
        expect((yield* Effect.flip(listCounts().pipe(as(beto))))._tag).toBe("AdminOnly");
        expect((yield* Effect.flip(previewCount([{ itemId: item.id, found: 1 }]).pipe(as(beto))))._tag).toBe(
          "AdminOnly",
        );
        expect((yield* Effect.flip(recordCount({ lines: [{ itemId: item.id, found: 1 }] }).pipe(as(beto))))._tag).toBe(
          "AdminOnly",
        );

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(2);
      }),
    ));
});
