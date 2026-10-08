import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { recordSelection } from "~/backend/bills";
import { Db } from "~/backend/db";
import { dayOf, formatDay } from "~/shared/day";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { savedCustomer } from "./support/customers";
import { runTest } from "./support/effect";

// Por cobrar through the Worker (spec §6.2, §4.1): who gets in, and what the
// page shows. The rules themselves are tested in owed.test.ts. Tests share
// one D1, so each names its own.

const leaveOpen = (user: SignedIn["user"], itemId: string, extra: { customerId?: string } = {}) =>
  runTest(recordSelection({ items: [{ itemId, quantity: 1 }], ...extra }).pipe(as(user)));

/**
 * A Bill left Open on the real clock, which is the one the Worker reads: the
 * test clock under `runTest` would date it 1969, older than every other Day.
 */
const leaveOpenToday = (user: SignedIn["user"], itemId: string) =>
  Effect.runPromise(
    recordSelection({ items: [{ itemId, quantity: 1 }] }).pipe(as(user), Effect.provide(Db.layer(env.DB))),
  );

/** Moves a Bill to a Day of the past, as a Bill left Open yesterday is. */
const setBillDay = (billId: string, day: string) =>
  runTest(
    Effect.gen(function* () {
      const db = yield* Db;
      yield* db.run("UPDATE bills SET day = ? WHERE id = ?", day, billId);
    }),
  );

describe("Por cobrar", () => {
  it("shows each Customer's owed and their oldest Open Bill's Day, the Open Bills with no Customer flagged, and the overall Owed", async () => {
    const ana = await signedIn("admin", "Ana");
    const ruiz = await savedCustomer("Familia por cobrar", { by: ana.user });
    const item = await runTest(seedItem({ name: "Del listado por cobrar", price: 1850, by: ana.user }));

    const deRuiz = await leaveOpen(ana.user, item.id, { customerId: ruiz.id });
    await setBillDay(deRuiz.id, "2020-01-02");
    const suelto = await leaveOpenToday(ana.user, item.id);
    await setBillDay(suelto.id, dayOf(Date.now() - 86_400_000));
    const deHoy = await leaveOpenToday(ana.user, item.id);

    const response = await ana.fetch("/por-cobrar");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Por cobrar");
    // Overall Owed at the top, as what is owed now: $18.50 + $18.50 + $18.50.
    expect(html).toContain("Se debe ahora");
    expect(html).toMatch(/data-figure="owed"[^>]*>\$55\.50</);
    // The Customer row links to their page and shows what they owe and the Day
    // of their oldest Open Bill.
    expect(html).toContain(`href="/clientes/${ruiz.id}"`);
    expect(html).toContain("Familia por cobrar");
    expect(html).toContain(formatDay("2020-01-02"));
    // The Open Bills with no Customer link to Cuenta; the one from an earlier
    // Day is flagged, the one of today is not.
    expect(html).toContain(`href="/cuentas/${suelto.id}"`);
    expect(html).toContain(`href="/cuentas/${deHoy.id}"`);
    expect(html).toContain("De un día anterior");
    expect(html.match(/De un día anterior/g)).toHaveLength(1);
  });

  it("refuses a Worker, on the page and on its data request", async () => {
    const beto = await signedIn("worker", "Beto");

    const page = await beto.fetch("/por-cobrar");
    const data = await beto.fetch("/por-cobrar.data");

    expect(page.status).toBe(403);
    expect(data.status).toBe(403);
    expect(await page.text()).not.toContain("Por cobrar");
  });
});
