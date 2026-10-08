import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, recordSelection, takePayment } from "~/backend/bills";
import { removeLine, removePayment, voidBill } from "~/backend/corrections";
import { myDay } from "~/backend/day";

import { as, seedUser } from "./support/auth";
import { seedItem } from "./support/catalog";
import { advanceClock, runTest, setClock } from "./support/effect";

// Mi día (spec §5.9, §6.1, §7.4, §10.6). Sold is attributed to the author of
// each Line and Collected to the receiver of each Payment; removed Lines and
// Payments and Voided Bills count toward nothing (spec §5.7). Tests in one
// file share a D1: each names its own Items.

describe("Mi día", () => {
  it("shows the signed-in User's own Lines and Payments, Sold by author and Collected by receiver", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T10:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Propio de Mi día", price: 1850, by: ana });
        const at = Date.parse("2026-10-05T10:00:00-06:00");

        // Beto sells one on the spot; Ana leaves two open.
        yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          payment: { method: "cash" },
        }).pipe(as(beto));
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 2 }] }).pipe(as(ana));

        const betoDay = yield* myDay().pipe(as(beto));
        expect(betoDay.day).toBe("2026-10-05");
        expect(betoDay.figures).toEqual({ sold: 1850, cash: 1850, transfer: 0, collected: 1850 });
        expect(betoDay.lines).toMatchObject([
          { itemName: "Propio de Mi día", quantity: 1, unitPrice: 1850, at },
        ]);
        expect(betoDay.payments).toMatchObject([{ amount: 1850, method: "cash", at }]);

        const anaDay = yield* myDay().pipe(as(ana));
        expect(anaDay.figures).toEqual({ sold: 3700, cash: 0, transfer: 0, collected: 0 });
        expect(anaDay.lines).toMatchObject([
          { itemName: "Propio de Mi día", quantity: 2, unitPrice: 1850, at },
        ]);
        expect(anaDay.payments).toEqual([]);
      }),
    ));

  it("splits Collected into cash and transfer, attributed to whoever received it", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-09T09:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const soda = yield* seedItem({ name: "Refresco del cobro", price: 1000 });
        const juice = yield* seedItem({ name: "Jugo del cobro", price: 1500 });
        // Beto leaves a Bill of $35.00 open; Ana receives $10.00 in cash and
        // Beto $25.00 by transfer, both on that same Bill.
        const bill = yield* recordSelection({
          items: [
            { itemId: soda.id, quantity: 2 },
            { itemId: juice.id, quantity: 1 },
          ],
        }).pipe(as(beto));

        const shown = yield* getBill(bill.id).pipe(as(beto));
        yield* takePayment({
          billId: bill.id,
          amount: 1000,
          method: "cash",
          expectedRevision: shown.revision,
        }).pipe(as(ana));
        const after = yield* getBill(bill.id).pipe(as(beto));
        yield* takePayment({
          billId: bill.id,
          amount: 2500,
          method: "transfer",
          expectedRevision: after.revision,
        }).pipe(as(beto));

        const betoDay = yield* myDay().pipe(as(beto));
        expect(betoDay.figures).toEqual({ sold: 3500, cash: 0, transfer: 2500, collected: 2500 });
        expect(betoDay.payments).toMatchObject([{ amount: 2500, method: "transfer" }]);

        const anaDay = yield* myDay().pipe(as(ana));
        expect(anaDay.figures).toEqual({ sold: 0, cash: 1000, transfer: 0, collected: 1000 });
        expect(anaDay.lines).toEqual([]);
        expect(anaDay.payments).toMatchObject([{ amount: 1000, method: "cash" }]);
      }),
    ));

  it("drops a removed Line out of Sold and out of the list", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-06T09:00:00");
        const beto = yield* seedUser("worker", "Beto");
        const kept = yield* seedItem({ name: "Línea que se queda", price: 1000 });
        const gone = yield* seedItem({ name: "Línea que se quita", price: 1500 });
        const bill = yield* recordSelection({
          items: [
            { itemId: kept.id, quantity: 1 },
            { itemId: gone.id, quantity: 1 },
          ],
        }).pipe(as(beto));

        // A Bill with no Payment: any User may remove the Line.
        const before = yield* getBill(bill.id).pipe(as(beto));
        const goneLine = before.lines.find((line) => line.itemId === gone.id)!;
        yield* removeLine({
          billId: bill.id,
          lineId: goneLine.id,
          expectedRevision: before.revision,
        }).pipe(as(beto));

        const day = yield* myDay().pipe(as(beto));
        expect(day.figures.sold).toBe(1000);
        expect(day.lines).toMatchObject([{ itemName: "Línea que se queda" }]);
      }),
    ));

  it("drops a removed Payment out of Collected while its Line still counts", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-07T09:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Pago que se quita", price: 1850 });
        const bill = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          payment: { method: "cash" },
        }).pipe(as(beto));

        const shown = yield* getBill(bill.id).pipe(as(ana));
        yield* removePayment({
          billId: bill.id,
          paymentId: shown.payments[0]!.id,
          reason: "Se cobró por error",
          expectedRevision: shown.revision,
        }).pipe(as(ana));

        const day = yield* myDay().pipe(as(beto));
        expect(day.figures).toEqual({ sold: 1850, cash: 0, transfer: 0, collected: 0 });
        expect(day.payments).toEqual([]);
        expect(day.lines).toMatchObject([{ itemName: "Pago que se quita" }]);
      }),
    ));

  it("drops a Voided Bill out of Sold, Collected and both lists", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-08T09:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Cuenta cancelada del día", price: 2000 });
        const bill = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          payment: { method: "transfer" },
        }).pipe(as(beto));

        const shown = yield* getBill(bill.id).pipe(as(ana));
        yield* voidBill({ billId: bill.id, reason: "Era una prueba", expectedRevision: shown.revision }).pipe(
          as(ana),
        );

        const day = yield* myDay().pipe(as(beto));
        expect(day.figures).toEqual({ sold: 0, cash: 0, transfer: 0, collected: 0 });
        expect(day.lines).toEqual([]);
        expect(day.payments).toEqual([]);
      }),
    ));

  it("keeps each Day's records apart across midnight in America/Mexico_City", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-12-31T23:59:00");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Cruzando la medianoche", price: 1000 });
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(beto));
        const lastDay = yield* myDay().pipe(as(beto));

        // Two minutes later it is the next Day, and a Line added to the same
        // Bill belongs to the Day it is added (spec §5.4).
        yield* advanceClock("2 minutes");
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 2 }], billId: bill.id }).pipe(as(beto));
        const newDay = yield* myDay().pipe(as(beto));

        expect(lastDay.day).toBe("2026-12-31");
        expect(lastDay.figures.sold).toBe(1000);
        expect(lastDay.lines).toMatchObject([{ quantity: 1 }]);
        expect(newDay.day).toBe("2027-01-01");
        expect(newDay.figures.sold).toBe(2000);
        expect(newDay.lines).toMatchObject([{ quantity: 2 }]);
      }),
    ));
});
