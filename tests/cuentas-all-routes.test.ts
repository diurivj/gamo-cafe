import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { recordSelection } from "~/backend/bills";
import type { CurrentUser } from "~/backend/current-user";
import { Db } from "~/backend/db";

import { as, signedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";
import { nextHref } from "./support/pages";

// Cuentas (spec §6.2) and a Customer's past Bills (§6.1) through the Worker:
// what the routes let in, what they list and how they page. The read rules
// themselves are tested in cuentas.test.ts. Both screens list every Bill, so
// each test here starts from an empty database (as tests/last-admin.test.ts
// does).

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type User = CurrentUser["Service"];

const leaveOpen = (user: User, itemId: string, extra: { customerId?: string; note?: string } = {}) =>
  runTest(recordSelection({ items: [{ itemId, quantity: 1 }], ...extra }).pipe(as(user)));

/** Sets the projections of a Bill a test needs in another state or Day. */
const setBill = (
  billId: string,
  values: { readonly day?: string; readonly paid?: number; readonly state?: "partial" | "paid" | "voided" },
) =>
  runTest(
    Effect.gen(function* () {
      const db = yield* Db;
      if (values.day !== undefined) yield* db.run("UPDATE bills SET day = ? WHERE id = ?", values.day, billId);
      if (values.paid !== undefined) yield* db.run("UPDATE bills SET paid = ? WHERE id = ?", values.paid, billId);
      if (values.state !== undefined) yield* db.run("UPDATE bills SET state = ? WHERE id = ?", values.state, billId);
    }),
  );

/** Every `data-bill-id` of a list, in the order the page shows them. */
const listedIds = (html: string) => [...html.matchAll(/data-bill-id="([^"]+)"/g)].map((match) => match[1]);

/** Every `data-past-bill-id` of a Customer's past Bills, in page order. */
const pastIds = (html: string) => [...html.matchAll(/data-past-bill-id="([^"]+)"/g)].map((match) => match[1]);

describe("Cuentas", () => {
  it("is Admin only: a Worker is refused the page and its data", async () => {
    const beto = await signedIn("worker", "Beto");
    const ana = await signedIn("admin", "Ana");

    expect((await beto.fetch("/cuentas")).status).toBe(403);
    expect((await beto.fetch("/cuentas.data")).status).toBe(403);
    expect((await ana.fetch("/cuentas")).status).toBe(200);
  });

  it("lists every Bill with its state newest first, and filters by Day, state and Customer alone and combined", async () => {
    const ana = await signedIn("admin", "Ana");
    const ruiz = await savedCustomer("Familia de cuentas", { by: ana.user });
    const pena = await savedCustomer("Familia de cuentas dos", { by: ana.user });
    const item = await runTest(seedItem({ name: "De todas las cuentas", price: 1850, by: ana.user }));

    const abierta = await leaveOpen(ana.user, item.id, { customerId: ruiz.id });
    const parcial = await leaveOpen(ana.user, item.id, { customerId: pena.id });
    await setBill(parcial.id, { day: "2026-09-30", paid: 500, state: "partial" });
    const pagada = await leaveOpen(ana.user, item.id, { note: "Pagada sin cliente" });
    await setBill(pagada.id, { state: "paid" });
    const cancelada = await leaveOpen(ana.user, item.id);
    await setBill(cancelada.id, { state: "voided" });

    const html = await (await ana.fetch("/cuentas")).text();

    expect(html).toContain("Cuentas");
    expect(html).toContain("Familia de cuentas");
    expect(html).toContain("Pagada sin cliente");
    expect(html).toContain("Abierta");
    expect(html).toContain("Pago parcial");
    expect(html).toContain("Pagada");
    expect(html).toContain("Cancelada");
    expect(listedIds(html)).toEqual([cancelada.id, pagada.id, parcial.id, abierta.id]);
    expect(html).toContain(`href="/cuentas/${abierta.id}"`);

    // Each filter alone.
    const byState = await (await ana.fetch("/cuentas?estado=paid")).text();
    expect(listedIds(byState)).toEqual([pagada.id]);
    const byDay = await (await ana.fetch("/cuentas?dia=2026-09-30")).text();
    expect(listedIds(byDay)).toEqual([parcial.id]);
    const byCustomer = await (await ana.fetch(`/cuentas?cliente=${ruiz.id}`)).text();
    expect(listedIds(byCustomer)).toEqual([abierta.id]);
    // The chosen Customer stays chosen on the filter.
    expect(byCustomer).toContain(`value="${ruiz.id}"`);

    // And combined.
    const combined = await (
      await ana.fetch(`/cuentas?dia=2026-09-30&estado=partial&cliente=${pena.id}`)
    ).text();
    expect(listedIds(combined)).toEqual([parcial.id]);
    const none = await (
      await ana.fetch(`/cuentas?dia=2026-09-30&estado=partial&cliente=${ruiz.id}`)
    ).text();
    expect(listedIds(none)).toEqual([]);
    expect(none).toContain("No hay cuentas con esos filtros.");
  });

  it("holds 50 Bills per page and links to the next one, keeping the filters", async () => {
    const ana = await signedIn("admin", "Ana");
    await runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 55)
           INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
           SELECT 'pagina-ruta-' || x, '2026-09-30', ?, 1000 + x, NULL, 100, 0, 'open', 0 FROM n`,
          ana.user.id,
        );
      }),
    );

    const first = await (await ana.fetch("/cuentas?dia=2026-09-30")).text();
    expect(listedIds(first)).toHaveLength(50);
    expect(first).toContain("Cargar más");
    const next = nextHref(first);
    expect(next).toContain("/cuentas?dia=2026-09-30&desde=");

    const second = await (await ana.fetch(next!)).text();
    expect(listedIds(second)).toEqual(["pagina-ruta-5", "pagina-ruta-4", "pagina-ruta-3", "pagina-ruta-2", "pagina-ruta-1"]);
    expect(second).not.toContain("Cargar más");
    expect(nextHref(second)).toBeNull();

    // An unreadable cursor is no cursor: the first page, not an error.
    const bad = await ana.fetch("/cuentas?dia=2026-09-30&desde=ayer");
    expect(bad.status).toBe(200);
    expect(listedIds(await bad.text())).toEqual(listedIds(first));
  });
});

describe("a Customer's past Bills", () => {
  it("are Pagadas and Canceladas on the Customer's page for an Admin, never for a Worker", async () => {
    const ana = await signedIn("admin", "Ana");
    const beto = await signedIn("worker", "Beto");
    const ruiz = await savedCustomer("Familia de las pasadas", { by: ana.user });
    const item = await runTest(seedItem({ name: "Pasada de ruta", price: 1000, by: ana.user }));

    // Each starts a new Bill, because the one before it is no longer Open.
    const pagada = await leaveOpen(ana.user, item.id, { customerId: ruiz.id });
    await setBill(pagada.id, { state: "paid" });
    const cancelada = await leaveOpen(ana.user, item.id, { customerId: ruiz.id });
    await setBill(cancelada.id, { state: "voided" });
    const abierta = await leaveOpen(ana.user, item.id, { customerId: ruiz.id });

    const asAdmin = await (await ana.fetch(`/clientes/${ruiz.id}`)).text();

    expect(asAdmin).toContain("Cuentas pasadas");
    expect(asAdmin).toContain("Pagada");
    expect(asAdmin).toContain("Cancelada");
    expect(pastIds(asAdmin)).toEqual([cancelada.id, pagada.id]);
    expect(asAdmin).toContain(`href="/cuentas/${pagada.id}"`);

    const asWorker = await (await beto.fetch(`/clientes/${ruiz.id}`)).text();

    // The Worker keeps the Open Bills and sees no past ones at all.
    expect(asWorker).toContain("Cuentas abiertas");
    expect(asWorker).toContain(`href="/cuentas/${abierta.id}"`);
    expect(asWorker).not.toContain("Cuentas pasadas");
    expect(asWorker).not.toContain("data-past-bill-id");
    expect(asWorker).not.toContain(pagada.id);
    expect(asWorker).not.toContain(cancelada.id);
  });

  it("pages them 50 at a time", async () => {
    const ana = await signedIn("admin", "Ana");
    const ruiz = await savedCustomer("Familia de las pasadas paginadas", { by: ana.user });
    await runTest(
      Effect.gen(function* () {
        const db = yield* Db;
        yield* db.run(
          `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 55)
           INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
           SELECT 'pasada-ruta-' || x, '2026-09-29', ?, 1000 + x, ?, 100, 100, 'paid', 0 FROM n`,
          ana.user.id,
          ruiz.id,
        );
      }),
    );

    const first = await (await ana.fetch(`/clientes/${ruiz.id}`)).text();
    expect(pastIds(first)).toHaveLength(50);
    const next = nextHref(first);
    expect(next).toContain(`/clientes/${ruiz.id}?desde=`);

    const second = await (await ana.fetch(next!)).text();
    expect(pastIds(second)).toHaveLength(5);
    expect(nextHref(second)).toBeNull();
  });
});
