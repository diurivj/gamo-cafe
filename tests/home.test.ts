import { Effect } from "effect";
import { expect, it } from "vitest";

import { recordSelection } from "~/backend/bills";
import { homeSummary } from "~/backend/home";

import { as, seedUser } from "./support/auth";
import { seedItem } from "./support/catalog";
import { runTest, setClock } from "./support/effect";

// Inicio (UI redesign §4): what the home screen's cards say. A Worker's cards
// hold their own figures and the Open Bills; the Day's figures of everyone
// and Stock are an Admin's (spec §4.1, §4.2), and are not read for a Worker.
// The first test runs on the file's empty database: no Item has been added yet.

it("tells an Admin when there is nothing to sell yet, and stops once an Item is active", () =>
  runTest(
    Effect.gen(function* () {
      yield* setClock("2026-10-05T10:00:00");
      const ana = yield* seedUser("admin", "Ana Empieza");
      const beto = yield* seedUser("worker", "Beto Empieza");

      expect((yield* homeSummary.pipe(as(ana))).menuIsEmpty).toBe(true);
      // A Worker cannot add one, and is not told.
      expect((yield* homeSummary.pipe(as(beto))).menuIsEmpty).toBeNull();
      yield* seedItem({ name: "Primero del menú", price: 1500, by: ana });
      expect((yield* homeSummary.pipe(as(ana))).menuIsEmpty).toBe(false);
    }),
  ));

it("gives a Worker their own figures and the Open Bills, and an Admin the Day and what to restock", () =>
  runTest(
    Effect.gen(function* () {
      yield* setClock("2026-10-05T10:00:00");
      const ana = yield* seedUser("admin", "Ana Inicio");
      const beto = yield* seedUser("worker", "Beto Inicio");
      const low = yield* seedItem({ name: "Poco de Inicio", price: 2500, minimum: 5, startingStock: 3, by: ana });
      const enough = yield* seedItem({ name: "Mucho de Inicio", price: 1800, minimum: 2, startingStock: 10, by: ana });

      // Beto sells one for cash; Ana leaves two open and sells one by transfer.
      yield* recordSelection({ items: [{ itemId: low.id, quantity: 1 }], payment: { method: "cash" } }).pipe(as(beto));
      yield* recordSelection({ items: [{ itemId: enough.id, quantity: 2 }] }).pipe(as(ana));
      yield* recordSelection({ items: [{ itemId: enough.id, quantity: 1 }], payment: { method: "transfer" } }).pipe(
        as(ana),
      );

      const betos = yield* homeSummary.pipe(as(beto));
      // The Day the figures are about comes with them.
      expect(betos.day).toBe("2026-10-05");
      expect(betos.openBills).toEqual({ count: 1, owed: 3600 });
      expect(betos.mine).toEqual({ sold: 2500, cash: 2500, transfer: 0, collected: 2500 });
      expect(betos.everyone).toBeNull();
      expect(betos.toRestock).toBeNull();
      expect(betos.menuIsEmpty).toBeNull();

      const anas = yield* homeSummary.pipe(as(ana));
      expect(anas.day).toBe("2026-10-05");
      expect(anas.openBills).toEqual({ count: 1, owed: 3600 });
      expect(anas.mine).toEqual({ sold: 5400, cash: 0, transfer: 1800, collected: 1800 });
      expect(anas.everyone).toEqual({ sold: 7900, cash: 2500, transfer: 1800, collected: 4300 });
      // Only the Item at or under its Minimum.
      expect(anas.toRestock).toBe(1);
      expect(anas.menuIsEmpty).toBe(false);
    }),
  ));
