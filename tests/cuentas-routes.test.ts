import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, recordSelection } from "~/backend/bills";
import { Db } from "~/backend/db";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";
import { recordPayment, recordSale } from "./support/sales";

// Cuentas abiertas and Cuenta through the Worker: what the routes let in, how
// they read a form, and what they answer. The rules themselves are tested in
// cuentas.test.ts. Tests share one D1, so each names its own.

const post = (who: SignedIn, path: string, fields: Record<string, string>) =>
  who.fetch(path, { method: "POST", body: new URLSearchParams(fields) });

const leaveOpen = (user: SignedIn["user"], itemId: string, extra: { customerId?: string; note?: string } = {}) =>
  runTest(recordSelection({ items: [{ itemId, quantity: 1 }], ...extra }).pipe(as(user)));

/** Sets a Bill's projections the way a Payment or a Void will (tickets 08, 11). */
const setState = (billId: string, state: "paid" | "voided") =>
  runTest(
    Effect.gen(function* () {
      const db = yield* Db;
      yield* db.run(
        state === "paid"
          ? "UPDATE bills SET paid = total, state = 'paid' WHERE id = ?"
          : "UPDATE bills SET state = 'voided' WHERE id = ?",
        billId,
      );
    }),
  );

const selection = (itemId: string, quantity = 1) => JSON.stringify([{ itemId, quantity }]);

describe("Cuentas abiertas", () => {
  it("lists every Open Bill newest first, with its Customer or note and what it owes, and searches by Customer", async () => {
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia de la lista", { by: beto.user });
    await savedCustomer("Familia Paz de la lista", { by: beto.user });
    const item = await runTest(seedItem({ name: "De la lista", price: 1850 }));

    const deRuiz = await leaveOpen(beto.user, item.id, { customerId: ruiz.id });
    const conNota = await leaveOpen(beto.user, item.id, { note: "Se lo llevó Sofía" });
    const pagada = await leaveOpen(beto.user, item.id);
    await setState(pagada.id, "paid");

    const html = await (await beto.fetch("/cuentas-abiertas")).text();

    expect(html).toContain("Cuentas abiertas");
    expect(html).toContain("Familia de la lista");
    expect(html).toContain("Se lo llevó Sofía");
    expect(html).toContain("Abierta");
    expect(html).toContain("$18.50");
    // Newest first, and the Paid Bill is not there at all.
    expect([...html.matchAll(/data-bill-id="([^"]+)"/g)].map((match) => match[1])).toEqual([
      conNota.id,
      deRuiz.id,
    ]);
    expect(html).not.toContain(pagada.id);

    const filtered = await (await beto.fetch("/cuentas-abiertas?q=familia%20de")).text();

    expect(filtered).toContain(deRuiz.id);
    expect(filtered).not.toContain(conNota.id);
    expect(filtered).toContain("Familia de la lista");
  });
});

