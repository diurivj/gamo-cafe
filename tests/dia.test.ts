import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, recordSelection, takePayment } from "~/backend/bills";
import { removeLine, removePayment, voidBill } from "~/backend/corrections";
import { everyonesDay } from "~/backend/day";
import { Db } from "~/backend/db";

import { as, seedUser } from "./support/auth";
import { seedItem } from "./support/catalog";
import { countingD1 } from "./support/d1";
import { advanceClock, runTest, setClock } from "./support/effect";

// Día (spec §5.9, §6.2, §7.4, §10.6): Sold, Collected in cash and by transfer,
// the same per User, and Items sold with quantities and value, over the Days
// that were asked for. `everyonesDay` is the whole read: it decides the range
// from the text it is handed and answers with it. Tests in one file share a
// D1: each names its own Items and its own Days.

/** Día for one Day, or for a range of them. */
const read = (from: string, to: string = from) => everyonesDay({ from, to });

describe("The range Día reads", () => {
  it("is today when nothing is asked", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2028-01-10T23:30:00");
        const ana = yield* seedUser("admin", "Ana");
        const item = yield* seedItem({ name: "Producto de hoy", price: 1000, by: ana });
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));

        for (const asked of [{}, { from: null, to: null }, { from: "", to: "  " }]) {
          const day = yield* everyonesDay(asked).pipe(as(ana));
          expect(day.range).toEqual({ from: "2028-01-10", to: "2028-01-10" });
          expect(day.total.sold).toBe(1000);
        }

        // Half an hour later it is the next Day in Mexico City, and nothing is in it.
        yield* advanceClock("30 minutes");
        const next = yield* everyonesDay({}).pipe(as(ana));
        expect(next.range).toEqual({ from: "2028-01-11", to: "2028-01-11" });
        expect(next.total.sold).toBe(0);
      }),
    ));

  it("is a single Day when only one end is asked, never a range up to today", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2028-02-01T10:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const item = yield* seedItem({ name: "Producto de un solo extremo", price: 1000, by: ana });
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        yield* advanceClock("1 day");
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 2 }] }).pipe(as(ana));
        yield* advanceClock("1 day");

        const first = yield* everyonesDay({ from: "2028-02-01" }).pipe(as(ana));
        expect(first.range).toEqual({ from: "2028-02-01", to: "2028-02-01" });
        expect(first.total.sold).toBe(1000);

        const last = yield* everyonesDay({ from: "", to: " 2028-02-02 " }).pipe(as(ana));
        expect(last.range).toEqual({ from: "2028-02-02", to: "2028-02-02" });
        expect(last.total.sold).toBe(2000);
      }),
    ));

  it("refuses an end that is written and is not a Day, and reads nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana");
        const refusal = (asked: Parameters<typeof everyonesDay>[0]) =>
          Effect.promise(() => {
            const { counter, d1 } = countingD1(env.DB);
            return Effect.runPromise(
              Effect.flip(everyonesDay(asked)).pipe(as(ana), Effect.provide(Db.layer(d1))),
            ).then((error) => ({ error, statements: counter.statements }));
          });

        // Not a date at all; the other end is kept as it was read.
        expect(yield* refusal({ from: "ayer", to: "2028-03-02" })).toMatchObject({
          error: { _tag: "DayUnreadable", field: "from", from: null, to: "2028-03-02" },
          statements: 0,
        });
        // A date the calendar does not have, which `Date` would roll over.
        expect(yield* refusal({ from: "2028-03-01", to: "2027-02-31" })).toMatchObject({
          error: { _tag: "DayUnreadable", field: "to", from: "2028-03-01", to: null },
          statements: 0,
        });
        // Alone, it is not read as today.
        expect(yield* refusal({ to: "2028-13-40" })).toMatchObject({
          error: { _tag: "DayUnreadable", field: "to", from: null, to: null },
        });
        // Neither: the first one is named.
        expect(yield* refusal({ from: "ayer", to: "hoy" })).toMatchObject({
          error: { _tag: "DayUnreadable", field: "from", from: null, to: null },
        });
      }),
    ));

  it("refuses a range that ends before it starts, and reads nothing", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin", "Ana");
        const { counter, d1 } = countingD1(env.DB);
        const error = yield* Effect.promise(() =>
          Effect.runPromise(Effect.flip(read("2028-03-02", "2028-03-01")).pipe(as(ana), Effect.provide(Db.layer(d1)))),
        );

        expect(error).toMatchObject({ _tag: "RangeEndsBeforeItStarts", from: "2028-03-02", to: "2028-03-01" });
        expect(counter.statements).toBe(0);
      }),
    ));

  it("refuses a Worker whatever was asked", () =>
    runTest(
      Effect.gen(function* () {
        const beto = yield* seedUser("worker", "Beto");

        for (const asked of [{}, { from: "2028-03-01" }, { from: "ayer" }, { from: "2028-03-02", to: "2028-03-01" }]) {
          const refused = yield* Effect.flip(everyonesDay(asked).pipe(as(beto)));
          expect(refused._tag).toBe("AdminOnly");
        }
      }),
    ));
});

