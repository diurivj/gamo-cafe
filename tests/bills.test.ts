import { env } from "cloudflare:workers";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, recordSelection } from "~/backend/bills";
import { addItem, retireItem, updateItem } from "~/backend/catalog";
import { Db } from "~/backend/db";
import { stockOf } from "~/backend/stock";

import { as, seedUser } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { seedCustomer } from "./support/customers";
import { countingD1 } from "./support/d1";
import { advanceClock, runTest, setClock } from "./support/effect";

// "Record a selection" (spec §7.3.1). Tests in one file share a D1, and
// active Item names are unique, so each test names its own.

describe("recording a selection", () => {
  it("records one Bill with one Line per distinct Item, with its author, instant and Day", () =>
    runTest(
      Effect.gen(function* () {
        // Late evening in Mexico City: already the 6th in UTC.
        yield* setClock("2026-10-05T22:30:00");
        const ana = yield* seedUser("admin");
        const agua = yield* seedItem({ name: "Agua de horchata", price: 1850, startingStock: 5, by: ana });
        const cafe = yield* seedItem({ name: "Café de olla", price: 2500, by: ana });
        const at = Date.parse("2026-10-05T22:30:00-06:00");

        const bill = yield* recordSelection({
          items: [
            { itemId: agua.id, quantity: 2 },
            { itemId: cafe.id, quantity: 1 },
          ],
        }).pipe(as(ana));

        expect(bill).toEqual({
          id: expect.any(String),
          day: "2026-10-05",
          openedBy: ana.id,
          openedAt: at,
          customer: null,
          note: null,
          total: 6200,
          paid: 0,
          owed: 6200,
          state: "open",
          revision: 0,
        });
        expect(yield* getBill(bill.id).pipe(as(ana))).toEqual({
          ...bill,
          lines: [
            {
              id: expect.any(String),
              itemId: agua.id,
              itemName: "Agua de horchata",
              quantity: 2,
              unitPrice: 1850,
              by: ana.id,
              byName: "Ana",
              at,
              day: "2026-10-05",
              removal: null,
            },
            {
              id: expect.any(String),
              itemId: cafe.id,
              itemName: "Café de olla",
              quantity: 1,
              unitPrice: 2500,
              by: ana.id,
              byName: "Ana",
              at,
              day: "2026-10-05",
              removal: null,
            },
          ],
          payments: [],
          voided: null,
        });
      }),
    ));

  it("merges the same Item sent more than once into one Line of both quantities", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Pan de elote", price: 900, by: ana });

        const bill = yield* recordSelection({
          items: [
            { itemId: item.id, quantity: 1 },
            { itemId: item.id, quantity: 2 },
          ],
        }).pipe(as(ana));

        expect((yield* getBill(bill.id).pipe(as(ana))).lines).toMatchObject([{ itemId: item.id, quantity: 3, unitPrice: 900 }]);
        expect(bill.total).toBe(2700);
      }),
    ));

  it("keeps the price a Line was added at, whatever the Item's price does later", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Concha", price: 1000, by: ana });

        const first = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        yield* updateItem(item.id, {
          name: item.name,
          price: 1500,
          categoryId: item.categoryId,
          stockTracked: true,
          minimum: null,
        }).pipe(as(ana));

        expect((yield* getBill(first.id).pipe(as(ana))).lines).toMatchObject([{ itemId: item.id, unitPrice: 1000 }]);
        expect((yield* getBill(first.id).pipe(as(ana))).total).toBe(1000);

        // The next Line takes the new price, on the same Bill.
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 2 }], billId: first.id }).pipe(as(ana));

        expect((yield* getBill(first.id).pipe(as(ana))).lines).toMatchObject([
          { itemId: item.id, quantity: 1, unitPrice: 1000 },
          { itemId: item.id, quantity: 2, unitPrice: 1500 },
        ]);
        expect((yield* getBill(first.id).pipe(as(ana))).total).toBe(4000);
      }),
    ));

  it("refuses a retired Item", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Tostada retirada", price: 1200, by: ana });
        yield* retireItem(item.id).pipe(as(ana));

        const error = yield* Effect.flip(
          recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana)),
        );

        expect(error._tag).toBe("ItemUnavailable");
      }),
    ));

  it("refuses a Customer that is retired", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Flan de prueba", price: 1500, by: ana });
        const gone = yield* seedCustomer("Cliente retirado", { by: ana, retired: true });

        const error = yield* Effect.flip(
          recordSelection({ items: [{ itemId: item.id, quantity: 1 }], customerId: gone.id }).pipe(as(ana)),
        );

        expect(error._tag).toBe("CustomerUnavailable");
      }),
    ));
});

