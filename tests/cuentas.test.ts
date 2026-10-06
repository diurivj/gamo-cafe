import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import {
  BILLS_PER_PAGE,
  type BillFilter,
  type BillPage,
  getBill,
  listCustomerPastBills,
  listBills,
  listOpenBills,
  recordSelection,
} from "~/backend/bills";
import type { CurrentUser } from "~/backend/current-user";
import { Db } from "~/backend/db";

import { as, seedUser } from "./support/auth";
import { seedItem } from "./support/catalog";
import { seedCustomer } from "./support/customers";
import { countingD1 } from "./support/d1";
import { advanceClock, runTest, setClock } from "./support/effect";

// Cuentas abiertas and Cuenta (spec §5.3, §6.1, §7.4, §4.1, §4.2). The lists
// and the row budgets are about every Bill in the database, so each test here
// starts from an empty one (as tests/last-admin.test.ts does).
beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/** Sets a Bill's projections the way a Payment or a Void will (tickets 08, 11). */
const markBill = (billId: string, state: "partial" | "paid" | "voided", paid = 0) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* db.run("UPDATE bills SET state = ?, paid = ? WHERE id = ?", state, paid, billId);
  });

describe("listOpenBills", () => {
  it("lists every Open Bill, newest first, with its Customer or note, Day, total, paid and owed", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Lista abierta", price: 1850, by: ana });
        const ruiz = yield* seedCustomer("Familia lista", { by: ana });

        const primera = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          note: "Para la mesa 1",
        }).pipe(as(ana));
        yield* advanceClock("1 hour");
        const segunda = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 2 }],
          customerId: ruiz.id,
        }).pipe(as(ana));
        yield* markBill(segunda.id, "partial", 1000);
        yield* advanceClock("1 hour");
        const anulada = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        yield* markBill(anulada.id, "voided");
        yield* advanceClock("1 hour");
        const pagada = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        yield* markBill(pagada.id, "paid", 1850);

        const bills = yield* listOpenBills();

        // Paid and Voided Bills are left out; the rest are newest first.
        expect(bills.map((bill) => bill.id)).toEqual([segunda.id, primera.id]);
        expect(bills[0]).toMatchObject({
          day: "2026-10-05",
          openedBy: ana.id,
          customer: { id: ruiz.id, name: "Familia lista" },
          note: null,
          total: 3700,
          paid: 1000,
          owed: 2700,
          state: "partial",
        });
        expect(bills[1]).toMatchObject({
          day: "2026-10-05",
          openedBy: ana.id,
          customer: null,
          note: "Para la mesa 1",
          total: 1850,
          paid: 0,
          owed: 1850,
          state: "open",
        });
      }),
    ));

  it("filters by Customer name, ignoring case and accents, and never by a Bill's note", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Buscable", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia Ruiz", { by: ana });
        const pena = yield* seedCustomer("Peña Blanca", { by: ana });

        const deRuiz = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));
        yield* advanceClock("1 minute");
        const dePena = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: pena.id,
        }).pipe(as(ana));
        yield* advanceClock("1 minute");
        const conNota = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          note: "Familia sin cliente",
        }).pipe(as(ana));

        expect((yield* listOpenBills("")).map((bill) => bill.id)).toEqual([conNota.id, dePena.id, deRuiz.id]);
        // The Customer name search is a prefix, ignoring case and accents.
        expect((yield* listOpenBills("familia r")).map((bill) => bill.id)).toEqual([deRuiz.id]);
        expect((yield* listOpenBills("PENA")).map((bill) => bill.id)).toEqual([dePena.id]);
        expect((yield* listOpenBills("familia")).map((bill) => bill.id)).toEqual([deRuiz.id]);
        // A name that only appears inside is not a prefix.
        expect(yield* listOpenBills("ruiz")).toEqual([]);
      }),
    ));

  it("answers nothing for a Customer prefix no Bill matches", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Sin coincidencias", price: 1000, by: ana });
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));

        expect(yield* listOpenBills("zzz")).toEqual([]);
      }),
    ));
});

