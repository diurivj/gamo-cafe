import { Cause, Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import { getItem, retireItem, updateItem } from "~/backend/catalog";
import {
  adjustmentStanding,
  cancelAdjustment,
  listInventory,
  listRecentAdjustments,
  recordAdjustment,
} from "~/backend/inventory";
import { listAdjustments, stockOf } from "~/backend/stock";

import { as, seedUser } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { runTest, setClock, advanceClock } from "./support/effect";

// Inventario through its operations: recording and cancelling Adjustments
// (spec §5.8, §7.3), and the Stock and Minimums an Admin sees. The routes are
// tested in inventario.test.ts.

const recorded = (admin: Parameters<typeof as>[0], ids: ReadonlyArray<string>) =>
  listRecentAdjustments().pipe(
    as(admin),
    Effect.map((rows) => rows.filter((row) => ids.includes(row.itemId))),
  );

describe("recordAdjustment", () => {
  it("adds a Restock and subtracts Waste and Internal use, with the Day, the author and the note", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Café molido", by: ana });
        yield* setClock("2026-10-05T10:00:00");

        yield* recordAdjustment({ itemId: item.id, reason: "restock", units: 10, note: " Compra " }).pipe(as(ana));
        yield* advanceClock("1 minute");
        yield* recordAdjustment({ itemId: item.id, reason: "waste", units: 3 }).pipe(as(ana));
        yield* advanceClock("1 minute");
        yield* recordAdjustment({ itemId: item.id, reason: "internal_use", units: 2, note: "" }).pipe(as(ana));

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(5);
        expect(
          (yield* recorded(ana, [item.id])).map(({ reason, units, note, day, byName }) => [
            reason,
            units,
            note,
            day,
            byName,
          ]),
        ).toEqual([
          ["internal_use", 2, null, "2026-10-05", "Ana"],
          ["waste", 3, null, "2026-10-05", "Ana"],
          ["restock", 10, "Compra", "2026-10-05", "Ana"],
        ]);
      }),
    ));

  it("refuses a number of units that is not a whole number of one or more", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Sin unidades válidas", by: ana });

        for (const units of [0, -1, 1.5, Number.NaN]) {
          const error = yield* Effect.flip(recordAdjustment({ itemId: item.id, reason: "restock", units }).pipe(as(ana)));
          expect(error._tag).toBe("InvalidAdjustmentUnits");
        }
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(0);
        expect(yield* recorded(ana, [item.id])).toEqual([]);
      }),
    ));

  it("refuses an Item that is not stock-tracked, and writes nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* seedCategory("Cocina de inventario", ana);
        const item = yield* seedItem({ name: "Hecho al momento", categoryId: category.id, stockTracked: false, by: ana });

        const error = yield* Effect.flip(
          recordAdjustment({ itemId: item.id, reason: "restock", units: 5 }).pipe(as(ana)),
        );

        expect(error._tag).toBe("ItemNotStockTracked");
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(0);
        expect(yield* listAdjustments(item.id).pipe(as(ana))).toEqual([]);
      }),
    ));

  it("refuses an Item that does not exist", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const error = yield* Effect.flip(
          recordAdjustment({ itemId: "no-existe", reason: "restock", units: 1 }).pipe(as(ana)),
        );
        expect(error._tag).toBe("ItemNotFound");
      }),
    ));
});

describe("cancelAdjustment", () => {
  it("reverses the Adjustment's effect and records the cancellation with its reason", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Reversible", by: ana });
        const { id: restock } = yield* recordAdjustment({ itemId: item.id, reason: "restock", units: 10 }).pipe(as(ana));
        yield* advanceClock("1 minute");
        const { id: waste } = yield* recordAdjustment({ itemId: item.id, reason: "waste", units: 4 }).pipe(as(ana));
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(6);

        yield* cancelAdjustment(waste, "Se cayó al piso").pipe(as(ana));
        yield* cancelAdjustment(restock, "Compra cancelada").pipe(as(ana));

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(0);
        expect((yield* recorded(ana, [item.id])).map(({ cancellation }) => cancellation?.reason)).toEqual([
          "Se cayó al piso",
          "Compra cancelada",
        ]);
      }),
    ));

  it("reverses Stock from the Adjustment's own fact, even after the Item stopped being tracked", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* seedCategory("Reversión sin seguimiento", ana);
        const item = yield* seedItem({ name: "Cambió de seguimiento", categoryId: category.id, startingStock: 5, by: ana });
        const { id } = yield* recordAdjustment({ itemId: item.id, reason: "waste", units: 2 }).pipe(as(ana));
        const tracked = yield* getItem(item.id).pipe(as(ana));

        // Switching tracking off touches no record (spec §5.1), but the
        // Adjustment already moved Stock through its own fact, so cancelling
        // it gives those units back — what the rebuild (ticket 19) computes.
        yield* updateItem(item.id, { ...tracked, stockTracked: false }).pipe(as(ana));
        yield* cancelAdjustment(id, "Captura equivocada").pipe(as(ana));

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(5);
      }),
    ));

  it("happens once: a second cancellation is refused and moves nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Una sola vez", by: ana });
        const { id } = yield* recordAdjustment({ itemId: item.id, reason: "restock", units: 8 }).pipe(as(ana));

        yield* cancelAdjustment(id, "Error de captura").pipe(as(ana));
        const error = yield* Effect.flip(cancelAdjustment(id, "Otra vez").pipe(as(ana)));

        expect(error._tag).toBe("AdjustmentAlreadyCancelled");
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(0);
        expect(yield* listAdjustments(item.id).pipe(as(ana))).toHaveLength(1);
      }),
    ));

  it("reverses Stock exactly once when two cancellations race", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Cancelación en carrera", by: ana });
        const { id } = yield* recordAdjustment({ itemId: item.id, reason: "restock", units: 5 }).pipe(as(ana));

        const outcomes = yield* Effect.all(
          [
            Effect.exit(cancelAdjustment(id, "Primera").pipe(as(ana))),
            Effect.exit(cancelAdjustment(id, "Segunda").pipe(as(ana))),
          ],
          { concurrency: "unbounded" },
        );

        expect(outcomes.filter((exit) => exit._tag === "Success")).toHaveLength(1);
        const failure = outcomes.find((exit) => exit._tag === "Failure")!;
        const error = Cause.findErrorOption(failure.cause);
        expect(Option.isSome(error) ? error.value._tag : "no error").toBe("AdjustmentAlreadyCancelled");
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(0);
        expect((yield* recorded(ana, [item.id])).map(({ cancellation }) => cancellation?.byName)).toEqual(["Ana"]);
      }),
    ));

  it("needs a reason", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Sin motivo", by: ana });
        const { id } = yield* recordAdjustment({ itemId: item.id, reason: "waste", units: 2 }).pipe(as(ana));

        const error = yield* Effect.flip(cancelAdjustment(id, "   ").pipe(as(ana)));

        expect(error._tag).toBe("ReasonMissing");
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(-2);
      }),
    ));

  it("refuses an Adjustment that does not exist", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const error = yield* Effect.flip(cancelAdjustment("no-existe", "porque sí").pipe(as(ana)));
        expect(error._tag).toBe("AdjustmentNotFound");
      }),
    ));
});

