import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, listCustomerHandovers, takePayment } from "~/backend/bills";
import { retireCustomer } from "~/backend/customers";
import { Db } from "~/backend/db";
import { paymentMessages } from "~/shared/payment-messages";

import { as, appFetch, signedIn } from "./support/auth";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";
import { handoverPath, recordHandover } from "./support/sales";

// Abonar through the Worker (spec §5.5, §6.1 Clientes, §8.3; UI redesign
// §5.3, §6): the Customer page's Open Bills and handovers, and what
// `/clientes/:customerId/abonar` answers to the page that sent one. The rules
// themselves are tested in abonar.test.ts. Tests share one D1, so each names
// its own Customer and bill ids.

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

describe("the Customer page", () => {
  it("leads with what they owe, lists only their Open Bills and offers Abonar", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia de la página", { by: beto.user });
    await seedBill({ id: "pagina-vieja", customerId: ruiz.id, by: beto.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
    await seedBill({ id: "pagina-nueva", customerId: ruiz.id, by: beto.user.id, day: "2026-10-02", openedAt: 2000, total: 3000, paid: 500, state: "partial", revision: 3 });
    await seedBill({ id: "pagina-pagada", customerId: ruiz.id, by: beto.user.id, day: "2026-09-30", openedAt: 500, total: 1000, paid: 1000, state: "paid", revision: 2 });

    const html = await (await beto.fetch(`/clientes/${ruiz.id}`)).text();

    expect(html).toContain("Familia de la página");
    expect(html).toContain("$75.00");
    expect(html).toContain("En 2 cuentas abiertas.");
    expect(html).toContain("$50.00");
    expect(html).toContain("$25.00");
    expect(html).toContain("Pago parcial");
    // Only the Open Bills are listed; a Worker is never sent the past ones.
    expect(html).toContain("/cuentas/pagina-vieja");
    expect(html).not.toContain("pagina-pagada");
    // Abonar is a step of its own, one tap from the figure.
    expect(html).toContain(`href="/clientes/${ruiz.id}?paso=abonar"`);
  });

  it("offers no Abonar to a Customer who owes nothing, and opens the page for the step's address", async () => {
    const beto = await signedIn("worker", "Beto");
    const paz = await savedCustomer("Familia sin deuda", { by: beto.user });

    const response = await beto.fetch(`/clientes/${paz.id}?paso=abonar`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("No debe nada.");
    expect(html).not.toContain("?paso=abonar");
    expect(html).not.toContain("Registrar abono");
  });

  it("no longer takes an Abonar itself: the page's own action refuses the form", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia del formulario viejo", { by: beto.user });
    await seedBill({ id: "viejo-a", customerId: ruiz.id, by: beto.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });

    const response = await beto.fetch(`/clientes/${ruiz.id}`, {
      method: "POST",
      body: new URLSearchParams({ intent: "abonar", method: "cash", amount: "20.00", bill: "viejo-a:0" }),
    });

    expect(response.status).toBe(400);
    expect((await runTest(getBill("viejo-a").pipe(as(beto.user)))).payments).toEqual([]);
  });
});

describe("where the Customer page sends an Abonar", () => {
  it("records one handover across the Bills, answers what it did, and the page shows it as one event", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const ruiz = await savedCustomer("Familia del evento de la página", { by: beto.user });
    await seedBill({ id: "evento-vieja", customerId: ruiz.id, by: beto.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
    await seedBill({ id: "evento-nueva", customerId: ruiz.id, by: beto.user.id, day: "2026-10-02", openedAt: 2000, total: 3000, paid: 0, state: "open", revision: 0 });

    const { response, handover } = await recordHandover(beto, ruiz.id, {
      method: "transfer",
      amount: "60.00",
      bills: ["evento-vieja:0", "evento-nueva:0"],
    });

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(handover).toEqual({ amount: 6000, bills: 2, owed: 2000 });

    const after = await runTest(getBill("evento-vieja").pipe(as(ana.user)));
    const other = await runTest(getBill("evento-nueva").pipe(as(ana.user)));
    expect(after).toMatchObject({ paid: 5000, owed: 0, state: "paid" });
    expect(other).toMatchObject({ paid: 1000, owed: 2000, state: "partial" });
    // One Payment per Bill, each with the Worker who received it.
    expect(after.payments.map((payment) => payment.byName)).toEqual(["Beto"]);
    expect(other.payments.map((payment) => payment.byName)).toEqual(["Beto"]);
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

  it("answers a handover sent again with its key as the first, and records it once", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia del reintento", { by: beto.user });
    await seedBill({ id: "reintento-a", customerId: ruiz.id, by: beto.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
    const sent = { amount: "20.00", bills: ["reintento-a:0"], submissionKey: "llave-del-reintento" };

    const first = await recordHandover(beto, ruiz.id, sent);
    const again = await recordHandover(beto, ruiz.id, sent);

    expect(first.handover).toEqual({ amount: 2000, bills: 1, owed: 3000 });
    expect([again.response.status, again.handover]).toEqual([200, first.handover]);
    expect(await runTest(listCustomerHandovers(ruiz.id).pipe(as(beto.user)))).toHaveLength(1);
  });

  it("refuses an amount above what the Customer owes, writing nothing", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia del rechazo de la página", { by: beto.user });
    await seedBill({ id: "rechazo-vieja", customerId: ruiz.id, by: beto.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });

    const { response, error, changed } = await recordHandover(beto, ruiz.id, { amount: "50.01", bills: ["rechazo-vieja:0"] });

    expect([response.status, error, changed]).toEqual([400, paymentMessages.CustomerPaymentExceedsOwed, undefined]);
    expect((await runTest(getBill("rechazo-vieja").pipe(as(beto.user)))).payments).toEqual([]);
  });

  it("refuses what cannot be read as a handover, in Spanish", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia de lo ilegible", { by: beto.user });
    await seedBill({ id: "ilegible-a", customerId: ruiz.id, by: beto.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
    const bills = ["ilegible-a:0"];

    const answers = [
      await recordHandover(beto, ruiz.id, { method: "cheque", amount: "10.00", bills }),
      await recordHandover(beto, ruiz.id, { amount: "diez", bills }),
      await recordHandover(beto, ruiz.id, { amount: "0", bills }),
      await recordHandover(beto, ruiz.id, { amount: "10.00", bills: ["ilegible-a:cero"] }),
    ];

    expect(answers.map(({ response, error }) => [response.status, error])).toEqual([
      [400, paymentMessages.MethodMissing],
      [400, paymentMessages.InvalidAmount],
      [400, paymentMessages.CustomerPaymentNotPositive],
      [400, "Recarga la página e intenta de nuevo."],
    ]);
    expect((await runTest(getBill("ilegible-a").pipe(as(beto.user)))).payments).toEqual([]);
  });

  it("tells the page the Bills changed when it is stale, writing nothing", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia de la revisión de la página", { by: beto.user });
    await seedBill({ id: "revision-vieja", customerId: ruiz.id, by: beto.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
    await seedBill({ id: "revision-nueva", customerId: ruiz.id, by: beto.user.id, day: "2026-10-02", openedAt: 2000, total: 3000, paid: 0, state: "open", revision: 0 });
    // Another phone pays the older Bill in full before this page is submitted.
    await runTest(takePayment({ billId: "revision-vieja", method: "cash", expectedRevision: 0 }).pipe(as(beto.user)));

    const { response, error, changed } = await recordHandover(beto, ruiz.id, {
      amount: "80.00",
      bills: ["revision-vieja:0", "revision-nueva:0"],
    });

    // `changed`: the page reads the Customer's Bills again.
    expect([response.status, error, changed]).toEqual([400, paymentMessages.CustomerBillsChanged, true]);
    expect((await runTest(getBill("revision-nueva").pipe(as(beto.user)))).payments).toEqual([]);

    // A handover that names none of the Bills is stale too, not an Abonar against nothing.
    const none = await recordHandover(beto, ruiz.id, { amount: "30.00", bills: [] });
    expect([none.response.status, none.error, none.changed]).toEqual([400, paymentMessages.CustomerBillsChanged, true]);
    expect((await runTest(getBill("revision-nueva").pipe(as(beto.user)))).payments).toEqual([]);
  });

  it("still collects a retired Customer's Open Bills", async () => {
    const ana = await signedIn("admin", "Ana");
    const ruiz = await savedCustomer("Familia retirada de la página", { by: ana.user });
    await seedBill({ id: "retirada-vieja", customerId: ruiz.id, by: ana.user.id, day: "2026-10-01", openedAt: 1000, total: 5000, paid: 0, state: "open", revision: 0 });
    await runTest(retireCustomer(ruiz.id).pipe(as(ana.user)));

    const html = await (await ana.fetch(`/clientes/${ruiz.id}`)).text();
    expect(html).toContain("Retirado");
    expect(html).toContain("Sus cuentas abiertas se cobran igual.");
    expect(html).toContain(`href="/clientes/${ruiz.id}?paso=abonar"`);

    const { handover } = await recordHandover(ana, ruiz.id, { amount: "20.00", bills: ["retirada-vieja:0"] });

    expect(handover).toEqual({ amount: 2000, bills: 1, owed: 3000 });
    expect(await runTest(getBill("retirada-vieja").pipe(as(ana.user)))).toMatchObject({
      paid: 2000,
      owed: 3000,
      state: "partial",
    });
  });

  it("answers 404 for a Customer that does not exist, sends a visitor to Entrar and has nothing to read", async () => {
    const beto = await signedIn("worker", "Beto");

    const nobody = await recordHandover(beto, "nadie", { amount: "10.00", bills: [] });
    expect([nobody.response.status, nobody.error]).toEqual([404, "Ese cliente ya no existe."]);
    expect((await beto.fetch("/clientes/nadie")).status).toBe(404);

    const signedOut = await appFetch(handoverPath("nadie"), { method: "POST", body: new URLSearchParams() });
    expect([signedOut.status, signedOut.headers.get("Location")]).toEqual([302, "/entrar"]);
    expect((await beto.fetch(handoverPath("nadie"))).status).toBe(400);
  });
});