describe("Día", () => {
  it("gives each Item's quantity and value over a range of Days", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T10:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const agua = yield* seedItem({ name: "Agua de los productos", price: 1850, by: ana });
        const pan = yield* seedItem({ name: "Pan de los productos", price: 1200, by: ana });

        yield* recordSelection({
          items: [
            { itemId: agua.id, quantity: 2 },
            { itemId: pan.id, quantity: 1 },
          ],
        }).pipe(as(ana));
        yield* advanceClock("1 day");
        yield* recordSelection({ items: [{ itemId: agua.id, quantity: 1 }] }).pipe(as(beto));

        // The whole range: quantities and values add up, the most valuable
        // Item first.
        const both = yield* read("2026-10-05", "2026-10-06").pipe(as(ana));
        expect(both.range).toEqual({ from: "2026-10-05", to: "2026-10-06" });
        expect(both.items).toEqual([
          { itemId: agua.id, itemName: "Agua de los productos", quantity: 3, sold: 5550 },
          { itemId: pan.id, itemName: "Pan de los productos", quantity: 1, sold: 1200 },
        ]);

        // One Day of the range only.
        const first = yield* read("2026-10-05").pipe(as(ana));
        expect(first.items).toEqual([
          { itemId: agua.id, itemName: "Agua de los productos", quantity: 2, sold: 3700 },
          { itemId: pan.id, itemName: "Pan de los productos", quantity: 1, sold: 1200 },
        ]);
      }),
    ));

  it("leaves out a removed Line and a Voided Bill, and a correction changes the Day it touched", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-10T10:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const kept = yield* seedItem({ name: "Producto que se queda", price: 1000, by: ana });
        const gone = yield* seedItem({ name: "Producto que se quita", price: 1500, by: ana });
        const voided = yield* seedItem({ name: "Producto cancelado", price: 2000, by: ana });
        const bill = yield* recordSelection({
          items: [
            { itemId: kept.id, quantity: 1 },
            { itemId: gone.id, quantity: 1 },
          ],
        }).pipe(as(beto));
        const cancelled = yield* recordSelection({
          items: [{ itemId: voided.id, quantity: 1 }],
          payment: { method: "cash" },
        }).pipe(as(beto));
        const paid = yield* seedItem({ name: "Producto con pago quitado", price: 500, by: ana });
        const refunded = yield* recordSelection({
          items: [{ itemId: paid.id, quantity: 1 }],
          payment: { method: "transfer" },
        }).pipe(as(beto));

        // The next Day the correction is made, but it changes the figures of
        // the Day the Line and the Payment were recorded (spec §5.7).
        yield* advanceClock("1 day");
        const shown = yield* getBill(bill.id).pipe(as(beto));
        const goneLine = shown.lines.find((line) => line.itemId === gone.id)!;
        yield* removeLine({ billId: bill.id, lineId: goneLine.id, expectedRevision: shown.revision }).pipe(
          as(beto),
        );
        const cancelShown = yield* getBill(cancelled.id).pipe(as(ana));
        yield* voidBill({
          billId: cancelled.id,
          reason: "Era una prueba",
          expectedRevision: cancelShown.revision,
        }).pipe(as(ana));
        const refundShown = yield* getBill(refunded.id).pipe(as(ana));
        yield* removePayment({
          billId: refunded.id,
          paymentId: refundShown.payments[0]!.id,
          reason: "Se cobró por error",
          expectedRevision: refundShown.revision,
        }).pipe(as(ana));

        const correctedDay = yield* read("2026-10-10").pipe(as(ana));
        // The Voided Bill's Line leaves Sold; the removed Payment leaves
        // Collected at nothing while its Bill's Line still counts (spec §5.7).
        expect(correctedDay.total).toEqual({ sold: 1500, cash: 0, transfer: 0, collected: 0 });
        expect(correctedDay.byUser).toEqual([
          { userId: beto.id, userName: "Beto", sold: 1500, cash: 0, transfer: 0, collected: 0 },
        ]);
        expect(correctedDay.items).toEqual([
          { itemId: kept.id, itemName: "Producto que se queda", quantity: 1, sold: 1000 },
          { itemId: paid.id, itemName: "Producto con pago quitado", quantity: 1, sold: 500 },
        ]);

        // The Day the correction was made stays empty.
        const correctionDay = yield* read("2026-10-11").pipe(as(ana));
        expect(correctionDay.total).toEqual({ sold: 0, cash: 0, transfer: 0, collected: 0 });
        expect(correctionDay.byUser).toEqual([]);
        expect(correctionDay.items).toEqual([]);
      }),
    ));

  it("matches §5.9 across midnight in America/Mexico_City, per User", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-20T23:59:59.999");
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Producto de la medianoche", price: 1000, by: ana });

        yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          payment: { method: "cash" },
        }).pipe(as(beto));
        // A millisecond later it is the next Day, in Mexico City too.
        yield* advanceClock("1 milli");
        yield* recordSelection({
          items: [{ itemId: item.id, quantity: 2 }],
          payment: { method: "transfer" },
        }).pipe(as(ana));

        const lastDay = yield* read("2026-10-20").pipe(as(ana));
        expect(lastDay.total).toEqual({ sold: 1000, cash: 1000, transfer: 0, collected: 1000 });
        expect(lastDay.byUser).toEqual([
          { userId: beto.id, userName: "Beto", sold: 1000, cash: 1000, transfer: 0, collected: 1000 },
        ]);
        expect(lastDay.items).toEqual([
          { itemId: item.id, itemName: "Producto de la medianoche", quantity: 1, sold: 1000 },
        ]);

        const newDay = yield* read("2026-10-21").pipe(as(ana));
        expect(newDay.total).toEqual({ sold: 2000, cash: 0, transfer: 2000, collected: 2000 });
        expect(newDay.byUser).toEqual([
          { userId: ana.id, userName: "Ana", sold: 2000, cash: 0, transfer: 2000, collected: 2000 },
        ]);
        expect(newDay.items).toEqual([
          { itemId: item.id, itemName: "Producto de la medianoche", quantity: 2, sold: 2000 },
        ]);

        // Both Days together, each User apart, in name order.
        const across = yield* read("2026-10-20", "2026-10-21").pipe(as(ana));
        expect(across.total).toEqual({ sold: 3000, cash: 1000, transfer: 2000, collected: 3000 });
        expect(across.byUser).toEqual([
          { userId: ana.id, userName: "Ana", sold: 2000, cash: 0, transfer: 2000, collected: 2000 },
          { userId: beto.id, userName: "Beto", sold: 1000, cash: 1000, transfer: 0, collected: 1000 },
        ]);
      }),
    ));

  it("counts a Line added today toward today, whatever the Day of its Bill", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-11-01T22:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Producto de la cuenta de ayer", price: 1000, by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(beto));

        yield* advanceClock("3 hours");
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 2 }], billId: bill.id }).pipe(as(beto));

        const yesterday = yield* read("2026-11-01").pipe(as(ana));
        expect(yesterday.total.sold).toBe(1000);
        expect(yesterday.items).toEqual([
          { itemId: item.id, itemName: "Producto de la cuenta de ayer", quantity: 1, sold: 1000 },
        ]);

        const today = yield* read("2026-11-02").pipe(as(ana));
        expect(today.total.sold).toBe(2000);
        expect(today.items).toEqual([
          { itemId: item.id, itemName: "Producto de la cuenta de ayer", quantity: 2, sold: 2000 },
        ]);
      }),
    ));

  it("counts money received today for an older Day's Bill as today's Collected, not today's Sold", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-11-10T10:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Producto fiado", price: 3000, by: ana });
        // Beto leaves $30.00 open; nobody pays that Day.
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(beto));

        // The next Day Ana receives $10.00 in cash and $20.00 by transfer for it.
        yield* advanceClock("1 day");
        const shown = yield* getBill(bill.id).pipe(as(ana));
        yield* takePayment({ billId: bill.id, amount: 1000, method: "cash", expectedRevision: shown.revision }).pipe(
          as(ana),
        );
        const after = yield* getBill(bill.id).pipe(as(ana));
        yield* takePayment({
          billId: bill.id,
          amount: 2000,
          method: "transfer",
          expectedRevision: after.revision,
        }).pipe(as(ana));

        // The Day of the consumption: Sold, to its author, and nothing Collected.
        const consumed = yield* read("2026-11-10").pipe(as(ana));
        expect(consumed.total).toEqual({ sold: 3000, cash: 0, transfer: 0, collected: 0 });
        expect(consumed.byUser).toEqual([
          { userId: beto.id, userName: "Beto", sold: 3000, cash: 0, transfer: 0, collected: 0 },
        ]);

        // The Day of the money: Collected, to whoever received it, and nothing Sold.
        const paid = yield* everyonesDay({}).pipe(as(ana));
        expect(paid.range).toEqual({ from: "2026-11-11", to: "2026-11-11" });
        expect(paid.total).toEqual({ sold: 0, cash: 1000, transfer: 2000, collected: 3000 });
        expect(paid.byUser).toEqual([
          { userId: ana.id, userName: "Ana", sold: 0, cash: 1000, transfer: 2000, collected: 3000 },
        ]);
        expect(paid.items).toEqual([]);
      }),
    ));
});