describe("where the Lines go", () => {
  it("leaves a Bill with no Customer open with its note, starts a new one next time, and adds to a given Bill", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Sandía", price: 1000, by: ana });

        const first = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], note: " Para Leo " }).pipe(
          as(ana),
        );
        expect(first).toMatchObject({ customer: null, note: "Para Leo", state: "open" });

        // No Customer and no target Bill: a new Bill every time (spec §5.3).
        const another = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        expect(another.id).not.toBe(first.id);

        // A given Open Bill is used, whatever the Customer rules would say.
        const targeted = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], billId: first.id }).pipe(
          as(ana),
        );
        expect(targeted.id).toBe(first.id);
        expect(targeted.revision).toBe(1);
        expect((yield* getBill(first.id).pipe(as(ana))).total).toBe(2000);
      }),
    ));

  it("sends a Customer's selections of one Day to one Bill while it is Open, and to a new Bill on a later Day", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T22:30:00");
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Bolillo", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia del pan", { by: ana });

        const first = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));
        const second = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));

        expect(second.id).toBe(first.id);
        expect(second.customer).toEqual({ id: ruiz.id, name: "Familia del pan" });
        expect(second.total).toBe(2000);

        // Midnight in Mexico City: the 6th is a different Day for the Bill.
        yield* advanceClock("2 hours");
        const third = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));

        expect(third.day).toBe("2026-10-06");
        expect(third.id).not.toBe(first.id);
        expect(third.total).toBe(1000);
        expect((yield* getBill(first.id).pipe(as(ana))).lines).toHaveLength(2);
      }),
    ));

  it("records Lines on a later Day than the Bill they are added to", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Churro", price: 800, by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));

        yield* advanceClock("24 hours");
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], billId: bill.id }).pipe(as(ana));

        const lines = (yield* getBill(bill.id).pipe(as(ana))).lines;
        expect(lines.map((line) => line.day)).toEqual(["2026-10-05", "2026-10-06"]);
      }),
    ));
});

describe("Stock", () => {
  it("sells an Item whose Stock is zero, leaves it below zero, and leaves a non-stock-tracked Item alone", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const vacio = yield* seedItem({ name: "Sin existencias", price: 1000, by: ana });
        const casi = yield* seedItem({ name: "Casi agotado", price: 1000, startingStock: 2, by: ana });
        const preparado = yield* seedItem({ name: "Preparado al momento", price: 3000, stockTracked: false, by: ana });

        const bill = yield* recordSelection({
          items: [
            { itemId: vacio.id, quantity: 3 },
            { itemId: casi.id, quantity: 5 },
            { itemId: preparado.id, quantity: 2 },
          ],
        }).pipe(as(ana));

        expect(yield* stockOf(vacio.id).pipe(as(ana))).toBe(-3);
        expect(yield* stockOf(casi.id).pipe(as(ana))).toBe(-3);
        expect(yield* stockOf(preparado.id).pipe(as(ana))).toBe(0);

        // The fact about each Line that rebuilding Stock (ticket 19) reads.
        const db = yield* Db;
        expect(
          yield* db.all(
            Schema.Struct({ itemId: Schema.String, movedStock: Schema.Int }),
            "SELECT item_id AS itemId, moved_stock AS movedStock FROM lines WHERE bill_id = ? ORDER BY rowid",
            bill.id,
          ),
        ).toMatchObject([
          { itemId: vacio.id, movedStock: 1 },
          { itemId: casi.id, movedStock: 1 },
          { itemId: preparado.id, movedStock: 0 },
        ]);
      }),
    ));

  it("moves Stock by the quantity of every Line, relative to what it was", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Café de filtro", price: 1000, startingStock: 10, by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 4 }] }).pipe(as(ana));

        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(6);

        // A second phone adds to the same Bill at another moment.
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 3 }], billId: bill.id }).pipe(as(ana));
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(3);
      }),
    ));
});

