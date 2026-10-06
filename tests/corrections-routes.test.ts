import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, listOpenBills, recordSelection, takePayment } from "~/backend/bills";
import { stockOf } from "~/backend/stock";

import { as, seedUser, signedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { runTest } from "./support/effect";

// Cuenta's corrections through the Worker (spec §5.7, §8.4, §8.5, §10.4).
// The server must refuse what the screen hides: a Worker removing a Line from
// a Bill with a Payment, removing a Payment or voiding.

/**
 * A Bill seeded through the operations: one Line per quantity given, then an
 * optional Payment. Returns the Bill as Cuenta reads it and its Line ids.
 */
function seeded(name: string, quantities: ReadonlyArray<number>, payment?: { readonly amount?: number }) {
  return runTest(
    Effect.gen(function* () {
      const ana = yield* seedUser("admin");
      const item = yield* seedItem({ name, price: 1000, startingStock: 10, by: ana });
      const first = yield* recordSelection({ items: [{ itemId: item.id, quantity: quantities[0]! }] }).pipe(as(ana));
      for (const quantity of quantities.slice(1)) {
        yield* recordSelection({ items: [{ itemId: item.id, quantity }], billId: first.id }).pipe(as(ana));
      }
      let bill = yield* getBill(first.id).pipe(as(ana));
      let paymentId: string | null = null;
      if (payment) {
        const recorded = yield* takePayment({
          billId: first.id,
          amount: payment.amount,
          method: "cash",
          expectedRevision: bill.revision,
        }).pipe(as(ana));
        paymentId = recorded.id;
        bill = yield* getBill(first.id).pipe(as(ana));
      }
      return { owner: ana, item, bill, paymentId };
    }),
  );
}

const post = (body: Record<string, string>) => ({
  method: "POST",
  body: new URLSearchParams(body),
});

describe("a Worker and corrections", () => {
  it("is refused a Line on a Bill with a Payment, and nothing is written", async () => {
    const { owner, bill, item } = await seeded("Ruta pago de por medio", [2], { amount: 500 });
    const beto = await signedIn("worker", "Beto");

    const response = await beto.fetch(
      `/cuentas/${bill.id}`,
      post({
        intent: "quitar-linea",
        lineId: bill.lines[0]!.id,
        revision: String(bill.revision),
      }),
    );

    expect(response.status).toBe(403);
    const after = await runTest(
      Effect.gen(function* () {
        const seen = yield* getBill(bill.id).pipe(as(owner));
        return { seen, stock: yield* stockOf(item.id).pipe(as(owner)) };
      }),
    );
    expect(after.seen).toMatchObject({ total: 2000, paid: 500, revision: bill.revision });
    expect(after.seen.lines[0]!.removal).toBeNull();
    expect(after.stock).toBe(8);
  });

  it("removes a Line from a Bill with no Payment, marked with their name", async () => {
    const { owner, bill } = await seeded("Ruta empleado quita", [1, 1]);
    const beto = await signedIn("worker", "Beto");

    const response = await beto.fetch(
      `/cuentas/${bill.id}`,
      post({
        intent: "quitar-linea",
        lineId: bill.lines[0]!.id,
        revision: String(bill.revision),
      }),
    );

    expect(response.status).toBe(302);
    const after = await runTest(getBill(bill.id).pipe(as(owner)));
    expect(after).toMatchObject({ total: 1000, paid: 0, state: "open", revision: bill.revision + 1 });
    expect(after.lines[0]!.removal).toMatchObject({ by: beto.user.id, byName: "Beto", reason: null });
  });

  it("is refused removing a Payment and voiding, with a 403", async () => {
    const { owner, bill, paymentId } = await seeded("Ruta empleado no puede", [1], { amount: 500 });
    const beto = await signedIn("worker", "Beto");

    const removePayment = await beto.fetch(
      `/cuentas/${bill.id}`,
      post({
        intent: "quitar-pago",
        paymentId: paymentId ?? "",
        reason: "No me toca",
        revision: String(bill.revision),
      }),
    );
    const voidResponse = await beto.fetch(
      `/cuentas/${bill.id}`,
      post({
        intent: "cancelar-cuenta",
        reason: "No me toca",
        revision: String(bill.revision),
      }),
    );

    expect(removePayment.status).toBe(403);
    expect(voidResponse.status).toBe(403);
    const after = await runTest(getBill(bill.id).pipe(as(owner)));
    expect(after).toMatchObject({ state: "partial", paid: 500, revision: bill.revision });
    expect(after.payments[0]!.removal).toBeNull();
  });
});

describe("an Admin's corrections through Cuenta", () => {
  it("removes a Payment with a reason and leaves the Bill Open again", async () => {
    const { owner, bill, item, paymentId } = await seeded("Ruta admin quita pago", [2], { amount: 2000 });
    expect(paymentId).not.toBeNull();
    const ana = await signedIn("admin", "Ana");

    const withoutReason = await ana.fetch(
      `/cuentas/${bill.id}`,
      post({
        intent: "quitar-pago",
        paymentId: paymentId!,
        revision: String(bill.revision),
      }),
    );
    expect(withoutReason.status).toBe(400);
    expect(await withoutReason.text()).toContain("motivo");

    const response = await ana.fetch(
      `/cuentas/${bill.id}`,
      post({
        intent: "quitar-pago",
        paymentId: paymentId!,
        reason: "Se cobró por error",
        revision: String(bill.revision),
      }),
    );

    expect(response.status).toBe(302);
    const after = await runTest(
      Effect.gen(function* () {
        const seen = yield* getBill(bill.id).pipe(as(owner));
        return { seen, stock: yield* stockOf(item.id).pipe(as(owner)) };
      }),
    );
    expect(after.seen).toMatchObject({ paid: 0, owed: 2000, state: "open", revision: bill.revision + 1 });
    expect(after.seen.payments[0]!.removal).toMatchObject({ by: ana.user.id, reason: "Se cobró por error" });
    expect(after.stock).toBe(8);
  });

  it("voids a Bill with a reason, and it leaves Cuentas abiertas", async () => {
    const { bill, item } = await seeded("Ruta admin anula", [2]);
    const ana = await signedIn("admin", "Ana");

    const response = await ana.fetch(
      `/cuentas/${bill.id}`,
      post({
        intent: "cancelar-cuenta",
        reason: "Era una prueba",
        revision: String(bill.revision),
      }),
    );

    expect(response.status).toBe(302);
    const after = await runTest(
      Effect.gen(function* () {
        const seen = yield* getBill(bill.id).pipe(as(ana.user));
        return { seen, stock: yield* stockOf(item.id).pipe(as(ana.user)), open: (yield* listOpenBills()).bills };
      }),
    );
    expect(after.seen).toMatchObject({ state: "voided", revision: bill.revision + 1 });
    expect(after.seen.voided).toMatchObject({ by: ana.user.id, reason: "Era una prueba" });
    expect(after.stock).toBe(10);
    expect(after.open.map((row) => row.id)).not.toContain(bill.id);
  });

  it("refuses a stale submission, writing nothing", async () => {
    const { bill } = await seeded("Ruta revisión vieja", [1, 1]);
    const ana = await signedIn("admin", "Ana");

    const response = await ana.fetch(
      `/cuentas/${bill.id}`,
      post({
        intent: "quitar-linea",
        lineId: bill.lines[0]!.id,
        reason: "No aplica",
        revision: String(bill.revision - 1),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("La cuenta cambió");
    const after = await runTest(getBill(bill.id).pipe(as(ana.user)));
    expect(after).toMatchObject({ revision: bill.revision });
    expect(after.lines[0]!.removal).toBeNull();
  });

  it("is refused a Line that would leave the total below the Payments", async () => {
    const { bill } = await seeded("Ruta debajo de pagos", [2], { amount: 500 });
    const ana = await signedIn("admin", "Ana");

    const response = await ana.fetch(
      `/cuentas/${bill.id}`,
      post({
        intent: "quitar-linea",
        lineId: bill.lines[0]!.id,
        reason: "Ya no lo llevó",
        revision: String(bill.revision),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("quita un pago");
    const after = await runTest(getBill(bill.id).pipe(as(ana.user)));
    expect(after).toMatchObject({ total: 2000, paid: 500, revision: bill.revision });
    expect(after.lines[0]!.removal).toBeNull();
  });

  it("refuses a Voided Bill any further corrections", async () => {
    const { bill } = await seeded("Ruta anulada sin más", [1]);
    const ana = await signedIn("admin", "Ana");
    await ana.fetch(
      `/cuentas/${bill.id}`,
      post({
        intent: "cancelar-cuenta",
        reason: "Se acabó",
        revision: String(bill.revision),
      }),
    );
    const voided = await runTest(getBill(bill.id).pipe(as(ana.user)));

    const line = await ana.fetch(
      `/cuentas/${bill.id}`,
      post({
        intent: "quitar-linea",
        lineId: voided.lines[0]!.id,
        reason: "Tarde",
        revision: String(voided.revision),
      }),
    );
    const pay = await ana.fetch(
      `/cuentas/${bill.id}`,
      post({
        intent: "pagar",
        method: "cash",
        amount: "5.00",
        revision: String(voided.revision),
      }),
    );

    expect(line.status).toBe(400);
    expect(await line.text()).toContain("cancelada");
    expect(pay.status).toBe(400);
    expect(await pay.text()).toContain("cancelada");
  });
});