describe("listInventory", () => {
  it("shows each stock-tracked Item's Stock and Minimum, flags it at or below its Minimum and flags zero below separately", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const category = yield* seedCategory("Existencias", ana);
        const normal = yield* seedItem({ name: "Suficiente", categoryId: category.id, startingStock: 6, minimum: 5, by: ana });
        const low = yield* seedItem({ name: "Por reponer", categoryId: category.id, startingStock: 5, minimum: 5, by: ana });
        const negative = yield* seedItem({ name: "Bajo cero", categoryId: category.id, startingStock: 1, by: ana });
        const untracked = yield* seedItem({ name: "Sin inventario", categoryId: category.id, stockTracked: false, by: ana });
        const retired = yield* seedItem({ name: "Retirado con stock", categoryId: category.id, startingStock: 4, by: ana });
        yield* recordAdjustment({ itemId: negative.id, reason: "waste", units: 2 }).pipe(as(ana));
        yield* retireItem(retired.id).pipe(as(ana));

        const lines = (yield* listInventory.pipe(as(ana))).filter((line) =>
          [normal.id, low.id, negative.id, untracked.id, retired.id].includes(line.id),
        );

        expect(lines).toEqual([
          { id: negative.id, name: "Bajo cero", stock: -1, minimum: null, retired: false, needsRestock: false, belowZero: true },
          { id: low.id, name: "Por reponer", stock: 5, minimum: 5, retired: false, needsRestock: true, belowZero: false },
          { id: retired.id, name: "Retirado con stock", stock: 4, minimum: null, retired: true, needsRestock: false, belowZero: false },
          { id: normal.id, name: "Suficiente", stock: 6, minimum: 5, retired: false, needsRestock: false, belowZero: false },
        ]);
      }),
    ));

  it("reads zero for an Item that has no Stock row", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Sin fila de stock", by: ana });

        const line = (yield* listInventory.pipe(as(ana))).find(({ id }) => id === item.id);

        expect(line).toMatchObject({ stock: 0, needsRestock: false, belowZero: false });
      }),
    ));
});

describe("a Worker", () => {
  it("is refused every Inventario operation", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker");
        const item = yield* seedItem({ name: "Solo para admins", by: ana });
        const { id } = yield* recordAdjustment({ itemId: item.id, reason: "restock", units: 2 }).pipe(as(ana));

        expect((yield* Effect.flip(listInventory.pipe(as(beto))))._tag).toBe("AdminOnly");
        expect((yield* Effect.flip(listRecentAdjustments().pipe(as(beto))))._tag).toBe("AdminOnly");
        expect(
          (yield* Effect.flip(recordAdjustment({ itemId: item.id, reason: "restock", units: 1 }).pipe(as(beto))))._tag,
        ).toBe("AdminOnly");
        expect((yield* Effect.flip(cancelAdjustment(id, "porque sí").pipe(as(beto))))._tag).toBe("AdminOnly");

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(2);
      }),
    ));
});

describe("adjustmentStanding", () => {
  it("answers the Item's Stock now, and who cancelled the Adjustment and why", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Con ajuste vigente", startingStock: 3, by: ana });
        const { id } = yield* recordAdjustment({ itemId: item.id, reason: "restock", units: 4 }).pipe(as(ana));

        expect(yield* adjustmentStanding(id).pipe(as(ana))).toEqual({ stock: 7, cancellation: null });

        yield* cancelAdjustment(id, " Se contó dos veces ").pipe(as(ana));
        expect(yield* adjustmentStanding(id).pipe(as(ana))).toEqual({
          stock: 3,
          cancellation: { by: ana.id, reason: "Se contó dos veces" },
        });
        expect((yield* Effect.flip(adjustmentStanding("no-existe").pipe(as(ana))))._tag).toBe("AdjustmentNotFound");
      }),
    ));

  it("is refused to a Worker", () =>
    runTest(
      Effect.gen(function* () {
        const beto = yield* seedUser("worker");
        expect((yield* Effect.flip(adjustmentStanding("cualquiera").pipe(as(beto))))._tag).toBe("AdminOnly");
      }),
    ));
});
