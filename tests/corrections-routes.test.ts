import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, listOpenBills, recordSelection, takePayment } from "~/backend/bills";
import { stockOf } from "~/backend/stock";

import { as, seedUser, signedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { runTest } from "./support/effect";
import { recordCorrection, recordPayment } from "./support/sales";

// Cuenta's corrections through the Worker (spec §5.7, §8.4, §8.5, §10.4), as
// `/cuentas/:billId/corregir` answers them. The server must refuse what the
// screen hides: a Worker removing a Line from a Bill with a Payment, removing
// a Payment or voiding. And a correction sent again writes nothing twice.

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

describe("a Worker and corrections", () => {
  it("is refused a Line on a Bill with a Payment, and nothing is written", async () => {
    const { owner, bill, item } = await seeded("Ruta pago de por medio", [2], { amount: 500 });
    const beto = await signedIn("worker", "Beto");

    const response = await recordCorrection(beto, bill.id, {
        intent: "quitar-linea",
        lineId: bill.lines[0]!.id,
        revision: String(bill.revision),
      });

    expect(response.response.status).toBe(403);
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

    const response = await recordCorrection(beto, bill.id, {
        intent: "quitar-linea",
        lineId: bill.lines[0]!.id,
        revision: String(bill.revision),
      });

    expect(response.response.status).toBe(200);
    // The answer carries the Bill as the removal left it; nothing is read for it.
    expect(response.correction).toEqual({ total: 1000, owed: 1000, canOpen: true });
    const after = await runTest(getBill(bill.id).pipe(as(owner)));
    expect(after).toMatchObject({ total: 1000, paid: 0, state: "open", revision: bill.revision + 1 });
    expect(after.lines[0]!.removal).toMatchObject({ by: beto.user.id, byName: "Beto", reason: null });
  });

  it("is refused removing a Payment and voiding, with a 403", async () => {
    const { owner, bill, paymentId } = await seeded("Ruta empleado no puede", [1], { amount: 500 });
    const beto = await signedIn("worker", "Beto");

    const removePayment = await recordCorrection(beto, bill.id, {
        intent: "quitar-pago",
        paymentId: paymentId ?? "",
        reason: "No me toca",
        revision: String(bill.revision),
      });
    const voidResponse = await recordCorrection(beto, bill.id, {
        intent: "cancelar-cuenta",
        reason: "No me toca",
        revision: String(bill.revision),
      });

    expect(removePayment.response.status).toBe(403);
    expect(voidResponse.response.status).toBe(403);
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

    const withoutReason = await recordCorrection(ana, bill.id, {
        intent: "quitar-pago",
        paymentId: paymentId!,
        revision: String(bill.revision),
      });
    expect(withoutReason.response.status).toBe(400);
    expect(withoutReason.error).toContain("motivo");

    const response = await recordCorrection(ana, bill.id, {
        intent: "quitar-pago",
        paymentId: paymentId!,
        reason: "Se cobró por error",
        revision: String(bill.revision),
      });

    expect(response.response.status).toBe(200);
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

    const response = await recordCorrection(ana, bill.id, {
        intent: "cancelar-cuenta",
        reason: "Era una prueba",
        revision: String(bill.revision),
      });

    expect(response.response.status).toBe(200);
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

    const response = await recordCorrection(ana, bill.id, {
        intent: "quitar-linea",
        lineId: bill.lines[0]!.id,
        reason: "No aplica",
        revision: String(bill.revision - 1),
      });

    expect(response.response.status).toBe(400);
    expect(response.error).toContain("La cuenta cambió");
    const after = await runTest(getBill(bill.id).pipe(as(ana.user)));
    expect(after).toMatchObject({ revision: bill.revision });
    expect(after.lines[0]!.removal).toBeNull();
  });

  it("is refused a Line that would leave the total below the Payments", async () => {
    const { bill } = await seeded("Ruta debajo de pagos", [2], { amount: 500 });
    const ana = await signedIn("admin", "Ana");

    const response = await recordCorrection(ana, bill.id, {
        intent: "quitar-linea",
        lineId: bill.lines[0]!.id,
        reason: "Ya no lo llevó",
        revision: String(bill.revision),
      });

    expect(response.response.status).toBe(400);
    expect(response.error).toContain("quita un pago");
    const after = await runTest(getBill(bill.id).pipe(as(ana.user)));
    expect(after).toMatchObject({ total: 2000, paid: 500, revision: bill.revision });
    expect(after.lines[0]!.removal).toBeNull();
  });

  it("refuses a Voided Bill any further corrections", async () => {
    const { bill } = await seeded("Ruta anulada sin más", [1]);
    const ana = await signedIn("admin", "Ana");
    await recordCorrection(ana, bill.id, {
        intent: "cancelar-cuenta",
        reason: "Se acabó",
        revision: String(bill.revision),
      });
    const voided = await runTest(getBill(bill.id).pipe(as(ana.user)));

    const line = await recordCorrection(ana, bill.id, {
        intent: "quitar-linea",
        lineId: voided.lines[0]!.id,
        reason: "Tarde",
        revision: String(voided.revision),
      });
    const pay = await recordPayment(ana, bill.id, { method: "cash", amount: "5.00", revision: String(voided.revision) });

    expect(line.response.status).toBe(400);
    expect(line.error).toContain("cancelada");
    expect(pay.response.status).toBe(400);
    expect(pay.error).toContain("cancelada");
  });
});

describe("a correction sent again", () => {
  it("is answered as recorded when its first answer was lost, and writes nothing twice", async () => {
    const { bill, item } = await seeded("Ruta corrección repetida", [1, 1], { amount: 500 });
    const ana = await signedIn("admin", "Ana");
    const sent = {
      intent: "quitar-linea",
      lineId: bill.lines[0]!.id,
      reason: "Se registró de más",
      revision: String(bill.revision),
    };

    const first = await recordCorrection(ana, bill.id, sent);
    const again = await recordCorrection(ana, bill.id, sent);

    expect(first.correction).toEqual({ total: 1000, owed: 500, canOpen: true });
    expect(again.response.status).toBe(200);
    expect(again.correction).toEqual(first.correction);
    const after = await runTest(
      Effect.gen(function* () {
        const seen = yield* getBill(bill.id).pipe(as(ana.user));
        return { seen, stock: yield* stockOf(item.id).pipe(as(ana.user)) };
      }),
    );
    // One removal, one move of the revision, the units back once.
    expect(after.seen).toMatchObject({ total: 1000, paid: 500, revision: bill.revision + 1 });
    expect(after.seen.lines.map((line) => line.removal !== null)).toEqual([true, false]);
    expect(after.stock).toBe(9);
  });

  it("tells a Worker their removal was recorded even when it left a Bill they may no longer open", async () => {
    const { bill } = await seeded("Ruta última línea", [1]);
    const beto = await signedIn("worker", "Beto");
    const sent = { intent: "quitar-linea", lineId: bill.lines[0]!.id, revision: String(bill.revision) };

    const first = await recordCorrection(beto, bill.id, sent);
    const again = await recordCorrection(beto, bill.id, sent);

    expect(first.correction).toEqual({ total: 0, owed: 0, canOpen: false });
    expect(again.response.status).toBe(200);
    expect(again.correction).toEqual(first.correction);
  });

  it("is not taken for the User's own earlier correction when it carries another reason", async () => {
    const { bill, paymentId } = await seeded("Ruta otro motivo", [2], { amount: 2000 });
    const ana = await signedIn("admin", "Ana");
    const sent = { intent: "quitar-pago", paymentId: paymentId!, revision: String(bill.revision) };

    await recordCorrection(ana, bill.id, { ...sent, reason: "Por error" });
    const other = await recordCorrection(ana, bill.id, { ...sent, reason: "Otro motivo" });

    // The screen would otherwise show a reason nobody recorded.
    expect(other.response.status).toBe(400);
    expect(other.correction).toBeUndefined();
    expect(other.changed).toEqual({ canOpen: true });
  });

  it("is refused as stale when another User corrected the record first, and says whether the Bill can be read again", async () => {
    const { bill, paymentId } = await seeded("Ruta corrección ajena", [2], { amount: 2000 });
    const ana = await signedIn("admin", "Ana");
    const carla = await signedIn("admin", "Carla");
    const sent = { intent: "quitar-pago", paymentId: paymentId!, reason: "Por error", revision: String(bill.revision) };

    await recordCorrection(carla, bill.id, sent);
    const late = await recordCorrection(ana, bill.id, sent);

    expect(late.response.status).toBe(400);
    expect(late.error).toContain("La cuenta cambió");
    expect(late.changed).toEqual({ canOpen: true });
  });

  it("tells a Worker whose Bill was paid meanwhile that nothing was recorded and the Bill is not theirs to open", async () => {
    const { owner, bill } = await seeded("Ruta pagada mientras", [1]);
    const beto = await signedIn("worker", "Beto");
    await runTest(
      takePayment({ billId: bill.id, method: "cash", expectedRevision: bill.revision }).pipe(as(owner)),
    );

    const late = await recordCorrection(beto, bill.id, {
      intent: "quitar-linea",
      lineId: bill.lines[0]!.id,
      revision: String(bill.revision),
    });

    expect(late.response.status).toBe(400);
    expect(late.correction).toBeUndefined();
    expect(late.changed).toEqual({ canOpen: false });
  });

  it("answers a form it does not understand, and the page's own action no longer takes a correction", async () => {
    const { bill } = await seeded("Ruta forma desconocida", [1]);
    const ana = await signedIn("admin", "Ana");

    const unknown = await recordCorrection(ana, bill.id, { intent: "borrar", revision: String(bill.revision) });
    const stale = await recordCorrection(ana, bill.id, { intent: "cancelar-cuenta", reason: "x", revision: "" });
    const page = await ana.fetch(`/cuentas/${bill.id}`, {
      method: "POST",
      body: new URLSearchParams({ intent: "cancelar-cuenta", reason: "Era una prueba", revision: String(bill.revision) }),
    });

    expect(unknown.response.status).toBe(400);
    expect(unknown.error).toContain("No entendimos");
    expect(stale.response.status).toBe(400);
    expect(page.status).toBe(400);
    expect(await runTest(getBill(bill.id).pipe(as(ana.user)))).toMatchObject({ state: "open", revision: bill.revision });
  });
});