describe("Cuenta", () => {
  it("shows the Bill's Lines with who and when, its state and what it owes, and Agregar productos opens Vender targeting it", async () => {
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "De la cuenta", price: 1850 }));
    const bill = await leaveOpen(beto.user, item.id);

    const html = await (await beto.fetch(`/cuentas/${bill.id}`)).text();

    expect(html).toContain("Cuenta");
    expect(html).toContain("Abierta");
    expect(html).toContain("De la cuenta");
    expect(html).toContain("Beto");
    expect(html).toMatch(/\d{2}:\d{2}/);
    expect(html).toContain("Total");
    expect(html).toContain("Debe");
    expect(html).toContain('href="/?billId=' + bill.id + '"');

    // Vender, targeting this Bill: it says which one, with the way back to it
    // (UI redesign §5.3).
    const vender = await (await beto.fetch(`/?billId=${bill.id}`)).text();
    expect(vender).toContain("Se agrega a una cuenta sin cliente");
    expect(vender).toContain("Debe $18.50");
    expect(vender).toContain(`href="/cuentas/${bill.id}"`);
  });

  it("puts Lines added from Cuenta on that Bill, for any User, each with its own author", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const item = await runTest(seedItem({ name: "Agregable a la cuenta", price: 1000, by: ana.user }));
    const bill = await leaveOpen(beto.user, item.id);

    const added = await recordSale(ana, {
      intent: "dejar-abierta",
      selection: selection(item.id, 2),
      billId: bill.id,
    });

    expect(added.sale).toMatchObject({ billId: bill.id, total: 3000, owed: 3000, state: "open" });

    const updated = await runTest(getBill(bill.id).pipe(as(beto.user)));
    expect(updated.total).toBe(3000);
    expect(updated.owed).toBe(3000);
    expect(updated.lines.map((line) => [line.by, line.byName, line.quantity])).toEqual([
      [beto.user.id, "Beto", 1],
      [ana.user.id, "Ana", 2],
    ]);

    // Cuenta names both authors.
    const html = await (await beto.fetch(`/cuentas/${bill.id}`)).text();
    expect(html).toContain("Beto");
    expect(html).toContain("Ana");
    expect(html).toContain("$30.00");
    expect(html).toMatch(/Debe[\s\S]{0,200}\$30\.00/);
  });

  it("refuses Lines on a Bill that is not Open, whatever the User, and writes nothing", async () => {
    const ana = await signedIn("admin", "Ana");
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "No agregable", price: 1000, by: ana.user }));
    const pagada = await leaveOpen(ana.user, item.id);
    await setState(pagada.id, "paid");
    const fields = {
      intent: "dejar-abierta",
      selection: selection(item.id),
      billId: pagada.id,
    };

    const asAdmin = await recordSale(ana, fields);
    expect(asAdmin.response.status).toBe(400);
    expect(asAdmin.error).toContain("Esta cuenta ya no está abierta.");

    const asWorker = await recordSale(beto, fields);
    expect(asWorker.response.status).toBe(400);

    // A Customer or a note cannot be smuggled in with a target Bill either.
    const conflicted = await recordSale(ana, { ...fields, customerId: "", note: "otra" });
    expect(conflicted.response.status).toBe(400);
    expect(conflicted.error).toContain("No se puede elegir cliente ni nota");

    expect((await runTest(getBill(pagada.id).pipe(as(ana.user)))).lines).toHaveLength(1);
  });

  it("refuses a Worker the page of a Paid or Voided Bill, and the Vender form targeting it", async () => {
    const ana = await signedIn("admin", "Ana");
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "Solo del admin", price: 1000, by: ana.user }));
    const pagada = await leaveOpen(ana.user, item.id);
    await setState(pagada.id, "paid");
    const anulada = await leaveOpen(ana.user, item.id);
    await setState(anulada.id, "voided");
    const abierta = await leaveOpen(ana.user, item.id);

    const refused = [
      await beto.fetch(`/cuentas/${pagada.id}`),
      await beto.fetch(`/cuentas/${pagada.id}.data`),
      await beto.fetch(`/cuentas/${anulada.id}`),
      await beto.fetch(`/?billId=${pagada.id}`),
    ];
    expect(refused.map((response) => response.status)).toEqual([403, 403, 403, 403]);

    // An Admin opens both, and a Worker still opens the Open one.
    expect((await ana.fetch(`/cuentas/${pagada.id}`)).status).toBe(200);
    expect((await ana.fetch(`/cuentas/${anulada.id}`)).status).toBe(200);
    expect((await beto.fetch(`/cuentas/${abierta.id}`)).status).toBe(200);
    expect((await ana.fetch("/cuentas/nadie")).status).toBe(404);
  });
});

