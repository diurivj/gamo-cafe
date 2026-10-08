import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { recordSelection } from "~/backend/bills";
import { Db } from "~/backend/db";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { runTest } from "./support/effect";

// Día through the Worker (spec §4.1, §6.2, §10.6): Admin only, a page for an
// Admin, and a refused range answered 400 in words. What range is read, and
// what is in it, are rules of `everyonesDay`, tested on the operation where
// the clock can be moved (`dia.test.ts`); the route's own default comes from
// the real clock, as the Worker does.

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

  it("answers a range it refuses with 400, the reason, and no figures", async () => {
    const ana = await signedIn("admin", "Ana");
    const refusals = [
      ["desde=2026-09-02&hasta=2026-09-01", "La fecha final no puede ser anterior a la inicial."],
      ["desde=ayer&hasta=2026-09-01", "La fecha inicial no es una fecha válida."],
      ["desde=2026-09-01&hasta=2026-02-31", "La fecha final no es una fecha válida."],
    ] as const;

    for (const [query, reason] of refusals) {
      const response = await ana.fetch(`/dia?${query}`);
      expect(response.status, query).toBe(400);
      const html = await response.text();

      expect(html, query).toContain(reason);
      // The fields are still there to ask again; no range is named and nothing is shown for one.
      expect(html, query).toContain('name="desde"');
      expect(html, query).not.toContain("de septiembre de 2026");
      expect(html, query).not.toContain("Totales");
      expect(html, query).not.toContain("Productos vendidos");
    }
  });
});