describe("getBill's permission gate", () => {
  it("lets a Worker open an Open Bill, keeping each Line's author and their name", () =>
    runTest(
      Effect.gen(function* () {
        const beto = yield* seedUser("worker", "Beto");
        const ana = yield* seedUser("admin", "Ana");
        const item = yield* seedItem({ name: "De dos autores", price: 1000, by: ana });

        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(beto));
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 2 }], billId: bill.id }).pipe(as(ana));

        const seen = yield* getBill(bill.id).pipe(as(beto));

        expect(seen.total).toBe(3000);
        expect(seen.owed).toBe(3000);
        expect(seen.lines).toMatchObject([
          { itemId: item.id, quantity: 1, unitPrice: 1000, by: beto.id, byName: "Beto" },
          { itemId: item.id, quantity: 2, unitPrice: 1000, by: ana.id, byName: "Ana" },
        ]);
      }),
    ));

  it("refuses a Worker a Paid or Voided Bill, while an Admin opens it", () =>
    runTest(
      Effect.gen(function* () {
        const beto = yield* seedUser("worker", "Beto");
        const ana = yield* seedUser("admin", "Ana");
        const item = yield* seedItem({ name: "Solo para admin", price: 1000, by: ana });

        const pagada = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        yield* markBill(pagada.id, "paid", 1000);
        const anulada = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        yield* markBill(anulada.id, "voided");

        for (const billId of [pagada.id, anulada.id]) {
          expect((yield* Effect.flip(getBill(billId).pipe(as(beto))))._tag).toBe("BillNotVisible");
        }
        expect((yield* getBill(pagada.id).pipe(as(ana))).state).toBe("paid");
        expect((yield* getBill(anulada.id).pipe(as(ana))).state).toBe("voided");
      }),
    ));
});

/** Runs `listOpenBills` with a D1 that counts what it does. */
async function listed(typed = "") {
  const { counter, d1 } = countingD1(env.DB);
  const bills = await Effect.runPromise(listOpenBills(typed).pipe(Effect.provide(Db.layer(d1))));
  return { ...counter, bills };
}

/** Runs `listBills` with a D1 that counts what it does, as the Admin. */
async function pageOf(user: CurrentUser["Service"], filter: BillFilter = {}) {
  const { counter, d1 } = countingD1(env.DB);
  const page = await Effect.runPromise(
    listBills(filter).pipe(as(user), Effect.provide(Db.layer(d1))),
  );
  return { ...counter, ...page };
}

describe("Cuentas abiertas reads", () => {
  it("are one statement over the Open Bills, and do not grow with the number of Paid Bills", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const db = yield* Db;
        const item = yield* seedItem({ name: "Presupuesto de lectura", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia del presupuesto", { by: ana });
        for (let n = 0; n < 3; n++) {
          yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        }
        yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));

        const before = yield* Effect.promise(() => listed());
        expect(before.statements).toBe(1);
        expect(before.bills).toHaveLength(4);
        expect(before.rowsRead).toBeLessThan(25);

        // 200 Paid Bills: they are never read (spec §2.4, §7.4).
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 200)
           INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
           SELECT 'paga-' || x, '2026-10-04', ?, 1000 + x, NULL, 100, 100, 'paid', 0 FROM n`,
          ana.id,
        );

        const after = yield* Effect.promise(() => listed());
        expect(after.statements).toBe(1);
        expect(after.bills.map((bill) => bill.id)).toEqual(before.bills.map((bill) => bill.id));
        expect(after.rowsRead).toBeLessThanOrEqual(before.rowsRead + 4);

        // The Customer search is the same one statement over the same Bills.
        const searched = yield* Effect.promise(() => listed("familia"));
        expect(searched.statements).toBe(1);
        expect(searched.bills).toHaveLength(1);
        expect(searched.rowsRead).toBeLessThanOrEqual(before.rowsRead + 4);
      }),
    ));

  it("returns 200 Open Bills in one statement, reading only about their own rows", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const db = yield* Db;
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 200)
           INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
           SELECT 'abierta-' || x, '2026-10-04', ?, 1000 + x, NULL, 100, 0, 'open', 0 FROM n`,
          ana.id,
        );

        const measured = yield* Effect.promise(() => listed());

        expect(measured.statements).toBe(1);
        expect(measured.bills).toHaveLength(200);
        // Rows read are the Open Bills' own rows, not the history's.
        expect(measured.rowsRead).toBeLessThan(200 * 5);
      }),
    ));
});

