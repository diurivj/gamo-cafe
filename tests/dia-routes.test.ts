import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { recordSelection } from "~/backend/bills";
import { Db } from "~/backend/db";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { advanceClock, runTest, setClock } from "./support/effect";

// Día through the Worker (spec §4.1, §6.2, §5.9, §10.6): Admin only, defaults
// to today, and answers for a date or a from–to range from the query string.
// Records made with the test clock land on past Days, which the route then
// reads; the route's own default comes from the real clock, as the Worker does.

/** Records a selection, with a Payment when a method is given. */
const sell = (
  user: SignedIn["user"],
  itemId: string,
  quantity: number,
  method?: "cash" | "transfer",
) =>
  Effect.runPromise(
    recordSelection(
      method
        ? { items: [{ itemId, quantity }], payment: { method } }
        : { items: [{ itemId, quantity }] },
    ).pipe(as(user), Effect.provide(Db.layer(env.DB))),
  );

describe("Día", () => {
  it("refuses a Worker", async () => {
    const beto = await signedIn("worker", "Beto");

    expect((await beto.fetch("/dia")).status).toBe(403);
    // The client-side navigation asks for `.data`, and the refusal holds.
    expect((await beto.fetch("/dia.data")).status).toBe(403);
  });

  it("shows an Admin the Day's figures, per User and Items sold, defaulting to today", async () => {
    const ana = await signedIn("admin", "Ana");
    const beto = await signedIn("worker", "Beto");
    const item = await runTest(seedItem({ name: "Del día de la ruta", price: 2500 }));
    await sell(ana.user, item.id, 2, "cash");
    await sell(beto.user, item.id, 1, "transfer");

    const response = await ana.fetch("/dia");
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain("Día");
    expect(html).toContain("Vendido");
    expect(html).toContain("Cobrado");
    expect(html).toContain("Efectivo");
    expect(html).toContain("Transferencia");
    // $50.00 sold in cash by Ana, $25.00 by transfer to Beto.
    expect(html).toContain("$50.00");
    expect(html).toContain("$75.00");
    expect(html).toContain("Ana");
    expect(html).toContain("Beto");
    expect(html).toContain("Del día de la ruta");
    expect(html).toContain("Cantidad: 3");
  });

  it("answers for a Day or a from–to range from the query string", async () => {
    const ana = await signedIn("admin", "Ana");
    const item = await runTest(seedItem({ name: "Del rango de la ruta", price: 1000 }));
    await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-09-01T10:00:00");
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 1 }] }).pipe(as(ana.user));
        yield* advanceClock("1 day");
        yield* recordSelection({ items: [{ itemId: item.id, quantity: 2 }] }).pipe(as(ana.user));
      }),
    );

    const one = await (await ana.fetch("/dia?desde=2026-09-01&hasta=2026-09-01")).text();
    expect(one).toContain("martes, 1 de septiembre de 2026");
    expect(one).toContain("$10.00");
    expect(one).toContain("Cantidad: 1");
    expect(one).not.toContain("$30.00");

    const range = await (await ana.fetch("/dia?desde=2026-09-01&hasta=2026-09-02")).text();
    expect(range).toContain("Del rango de la ruta");
    expect(range).toContain("Cantidad: 3");
    expect(range).toContain("$30.00");
  });

  it("refuses a range whose end is before its start, in words", async () => {
    const ana = await signedIn("admin", "Ana");

    const response = await ana.fetch("/dia?desde=2026-09-02&hasta=2026-09-01");
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain("La fecha final no puede ser anterior a la inicial.");
    expect(html).not.toContain("Productos vendidos");
  });

  it("falls back to today for a date it cannot read", async () => {
    const ana = await signedIn("admin", "Ana");
    const item = await runTest(seedItem({ name: "Del respaldo de la ruta", price: 7777 }));
    await sell(ana.user, item.id, 1, "transfer");

    for (const query of ["desde=ayer&hasta=2026-13-40", "desde=2026-02-31&hasta=2026-02-31"]) {
      const html = await (await ana.fetch(`/dia?${query}`)).text();

      expect(html, query).toContain("Del respaldo de la ruta");
      expect(html, query).toContain("$77.77");
      expect(html, query).toContain("Transferencia");
    }
  });
});