describe("validation and a target Bill", () => {
  it("refuses an empty selection, a fractional or zero quantity, a long note and an unknown Item", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Validado", price: 1000, by: ana });

        const cases = [
          [{ items: [] }, "EmptySelection"],
          [{ items: [{ itemId: item.id, quantity: 0 }] }, "InvalidQuantity"],
          [{ items: [{ itemId: item.id, quantity: 1.5 }] }, "InvalidQuantity"],
          [{ items: [{ itemId: item.id, quantity: 1 }], note: "x".repeat(81) }, "NoteTooLong"],
          [{ items: [{ itemId: "nope", quantity: 1 }] }, "ItemUnavailable"],
        ] as const;
        for (const [input, tag] of cases) {
          expect((yield* Effect.flip(recordSelection(input).pipe(as(ana))))._tag, tag).toBe(tag);
        }

        // 80 characters are exactly a note.
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], note: "x".repeat(80) }).pipe(
          as(ana),
        );
        expect((yield* getBill(bill.id).pipe(as(ana))).note).toHaveLength(80);
      }),
    ));

  it("refuses a target Bill that does not exist, is not Open, or comes with a Customer or a note", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Para la cuenta", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia de la cuenta", { by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        const add = { items: [{ itemId: item.id, quantity: 1 }] };

        expect((yield* Effect.flip(recordSelection({ ...add, billId: "nope" }).pipe(as(ana))))._tag).toBe("BillNotFound");
        expect((yield* Effect.flip(recordSelection({ ...add, billId: bill.id, note: "otra" }).pipe(as(ana))))._tag).toBe(
          "TargetConflict",
        );
        expect(
          (yield* Effect.flip(recordSelection({ ...add, billId: bill.id, customerId: ruiz.id }).pipe(as(ana))))._tag,
        ).toBe("TargetConflict");

        // A Payment (ticket 08) is what makes a Bill Paid; this stands in for
        // its projection update.
        const db = yield* Db;
        yield* db.run("UPDATE bills SET paid = total, state = 'paid' WHERE id = ?", bill.id);

        const error = yield* Effect.flip(recordSelection({ ...add, billId: bill.id }).pipe(as(ana)));
        expect(error._tag).toBe("BillNotOpen");
        expect((yield* getBill(bill.id).pipe(as(ana))).lines).toHaveLength(1);
      }),
    ));

  it("answers BillNotFound from getBill for a Bill that does not exist", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        expect((yield* Effect.flip(getBill("nope").pipe(as(ana))))._tag).toBe("BillNotFound");
      }),
    ));
});

describe("two phones at once", () => {
  it("records both additions to the same Bill and the total reflects both", async () => {
    const seeded = await runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker");
        const item = yield* seedItem({ name: "Dos teléfonos", price: 1500, startingStock: 2, by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        return { ana, beto, item, bill };
      }),
    );

    const addition = (user: typeof seeded.ana) =>
      runTest(
        recordSelection({ items: [{ itemId: seeded.item.id, quantity: 1 }], billId: seeded.bill.id }).pipe(as(user)),
      );

    const [first, second] = await Promise.all([addition(seeded.ana), addition(seeded.beto)]);

    expect([first.id, second.id]).toEqual([seeded.bill.id, seeded.bill.id]);
    const bill = await runTest(getBill(seeded.bill.id).pipe(as(seeded.ana)));
    expect(bill.total).toBe(4500);
    expect(bill.lines.map((line) => line.by).sort()).toEqual([seeded.ana.id, seeded.ana.id, seeded.beto.id].sort());
    expect(await runTest(stockOf(seeded.item.id).pipe(as(seeded.ana)))).toBe(-1);
  });
});

