import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, recordSelection, takePayment } from "~/backend/bills";
import { Db } from "~/backend/db";

import { as, landing, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";

// Changing a Bill's Customer or note on Cuenta through the Worker (spec §5.3,
// §4.1, §7.3.4): what the route lets in and what it answers. The rules
// themselves are tested in bill-edits.test.ts. Tests share one D1, so each
// names its own.

const post = (who: SignedIn, path: string, fields: Record<string, string>) =>
  who.fetch(path, { method: "POST", body: new URLSearchParams(fields) });

const leaveOpen = (user: SignedIn["user"], itemId: string) =>
  runTest(recordSelection({ items: [{ itemId, quantity: 1 }] }).pipe(as(user)));

const EditRow = Schema.Struct({
  field: Schema.Literals(["customer", "note"]),
  previousValue: Schema.NullOr(Schema.String),
  newValue: Schema.NullOr(Schema.String),
  editedBy: Schema.String,
  editedAt: Schema.Int,
});

/** The `bill_edits` facts of one Bill; no operation reads them yet (ticket 18). */
const editsOf = (billId: string) =>
  runTest(
    Effect.gen(function* () {
      const db = yield* Db;
      return yield* db.all(
        EditRow,
        `SELECT field, previous_value AS previousValue, new_value AS newValue,
                edited_by AS editedBy, edited_at AS editedAt
         FROM bill_edits WHERE bill_id = ? ORDER BY edited_at, rowid`,
        billId,
      );
    }),
  );

describe("editing on Cuenta", () => {
  it("lets a Worker set the Customer and the note, and shows both after saving", async () => {
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "Editable en Cuenta", price: 1850 }));
    const ruiz = await savedCustomer("Familia Editable", { by: beto.user });
    const bill = await leaveOpen(beto.user, item.id);

    const response = await post(beto, `/cuentas/${bill.id}`, {
      intent: "editar",
      customerId: ruiz.id,
      note: "Paga los viernes",
      revision: String(bill.revision),
    });

    const html = await (await landing(beto, response)).text();
    expect(html).toContain("Familia Editable");
    expect(html).toContain("Paga los viernes");
    expect(html).toContain("Se guardaron los cambios");

    expect(await runTest(getBill(bill.id).pipe(as(beto.user)))).toMatchObject({
      customer: { id: ruiz.id, name: "Familia Editable" },
      note: "Paga los viernes",
      revision: bill.revision + 1,
    });
    expect(await editsOf(bill.id)).toMatchObject([
      { field: "customer", previousValue: null, newValue: ruiz.id, editedBy: beto.user.id },
      { field: "note", previousValue: null, newValue: "Paga los viernes", editedBy: beto.user.id },
    ]);
  });

  it("refuses a Worker after a Payment on the server, and lets an Admin change it", async () => {
    const ana = await signedIn("admin", "Ana");
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "Pagada en Cuenta", price: 2000, by: ana.user }));
    const ruiz = await savedCustomer("Familia Pago en Cuenta", { by: beto.user });
    const bill = await leaveOpen(ana.user, item.id);
    // A partial Payment: the Bill stays Open for the Worker to see.
    await runTest(
      takePayment({ billId: bill.id, amount: 500, method: "cash", expectedRevision: bill.revision }).pipe(
        as(beto.user),
      ),
    );
    const revision = String(bill.revision + 1);

    const refused = await post(beto, `/cuentas/${bill.id}`, {
      intent: "editar",
      customerId: ruiz.id,
      note: "tarde",
      revision,
    });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("Solo un administrador puede cambiar el cliente o la nota");
    expect(await editsOf(bill.id)).toEqual([]);
    expect(await runTest(getBill(bill.id).pipe(as(ana.user)))).toMatchObject({ customer: null, note: null });

    const allowed = await post(ana, `/cuentas/${bill.id}`, {
      intent: "editar",
      customerId: ruiz.id,
      note: "Paga el viernes",
      revision,
    });
    expect(allowed.status).toBe(302);
    expect(await runTest(getBill(bill.id).pipe(as(ana.user)))).toMatchObject({
      customer: { id: ruiz.id, name: "Familia Pago en Cuenta" },
      note: "Paga el viernes",
    });
    expect(await editsOf(bill.id)).toMatchObject([{ field: "customer" }, { field: "note" }]);
  });

  it("refuses a note over 80 characters, a stale revision and a retired Customer, writing nothing", async () => {
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "Rechazos de edición", price: 1000 }));
    const bill = await leaveOpen(beto.user, item.id);
    const retired = await savedCustomer("Don Nadie Retirado", { by: beto.user, retired: true });

    const fields = (extra: Record<string, string>) => ({
      intent: "editar",
      customerId: "",
      note: "",
      revision: String(bill.revision),
      ...extra,
    });
    const requests = [
      await post(beto, `/cuentas/${bill.id}`, fields({ note: "x".repeat(81) })),
      await post(beto, `/cuentas/${bill.id}`, fields({ note: "vieja", revision: String(bill.revision + 1) })),
      await post(beto, `/cuentas/${bill.id}`, fields({ customerId: retired.id })),
      await post(beto, `/cuentas/${bill.id}`, fields({ revision: "ayer" })),
    ];

    expect(requests.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    const messages = await Promise.all(requests.map((response) => response.text()));
    expect(messages[0]).toContain("La nota no puede pasar de 80 caracteres.");
    expect(messages[1]).toContain("La cuenta cambió");
    expect(messages[2]).toContain("Ese cliente no existe o está retirado.");
    expect(messages[3]).toContain("Recarga la página e intenta de nuevo.");
    expect(await editsOf(bill.id)).toEqual([]);
    expect(await runTest(getBill(bill.id).pipe(as(beto.user)))).toMatchObject({
      customer: null,
      note: null,
      revision: bill.revision,
    });
  });

  it("answers 400 to a form it does not understand", async () => {
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "Intentos raros", price: 1000 }));
    const bill = await leaveOpen(beto.user, item.id);

    const response = await post(beto, `/cuentas/${bill.id}`, { intent: "otro" });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("No entendimos esa acción");
  });

  it("offers the edit form only where the User may use it", async () => {
    const ana = await signedIn("admin", "Ana");
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "Formulario según rol", price: 1000, by: ana.user }));
    const bill = await leaveOpen(ana.user, item.id);

    // A Worker on a Bill with no Payment: the form is offered.
    expect(await (await beto.fetch(`/cuentas/${bill.id}`)).text()).toContain("Cliente y nota");

    // After a Payment the Worker no longer gets it; an Admin does.
    await runTest(
      takePayment({ billId: bill.id, amount: 200, method: "cash", expectedRevision: bill.revision }).pipe(
        as(ana.user),
      ),
    );
    const workerAfter = await (await beto.fetch(`/cuentas/${bill.id}`)).text();
    expect(workerAfter).toContain("Pago parcial");
    expect(workerAfter).not.toContain("Cliente y nota");
    expect(await (await ana.fetch(`/cuentas/${bill.id}`)).text()).toContain("Cliente y nota");

    // A Voided Bill accepts no corrections, so no Admin gets it either.
    const cancelada = await leaveOpen(ana.user, item.id);
    await runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        yield* db.run("UPDATE bills SET state = 'voided' WHERE id = ?", cancelada.id);
      }),
    );
    expect(await (await ana.fetch(`/cuentas/${cancelada.id}`)).text()).not.toContain("Cliente y nota");
  });
});