describe("Cobrar on Cuenta", () => {
  it("takes a Payment that defaults to what the Bill owes, and lists it with who, when and method", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const item = await runTest(seedItem({ name: "Cobrable en Cuenta", price: 1850, by: ana.user }));
    const bill = await leaveOpen(beto.user, item.id);

    // A Worker takes a partial Payment: the amount may be less than owed.
    const partial = await recordPayment(beto, bill.id, {
      method: "cash",
      amount: "5.00",
      revision: String(bill.revision),
    });
    expect(partial.response.status).toBe(200);
    // Answered to the request that sent it, and nothing left in a cookie.
    expect(partial.response.headers.getSetCookie()).toEqual([]);
    expect(partial.response.headers.get("Cache-Control")).toBe("no-store");
    expect(partial.payment).toEqual({ amount: 500, total: 1850, owed: 1350, paid: false, canOpen: true });

    const page = await (await beto.fetch(`/cuentas/${bill.id}`)).text();
    expect(page).toContain("Pago parcial");
    expect(page).toContain("Efectivo");
    expect(page).toContain("Beto");
    expect(page).toMatch(/\d{2}:\d{2}/);
    expect(page).toContain("$13.50");
    expect(page).toContain("$5.00");

    // An empty amount pays everything still owed; an Admin may open it Pagada.
    const fresh = await runTest(getBill(bill.id).pipe(as(beto.user)));
    const paid = await recordPayment(ana, bill.id, { method: "transfer", amount: "", revision: String(fresh.revision) });
    expect(paid.payment).toEqual({ amount: 1350, total: 1850, owed: 0, paid: true, canOpen: true });

    const after = await runTest(getBill(bill.id).pipe(as(ana.user)));
    expect(after).toMatchObject({ paid: 1850, owed: 0, state: "paid" });
    expect(after.payments.map((payment) => [payment.amount, payment.method, payment.byName])).toEqual([
      [500, "cash", "Beto"],
      [1350, "transfer", "Ana"],
    ]);
  });

  it("tells the User the Bill changed when the page is stale, and writes nothing", async () => {
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "Revisión en Cuenta", price: 1000 }));
    const bill = await leaveOpen(beto.user, item.id);

    const stale = await recordPayment(beto, bill.id, { method: "cash", amount: "", revision: String(bill.revision + 1) });

    expect(stale.response.status).toBe(400);
    expect(stale.error).toBe("La cuenta cambió mientras registrabas el pago. Revisa el monto y vuelve a intentar.");
    // The Bill is still Open, so the Worker's screen may read it again.
    expect(stale.changed).toEqual({ canOpen: true });
    expect((await runTest(getBill(bill.id).pipe(as(beto.user)))).payments).toEqual([]);
  });

  it("tells a Worker whose Bill was paid from another phone that it is no longer theirs to open", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const item = await runTest(seedItem({ name: "Pagada en otro teléfono", price: 1000, by: ana.user }));
    const bill = await leaveOpen(beto.user, item.id);
    const payment = { method: "cash", amount: "$10.00", revision: String(bill.revision) };

    expect((await recordPayment(ana, bill.id, payment)).payment).toMatchObject({ paid: true });
    const late = await recordPayment(beto, bill.id, payment);
    const lateAdmin = await recordPayment(ana, bill.id, { ...payment, method: "transfer" });

    expect(late.response.status).toBe(400);
    expect(late.error).toContain("La cuenta cambió mientras registrabas el pago.");
    expect(late.changed).toEqual({ canOpen: false });
    // An Admin opens a Paid Bill, so theirs is read again.
    expect(lateAdmin.changed).toEqual({ canOpen: true });
    expect((await runTest(getBill(bill.id).pipe(as(ana.user)))).payments).toHaveLength(1);
  });

  it("refuses a Payment of zero, larger than owed or unreadable, in Spanish", async () => {
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "Rechazo en Cuenta", price: 1000 }));
    const bill = await leaveOpen(beto.user, item.id);
    const fields = (extra: Record<string, string>) => ({
      method: "cash",
      amount: "",
      revision: String(bill.revision),
      ...extra,
    });

    const refused = [
      await recordPayment(beto, bill.id, fields({ amount: "0" })),
      await recordPayment(beto, bill.id, fields({ amount: "10.01" })),
      await recordPayment(beto, bill.id, fields({ amount: "mucho" })),
      await recordPayment(beto, bill.id, fields({ method: "" })),
      await recordPayment(beto, bill.id, fields({ revision: "" })),
    ];

    expect(refused.map(({ response }) => response.status)).toEqual([400, 400, 400, 400, 400]);
    expect(refused.map(({ error }) => error)).toEqual([
      "El pago debe ser mayor que cero.",
      "El pago no puede ser mayor que lo que debe la cuenta.",
      "El monto no es válido. Escríbelo como 18.50.",
      "Elige cómo se pagó.",
      "Recarga la página e intenta de nuevo.",
    ]);
    // Only the one about what the Bill owes asks the screen to read it again.
    expect(refused.map(({ changed }) => changed)).toEqual([undefined, { canOpen: true }, undefined, undefined, undefined]);
    expect((await runTest(getBill(bill.id).pipe(as(beto.user)))).payments).toEqual([]);
  });

  it("answers a Worker whose Payment makes the Bill Pagada without sending them into it", async () => {
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "Pagada por empleado", price: 1200 }));
    const bill = await leaveOpen(beto.user, item.id);

    const paid = await recordPayment(beto, bill.id, { method: "cash", amount: "", revision: String(bill.revision) });

    expect(paid.response.status).toBe(200);
    expect(paid.payment).toEqual({ amount: 1200, total: 1200, owed: 0, paid: true, canOpen: false });
    expect((await beto.fetch(`/cuentas/${bill.id}`)).status).toBe(403);
  });

  it("answers a Bill that does not exist as a refusal, and takes no Payment through Cuenta's own forms", async () => {
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "Sin formulario de pago", price: 1200 }));
    const bill = await leaveOpen(beto.user, item.id);

    const missing = await recordPayment(beto, "nadie", { method: "cash", amount: "", revision: "0" });
    expect(missing.response.status).toBe(404);
    expect(missing.changed).toEqual({ canOpen: false });

    // The Payment has one way in: the page's action no longer knows it.
    const old = await post(beto, `/cuentas/${bill.id}`, {
      intent: "pagar",
      method: "cash",
      amount: "",
      revision: String(bill.revision),
    });
    expect(old.status).toBe(400);
    expect((await runTest(getBill(bill.id).pipe(as(beto.user)))).payments).toEqual([]);
  });
});