describe("Cobrar on Vender", () => {
  it("records the selection and a Payment together, each carrying the signed-in User", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T18:00:00");
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Cobrado al momento", price: 1850, startingStock: 5, by: ana });

        const bill = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 2 }],
          payment: { method: "cash" },
        }).pipe(as(beto));

        const at = Date.parse("2026-10-05T18:00:00-06:00");
        expect(bill).toMatchObject({ total: 3700, paid: 3700, owed: 0, state: "paid", revision: 1 });
        // Its author reads it as an Admin would: a Worker no longer opens a
        // Paid Bill (§4.1).
        expect(yield* getBill(bill.id).pipe(as(ana))).toMatchObject({
          lines: [{ itemId: item.id, quantity: 2, unitPrice: 1850, by: beto.id, byName: "Beto", day: "2026-10-05" }],
          payments: [
            { amount: 3700, method: "cash", by: beto.id, byName: "Beto", at, day: "2026-10-05" },
          ],
        });
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(3);
      }),
    ));

  it("takes an amount lower than the total and leaves the Bill Pago parcial", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Abonado al momento", price: 1000, by: ana });

        const bill = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 2 }],
          payment: { method: "transfer", amount: 800 },
        }).pipe(as(ana));

        expect(bill).toMatchObject({ total: 2000, paid: 800, owed: 1200, state: "partial" });
        expect((yield* getBill(bill.id).pipe(as(ana))).payments).toMatchObject([{ amount: 800, method: "transfer" }]);
      }),
    ));

  it("refuses a Payment of zero or larger than what the Bill owes, and writes nothing at all", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Pago inválido al vender", price: 1000, startingStock: 5, by: ana });
        const db = yield* Db;
        const tables = `SELECT (SELECT COUNT(*) FROM bills) AS bills,
                               (SELECT COUNT(*) FROM lines) AS lines,
                               (SELECT COUNT(*) FROM payments) AS payments`;
        const before = yield* db.first(Schema.Struct({ bills: Schema.Int, lines: Schema.Int, payments: Schema.Int }), tables);

        const attempts = [
          [0, "PaymentNotPositive"],
          [1.5, "PaymentNotPositive"],
          [1001, "PaymentExceedsOwed"],
        ] as const;
        for (const [amount, tag] of attempts) {
          const error = yield* Effect.flip(
            recordSelection({ items: [{ itemId: item.id, quantity: 1 }], payment: { method: "cash", amount } }).pipe(
              as(ana),
            ),
          );
          expect(error._tag, String(amount)).toBe(tag);
        }

        // All or nothing: no Bill, no Line and no Stock move from a refused sale.
        const after = yield* db.first(Schema.Struct({ bills: Schema.Int, lines: Schema.Int, payments: Schema.Int }), tables);
        expect(after).toEqual(before);
        expect(yield* stockOf(item.id).pipe(as(ana))).toBe(5);
      }),
    ));

  it("refuses a Payment larger than the selection on a target Bill, even when the Bill owes more", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Pago sobre una cuenta", price: 1000, by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));

        const error = yield* Effect.flip(
          recordSelection({
            items: [{ itemId: item.id, quantity: 1 }],
            billId: bill.id,
            payment: { method: "cash", amount: 2001 },
          }).pipe(as(ana)),
        );

        expect(error._tag).toBe("PaymentExceedsOwed");
      }),
    ));

  it("caps a target Bill's Payment at the selection, so a concurrent payment cannot leave Lines without their Payment", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Deuda previa y pago", price: 1000, by: ana });
        // The target Bill owes 2000 before this selection.
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 2 }] }).pipe(as(ana));
        expect(bill.owed).toBe(2000);

        // A selection of 1000 pays at most 1000 on Vender; 1500 is refused,
        // and nothing of the refused sale is written.
        const error = yield* Effect.flip(
          recordSelection({
            items: [{ itemId: item.id, quantity: 1 }],
            billId: bill.id,
            payment: { method: "cash", amount: 1500 },
          }).pipe(as(ana)),
        );
        expect(error._tag).toBe("PaymentExceedsOwed");
        expect(yield* getBill(bill.id).pipe(as(ana))).toMatchObject({
          total: 2000,
          paid: 0,
          owed: 2000,
          state: "open",
        });

        // Paying exactly the selection's total works, and the prior debt stays:
        // prior debt is settled from Cuenta (spec §6.1).
        const paid = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          billId: bill.id,
          payment: { method: "cash", amount: 1000 },
        }).pipe(as(ana));

        expect(paid).toMatchObject({ total: 3000, paid: 1000, owed: 2000, state: "partial" });
        expect((yield* getBill(bill.id).pipe(as(ana))).payments).toMatchObject([{ amount: 1000, method: "cash" }]);
      }),
    ));

  it("sends a Customer's next selection of the same Day to a new Bill once the day's Bill is Paid", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Nueva cuenta al pagar", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia que paga", { by: ana });

        const paid = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
          payment: { method: "cash" },
        }).pipe(as(ana));
        expect(paid.state).toBe("paid");

        const next = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }], customerId: ruiz.id }).pipe(
          as(ana),
        );

        expect(next.id).not.toBe(paid.id);
        expect(next).toMatchObject({ state: "open", paid: 0, day: "2026-10-05" });
        expect((yield* getBill(paid.id).pipe(as(ana))).state).toBe("paid");
      }),
    ));
});