describe("Día's read", () => {
  it("issues three statements over the range asked for, never over the history", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2027-05-05T10:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const db = yield* Db;
        const item = yield* seedItem({ name: "Presupuesto del Día", price: 1000, by: ana });
        for (let n = 0; n < 8; n++) {
          yield* recordSelection({
            items: [{ itemId: item.id, quantity: 1 }],
            payment: { method: n % 2 === 0 ? "cash" : "transfer" },
          }).pipe(as(ana));
        }

        const measure = (from: string, to: string) => {
          const { counter, d1 } = countingD1(env.DB);
          return Effect.runPromise(read(from, to).pipe(as(ana), Effect.provide(Db.layer(d1)))).then((day) => ({
            ...counter,
            ...day,
          }));
        };

        const asked = yield* Effect.promise(() => measure("2027-05-05", "2027-05-05"));
        expect(asked.statements).toBe(3);
        expect(asked.total).toEqual({ sold: 8000, cash: 4000, transfer: 4000, collected: 8000 });
        expect(asked.items).toEqual([
          { itemId: item.id, itemName: "Presupuesto del Día", quantity: 8, sold: 8000 },
        ]);

        // Three hundred Lines and Payments on a Day outside the range, forty
        // of those Lines removed and twenty Payments removed. None of it may
        // reach the Day asked for (spec §2.4, §7.4): a scan of a correction
        // table would show here first.
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 300)
           INSERT INTO bills (id, day, opened_by, opened_at, total, paid, state, revision)
           SELECT 'old-bill-' || x, '2027-04-01', ?, 1000 + x, 1000, 500, 'partial', 0 FROM n`,
          ana.id,
        );
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 300)
           INSERT INTO lines (id, bill_id, item_id, quantity, unit_price, moved_stock, added_by, added_at, day)
           SELECT 'old-line-' || x, 'old-bill-' || x, ?, 1, 1000, 0, ?, 1000 + x, '2027-04-01' FROM n`,
          item.id,
          ana.id,
        );
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 300)
           INSERT INTO payments (id, bill_id, amount, method, handover_reference, received_by, received_at, day)
           SELECT 'old-payment-' || x, 'old-bill-' || x, 500,
                  CASE WHEN x % 2 = 0 THEN 'cash' ELSE 'transfer' END, NULL, ?, 1000 + x, '2027-04-01' FROM n`,
          ana.id,
        );
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 40)
           INSERT INTO line_removals (id, line_id, reason, removed_by, removed_at)
           SELECT 'old-removal-' || x, 'old-line-' || x, 'Merma', ?, 2000 + x FROM n`,
          ana.id,
        );
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 20)
           INSERT INTO payment_removals (id, payment_id, reason, removed_by, removed_at)
           SELECT 'old-refund-' || x, 'old-payment-' || x, 'Se cobró por error', ?, 2000 + x FROM n`,
          ana.id,
        );

        const grown = yield* Effect.promise(() => measure("2027-05-05", "2027-05-05"));
        expect(grown.statements).toBe(3);
        expect(grown.total).toEqual(asked.total);
        expect(grown.byUser).toEqual(asked.byUser);
        expect(grown.items).toEqual(asked.items);
        expect(grown.rowsRead).toBeLessThanOrEqual(asked.rowsRead + 4);

        // The cost follows the range, not the calendar: the wide range does
        // read those rows, and the removed ones stay out of the figures.
        const wide = yield* Effect.promise(() => measure("2027-04-01", "2027-05-05"));
        expect(wide.total).toEqual({ sold: 268000, cash: 74000, transfer: 74000, collected: 148000 });
        expect(wide.items).toEqual([
          { itemId: item.id, itemName: "Presupuesto del Día", quantity: 268, sold: 268000 },
        ]);
        expect(wide.rowsRead).toBeGreaterThan(grown.rowsRead + 300);
      }),
    ));
});
