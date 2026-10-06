import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, recordSelection } from "~/backend/bills";
import { Db } from "~/backend/db";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";

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

    // Vender, targeting this Bill: the form carries it and the Customer/note
    // fields step aside (spec §6.1, "Agregar productos").
    const vender = await (await beto.fetch(`/?billId=${bill.id}`)).text();
    expect(vender).toContain("Agregando productos");
    expect(vender).toContain("Agregar a la cuenta");
    expect(vender).toContain(`value="${bill.id}"`);
  });

  it("puts Lines added from Cuenta on that Bill, for any User, each with its own author", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");
    const item = await runTest(seedItem({ name: "Agregable a la cuenta", price: 1000, by: ana.user }));
    const bill = await leaveOpen(beto.user, item.id);

    // The same URL the form carries: `?index` for the index action, and the
    // target Bill so the loader answers for the page the User was on.
    const response = await post(ana, `/?index&billId=${bill.id}`, {
      intent: "dejar-abierta",
      selection: selection(item.id, 2),
      billId: bill.id,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Se agregaron los productos a la cuenta");

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

    const asAdmin = await post(ana, "/?index", fields);
    expect(asAdmin.status).toBe(400);
    expect(await asAdmin.text()).toContain("Esta cuenta ya no está abierta.");

    const asWorker = await post(beto, "/?index", fields);
    expect(asWorker.status).toBe(400);

    // A Customer or a note cannot be smuggled in with a target Bill either.
    const conflicted = await post(ana, "/?index", { ...fields, customerId: "", note: "otra" });
    expect(conflicted.status).toBe(400);
    expect(await conflicted.text()).toContain("No se puede elegir cliente ni nota");

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