/**
 * The statements of a selection are counted by the shared counting D1. Every
 * statement is prepared exactly once, whether it runs alone or inside a
 * batch, so a prepare counts one — and `batch` executes prepared statements
 * without preparing them again.
 */
it("records a ten-Item selection in well under 50 D1 statements", async () => {
  const seeded = await runTest(
    Effect.gen(function* () {
      const ana = yield* seedUser("admin");
      const category = yield* seedCategory("Contables", ana);
      const items: Array<{ id: string }> = [];
      for (let n = 0; n < 10; n++) {
        items.push(
          yield* seedItem({ name: `Producto contable ${n}`, price: 100 + n, startingStock: 1, categoryId: category.id, by: ana }),
        );
      }
      return { ana, items };
    }),
  );

  const { counter, d1 } = countingD1(env.DB);
  const bill = await Effect.runPromise(
    recordSelection({
      items: seeded.items.map((item) => ({ itemId: item.id, quantity: 1 })),
      payment: { method: "cash" },
    }).pipe(as(seeded.ana), Effect.provide(Db.layer(d1))),
  );

  // One read of the Items, the batch (the Bill, one Line statement, one Stock
  // statement, the Payment of Cobrar) and one read of the Bill: 7 statements,
  // well under the 50 a request may issue (spec §2.4).
  expect(bill.total).toBe(1045);
  expect(bill.state).toBe("paid");
  expect(counter.statements).toBeLessThan(30);
});

it("records a sixty-Item selection in at most 50 statements, no query over 100 bound parameters", async () => {
  const seeded = await runTest(
    Effect.gen(function* () {
      const ana = yield* seedUser("admin");
      const category = yield* seedCategory("Catálogo completo", ana);
      const items: Array<{ id: string }> = [];
      for (let n = 0; n < 60; n++) {
        items.push(
          yield* seedItem({ name: `Producto del catálogo ${n}`, price: 100 + n, startingStock: 1, categoryId: category.id, by: ana }),
        );
      }
      return { ana, items };
    }),
  );

  const { counter, d1 } = countingD1(env.DB);
  const bill = await Effect.runPromise(
    recordSelection({
      items: seeded.items.map((item) => ({ itemId: item.id, quantity: 1 })),
      payment: { method: "cash" },
    }).pipe(as(seeded.ana), Effect.provide(Db.layer(d1))),
  );

  // The catalog holds around 60 Items, and §2.4 allows a request 50 D1
  // statements: the Lines and their Stock moves travel as chunked multi-row
  // statements, never one statement per Item (2N + 2).
  expect(bill.total).toBe(7770);
  expect(bill.state).toBe("paid");
  expect(counter.statements).toBeLessThanOrEqual(50);
  expect(counter.maxParams).toBeLessThanOrEqual(100);
});
