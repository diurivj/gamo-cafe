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
      expect(betos.openBills).toEqual({ count: 1, owed: 3600 });
      expect(betos.mine).toEqual({ sold: 2500, cash: 2500, transfer: 0, collected: 2500 });
      expect(betos.everyone).toBeNull();
      expect(betos.toRestock).toBeNull();

      const anas = yield* homeSummary.pipe(as(ana));
      expect(anas.openBills).toEqual({ count: 1, owed: 3600 });
      expect(anas.mine).toEqual({ sold: 5400, cash: 0, transfer: 1800, collected: 1800 });
      expect(anas.everyone).toEqual({ sold: 7900, cash: 2500, transfer: 1800, collected: 4300 });
      // Only the Item at or under its Minimum.
      expect(anas.toRestock).toBe(1);
    }),
  ));