// Cuentas (spec §6.2): every Bill with its state, filtered by Day, state or
// Customer, 50 per page. The read is Admin only (§4.1), index-driven and
// bounded by the page (§2.4, §7.4).
describe("listBills (Cuentas)", () => {
  it("lists every Bill, whatever its state, newest first", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Todas las cuentas", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia de todas", { by: ana });

        const abierta = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        yield* advanceClock("1 minute");
        const parcial = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));
        yield* markBill(parcial.id, "partial", 400);
        yield* advanceClock("1 minute");
        const pagada = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        yield* markBill(pagada.id, "paid", 1000);
        yield* advanceClock("1 minute");
        const cancelada = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        yield* markBill(cancelada.id, "voided");

        const page = yield* listBills().pipe(as(ana));

        expect(page.bills.map((bill) => [bill.id, bill.state])).toEqual([
          [cancelada.id, "voided"],
          [pagada.id, "paid"],
          [parcial.id, "partial"],
          [abierta.id, "open"],
        ]);
        expect(page).toMatchObject({ page: 1, hasMore: false });
        expect(page.bills[2]).toMatchObject({
          day: "2026-10-05",
          customer: { id: ruiz.id, name: "Familia de todas" },
          total: 1000,
          paid: 400,
          owed: 600,
        });
      }),
    ));

  it("filters by Day, state and Customer alone and combined", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T10:00:00");
        const ana = yield* seedUser("admin");
        const item = yield* seedItem({ name: "Filtrable", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia filtrable", { by: ana });
        const pena = yield* seedCustomer("Peña filtrable", { by: ana });

        const lunesRuiz = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));
        yield* advanceClock("1 hour");
        const lunesPena = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: pena.id,
        }).pipe(as(ana));
        yield* markBill(lunesPena.id, "paid", 1000);
        yield* advanceClock("1 day");
        const martesRuiz = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));
        yield* markBill(martesRuiz.id, "paid", 1000);
        yield* advanceClock("1 day");
        const miercolesSinCliente = yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(
          as(ana),
        );
        yield* markBill(miercolesSinCliente.id, "voided");

        const ids = (page: BillPage) => page.bills.map((bill) => bill.id);

        expect(ids(yield* listBills({ day: "2026-10-05" }).pipe(as(ana)))).toEqual([lunesPena.id, lunesRuiz.id]);
        expect(ids(yield* listBills({ state: "paid" }).pipe(as(ana)))).toEqual([martesRuiz.id, lunesPena.id]);
        expect(ids(yield* listBills({ customerId: ruiz.id }).pipe(as(ana)))).toEqual([martesRuiz.id, lunesRuiz.id]);
        expect(ids(yield* listBills({ day: "2026-10-05", state: "paid" }).pipe(as(ana)))).toEqual([lunesPena.id]);
        expect(ids(yield* listBills({ day: "2026-10-05", customerId: ruiz.id }).pipe(as(ana)))).toEqual([
          lunesRuiz.id,
        ]);
        expect(ids(yield* listBills({ state: "paid", customerId: ruiz.id }).pipe(as(ana)))).toEqual([martesRuiz.id]);
        expect(
          ids(yield* listBills({ day: "2026-10-05", state: "paid", customerId: pena.id }).pipe(as(ana))),
        ).toEqual([lunesPena.id]);
        expect(
          (yield* listBills({ day: "2026-10-05", state: "paid", customerId: ruiz.id }).pipe(as(ana))).bills,
        ).toEqual([]);
        expect((yield* listBills({ day: "2026-10-04" }).pipe(as(ana))).bills).toEqual([]);
      }),
    ));

  it("pages 50 Bills at a time, saying whether another page follows", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const db = yield* Db;
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 51)
           INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
           SELECT 'pagina-' || x, '2026-10-05', ?, 1000 + x, NULL, 100, 0, 'open', 0 FROM n`,
          ana.id,
        );

        const first = yield* listBills().pipe(as(ana));
        expect(first).toMatchObject({ page: 1, hasMore: true });
        expect(first.bills).toHaveLength(50);
        expect(first.bills[0]!.id).toBe("pagina-51");

        const second = yield* listBills({ page: 2 }).pipe(as(ana));
        expect(second).toMatchObject({ page: 2, hasMore: false });
        expect(second.bills.map((bill) => bill.id)).toEqual(["pagina-1"]);

        const beyond = yield* listBills({ page: 3 }).pipe(as(ana));
        expect(beyond.bills).toEqual([]);
        expect(beyond.hasMore).toBe(false);
      }),
    ));

  it("reads a page of its own rows in one statement, whatever the history holds", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin");
        const db = yield* Db;
        const item = yield* seedItem({ name: "Presupuesto de la página", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia del presupuesto de la página", { by: ana });
        for (let n = 0; n < 3; n++) {
          yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana));
        }
        const deRuiz = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));

        // A Day and state page, and a Customer's page: each reads what it shows.
        const dayState = yield* Effect.promise(() => pageOf(ana, { day: "2026-10-05", state: "open" }));
        expect(dayState.statements).toBe(1);
        expect(dayState.bills).toHaveLength(4);
        expect(dayState.rowsRead).toBeLessThan(25);
        const customer = yield* Effect.promise(() => pageOf(ana, { customerId: ruiz.id }));
        expect(customer.statements).toBe(1);
        expect(customer.bills.map((bill) => bill.id)).toEqual([deRuiz.id]);
        expect(customer.rowsRead).toBeLessThan(25);

        // 400 older Paid Bills: the filtered pages read none of them.
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 400)
           INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
           SELECT 'historica-' || x, '2026-10-04', ?, 500 + x, NULL, 100, 100, 'paid', 0 FROM n`,
          ana.id,
        );

        const dayStateAfter = yield* Effect.promise(() => pageOf(ana, { day: "2026-10-05", state: "open" }));
        expect(dayStateAfter.bills.map((bill) => bill.id)).toEqual(dayState.bills.map((bill) => bill.id));
        expect(dayStateAfter.rowsRead).toBeLessThanOrEqual(dayState.rowsRead + 4);
        const customerAfter = yield* Effect.promise(() => pageOf(ana, { customerId: ruiz.id }));
        expect(customerAfter.bills.map((bill) => bill.id)).toEqual(customer.bills.map((bill) => bill.id));
        expect(customerAfter.rowsRead).toBeLessThanOrEqual(customer.rowsRead + 4);

        // Every state at once is still one statement, bounded by the page: its
        // rows are the 4 newest Bills first, then the newest Paid ones to fill
        // the page.
        const every = yield* Effect.promise(() => pageOf(ana));
        expect(every.statements).toBe(1);
        expect(every.bills).toHaveLength(50);
        expect(every.bills.slice(0, 4).map((bill) => bill.id)).toEqual(dayState.bills.map((bill) => bill.id));
        expect(every.rowsRead).toBeLessThan(BILLS_PER_PAGE * 4 * 3);

        // 400 more Bills: the same page reads no more than it did before.
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 400)
           INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
           SELECT 'historica-b-' || x, '2026-10-03', ?, 100 + x, NULL, 100, 100, 'paid', 0 FROM n`,
          ana.id,
        );

        const twice = yield* Effect.promise(() => pageOf(ana));
        expect(twice.bills.map((bill) => bill.id)).toEqual(every.bills.map((bill) => bill.id));
        expect(twice.rowsRead).toBeLessThanOrEqual(every.rowsRead + 4);

        // A page far past the end reads nothing at all, not the history.
        const far = yield* Effect.promise(() => pageOf(ana, { page: 999 }));
        expect(far).toMatchObject({ statements: 0, rowsRead: 0, bills: [], hasMore: false });
      }),
    ));

  it("refuses a Worker", () =>
    runTest(
      Effect.gen(function* () {
        const ana = yield* seedUser("admin");
        const beto = yield* seedUser("worker");
        const item = yield* seedItem({ name: "Solo del admin de todas", price: 1000, by: ana });
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(beto));

        expect((yield* Effect.flip(listBills().pipe(as(beto))))._tag).toBe("AdminOnly");
        expect((yield* Effect.flip(listCustomerPastBills("cualquiera").pipe(as(beto))))._tag).toBe("AdminOnly");
      }),
    ));
});

describe("listCustomerPastBills", () => {
  it("gives an Admin a Customer's Pagadas and Canceladas, newest first, 50 per page, and leaves the Open ones out", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-03T12:00:00");
        const ana = yield* seedUser("admin");
        const db = yield* Db;
        const item = yield* seedItem({ name: "Pasada", price: 1000, by: ana });
        const ruiz = yield* seedCustomer("Familia pasada", { by: ana });
        const otra = yield* seedCustomer("Familia ajena", { by: ana });

        const abierta = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));
        yield* advanceClock("1 day");
        const pagada = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));
        yield* markBill(pagada.id, "paid", 1000);
        yield* advanceClock("1 day");
        const cancelada = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: ruiz.id,
        }).pipe(as(ana));
        yield* markBill(cancelada.id, "voided");
        yield* advanceClock("1 day");
        const ajena = yield* recordSelection({
          items: [{ itemId: item.id, quantity: 1 }],
          customerId: otra.id,
        }).pipe(as(ana));
        yield* markBill(ajena.id, "paid", 1000);

        const past = yield* listCustomerPastBills(ruiz.id).pipe(as(ana));
        expect(past.bills.map((bill) => [bill.id, bill.state])).toEqual([
          [cancelada.id, "voided"],
          [pagada.id, "paid"],
        ]);
        expect(past).toMatchObject({ page: 1, hasMore: false });
        expect(past.bills.map((bill) => bill.id)).not.toContain(abierta.id);
        expect(past.bills.map((bill) => bill.id)).not.toContain(ajena.id);

        // 55 more Pagadas: the page holds 50 and the second page the rest.
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 55)
           INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
           SELECT 'pasada-' || x, '2026-10-02', ?, 10 + x, ?, 100, 100, 'paid', 0 FROM n`,
          ana.id,
          ruiz.id,
        );

        const first = yield* listCustomerPastBills(ruiz.id).pipe(as(ana));
        expect(first).toMatchObject({ page: 1, hasMore: true });
        expect(first.bills).toHaveLength(50);
        expect(first.bills[0]!.id).toBe(cancelada.id);
        const second = yield* listCustomerPastBills(ruiz.id, 2).pipe(as(ana));
        expect(second).toMatchObject({ page: 2, hasMore: false });
        expect(second.bills).toHaveLength(7);
      }),
    ));
});
