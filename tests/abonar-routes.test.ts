import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, takePayment } from "~/backend/bills";
import { retireCustomer } from "~/backend/customers";
import { Db } from "~/backend/db";

import { as, landing, signedIn, type SignedIn } from "./support/auth";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";

// Abonar through the Worker (spec §5.5, §6.1 Clientes, §8.3): the Customer
// page's Open Bills and handovers, and what the route answers to a submission.
// The rules themselves are tested in abonar.test.ts. Tests share one D1, so
// each names its own Customer and bill ids.

interface SeededBill {
  readonly id: string;
  readonly customerId: string;
  readonly by: string;
  readonly day: string;
  readonly openedAt: number;
  readonly total: number;
  readonly paid: number;
  readonly state: "open" | "partial" | "paid";
  readonly revision: number;
}

/** A Bill's projection row, as a Customer with several Open Bills needs. */
function seedBill(bill: SeededBill) {
  return runTest(
    Effect.gen(function* () {
      const db = yield* Db;
      yield* db.run(
        `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        bill.id, bill.day, bill.by, bill.openedAt, bill.customerId, bill.total, bill.paid, bill.state, bill.revision,
      );
    }),
  );
}

/** The hidden field the page renders for each Open Bill. */
const hiddenBill = (id: string, revision: number) => `${id}:${revision}`;

/** A submission of the Abonar form, with one `bill` field per Open Bill. */
function abonar(
  who: SignedIn,
  customerId: string,
  fields: { readonly method?: string; readonly amount?: string; readonly bills?: ReadonlyArray<string> },
) {
  const body = new URLSearchParams({ intent: "abonar", method: fields.method ?? "cash", amount: fields.amount ?? "" });
  for (const bill of fields.bills ?? []) body.append("bill", bill);
  return who.fetch(`/clientes/${customerId}`, { method: "POST", body });
}

describe("the Customer page", () => {
  it("shows their Open Bills and what they owe, with Abonar defaulting to it", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia de la página", { by: beto.user });
    await seedBill({ id: "pagina-vieja", customerId: ruiz.id, by: beto.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
    await seedBill({ id: "pagina-nueva", customerId: ruiz.id, by: beto.user.id, day: "2026-10-02", openedAt: 2000, total: 3000, paid: 500, state: "partial", revision: 3 });
    await seedBill({ id: "pagina-pagada", customerId: ruiz.id, by: beto.user.id, day: "2026-09-30", openedAt: 500, total: 1000, paid: 1000, state: "paid", revision: 2 });

    const html = await (await beto.fetch(`/clientes/${ruiz.id}`)).text();

    expect(html).toContain("Familia de la página");
    expect(html).toContain("Debe $75.00");
    expect(html).toContain("$50.00");
    expect(html).toContain("$25.00");
    expect(html).toContain("Pago parcial");
    // Only the Open Bills are listed; the Paid one is not (ticket 16 shows
    // past Bills to Admins).
    expect(html).not.toContain("pagina-pagada");
    // The Abonar form carries each Bill's revision and starts at what the
    // Customer owes (spec §5.5).
    expect(html).toContain(`name="bill" value="${hiddenBill("pagina-vieja", 0)}"`);
    expect(html).toContain(`name="bill" value="${hiddenBill("pagina-nueva", 3)}"`);
    expect(html).toContain('value="$75.00"');
    expect(html).toContain("Abonar");
  });

  it("records one Abonar across the Bills and shows the handover as one event", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const ruiz = await savedCustomer("Familia del evento de la página", { by: beto.user });
    await seedBill({ id: "evento-vieja", customerId: ruiz.id, by: beto.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
    await seedBill({ id: "evento-nueva", customerId: ruiz.id, by: beto.user.id, day: "2026-10-02", openedAt: 2000, total: 3000, paid: 0, state: "open", revision: 0 });

    const response = await abonar(beto, ruiz.id, {
      method: "transfer",
      amount: "60.00",
      bills: [hiddenBill("evento-vieja", 0), hiddenBill("evento-nueva", 0)],
    });

    expect(await (await landing(beto, response)).text()).toContain("Abono de $60.00 registrado.");

    const after = await runTest(getBill("evento-vieja").pipe(as(ana.user)));
    const other = await runTest(getBill("evento-nueva").pipe(as(ana.user)));
    expect(after).toMatchObject({ paid: 5000, owed: 0, state: "paid" });
    expect(other).toMatchObject({ paid: 1000, owed: 2000, state: "partial" });
    expect(after.payments[0]!.id).not.toBe(other.payments[0]!.id);

    // The page shows one event, not one per Bill: the amount added up and how
    // many Bills it reached (spec §5.5, acceptance).
    const page = await (await beto.fetch(`/clientes/${ruiz.id}`)).text();
    const events = [...page.matchAll(/data-handover-event="([^"]*)"/g)].map((match) => match[1]);
    expect(events).toHaveLength(1);
    expect(page).toContain("$60.00");
    expect(page).toContain("2 cuentas");
    expect(page).toContain("Transferencia");
    expect(page).toContain("Beto");
  });

  it("refuses an amount above what the Customer owes, writing nothing", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia del rechazo de la página", { by: beto.user });
    await seedBill({ id: "rechazo-vieja", customerId: ruiz.id, by: beto.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });

    const response = await abonar(beto, ruiz.id, {
      amount: "50.01",
      bills: [hiddenBill("rechazo-vieja", 0)],
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("El abono no puede ser mayor que lo que debe el cliente.");
    expect((await runTest(getBill("rechazo-vieja").pipe(as(beto.user)))).payments).toEqual([]);
  });

  it("tells the User the Bills changed when the page is stale, writing nothing", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia de la revisión de la página", { by: beto.user });
    await seedBill({ id: "revision-vieja", customerId: ruiz.id, by: beto.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
    await seedBill({ id: "revision-nueva", customerId: ruiz.id, by: beto.user.id, day: "2026-10-02", openedAt: 2000, total: 3000, paid: 0, state: "open", revision: 0 });
    // Another phone pays the older Bill in full before this page is submitted.
    await runTest(takePayment({ billId: "revision-vieja", method: "cash", expectedRevision: 0 }).pipe(as(beto.user)));

    const response = await abonar(beto, ruiz.id, {
      amount: "80.00",
      bills: [hiddenBill("revision-vieja", 0), hiddenBill("revision-nueva", 0)],
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Las cuentas del cliente cambiaron");
    expect((await runTest(getBill("revision-nueva").pipe(as(beto.user)))).payments).toEqual([]);
  });

  it("still offers Abonar on a retired Customer's Open Bills", async () => {
    const ana = await signedIn("admin", "Ana");
    const ruiz = await savedCustomer("Familia retirada de la página", { by: ana.user });
    await seedBill({ id: "retirada-vieja", customerId: ruiz.id, by: ana.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
    await runTest(retireCustomer(ruiz.id).pipe(as(ana.user)));

    const response = await abonar(ana, ruiz.id, { amount: "20.00", bills: [hiddenBill("retirada-vieja", 0)] });

    expect(await (await landing(ana, response)).text()).toContain("Abono de $20.00 registrado.");
    const html = await (await ana.fetch(`/clientes/${ruiz.id}`)).text();
    expect(html).toContain("Retirado");
    expect(html).toContain("Sus cuentas abiertas se cobran igual.");
    expect(html).toContain("Abonar");
    expect(await runTest(getBill("retirada-vieja").pipe(as(ana.user)))).toMatchObject({
      paid: 2000,
      owed: 3000,
      state: "partial",
    });
  });

  it("refuses a Customer that does not exist, and a form with no Bill fields writes nothing", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia del formulario vacío", { by: beto.user });
    await seedBill({ id: "vacio-vieja", customerId: ruiz.id, by: beto.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });

    expect((await beto.fetch("/clientes/nadie")).status).toBe(404);

    // The Bills the page showed are gone from the form: the submission is
    // stale, not an Abonar against nothing.
    const response = await abonar(beto, ruiz.id, { amount: "50.00", bills: [] });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Las cuentas del cliente cambiaron");
    expect((await runTest(getBill("vacio-vieja").pipe(as(beto.user)))).payments).toEqual([]);
  });
});
