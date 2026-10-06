import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getBill, recordSelection } from "~/backend/bills";
import { removeLine } from "~/backend/corrections";
import { cancelAdjustment, recordAdjustment } from "~/backend/inventory";
import { formatDay, formatTime } from "~/shared/day";

import { as, seedUser, signedIn } from "./support/auth";
import { seedItem } from "./support/catalog";
import { advanceClock, runTest, setClock } from "./support/effect";

// Historial through the Worker (spec §6.2, §10.4): what the route shows, what
// it refuses, and how the page's link walks the keyset. Tests share one D1, so
// each names its own and scopes what it asserts to its own ids.

/** The entries a page rendered, by the id of the fact behind each. */
const historyIds = (html: string) =>
  [...html.matchAll(/data-history-id="([^"]+)"/g)].map((match) => match[1]!);

describe("Historial", () => {
  it("shows corrections and Adjustments with who, when and why, and links to the record", async () => {
    const seeded = await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T10:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const beto = yield* seedUser("worker", "Beto");
        const item = yield* seedItem({ name: "Historial rutas", price: 1850, by: ana });
        const bill = yield* recordSelection({ items: [{ itemId: item.id, quantity: 2 }] }).pipe(as(beto));
        const before = yield* getBill(bill.id).pipe(as(ana));

        yield* advanceClock("5 minutes");
        const removal = yield* removeLine({
          billId: bill.id,
          lineId: before.lines[0]!.id,
          reason: "Motivo de la ruta",
          expectedRevision: before.revision,
        }).pipe(as(ana));

        yield* advanceClock("5 minutes");
        const adjustment = yield* recordAdjustment({ itemId: item.id, reason: "restock", units: 7 }).pipe(
          as(ana),
        );
        yield* advanceClock("5 minutes");
        yield* cancelAdjustment(adjustment.id, "Motivo de la cancelación").pipe(as(ana));

        return { item, bill };
      }),
    );

    const admin = await signedIn("admin", "Ana");
    const response = await admin.fetch("/historial");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Historial");
    // Newest first: the cancellation, the Adjustment, the removed Line.
    const mine = [...html.matchAll(/data-history-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)]
      .map((match) => match[2]!)
      .filter((body) => body.includes("Historial rutas"));
    expect(mine).toHaveLength(3);
    expect(mine[0]).toContain("Ajuste cancelado: Entrada +7 · Historial rutas");
    expect(mine[1]).toContain("Entrada +7 · Historial rutas");
    expect(mine[1]).not.toContain("Ajuste cancelado");
    expect(mine[2]).toContain("Producto quitado: 2 × Historial rutas — $37.00");
    expect(html).toContain("Motivo:");
    expect(html).toContain("Motivo de la cancelación");
    expect(html).toContain("Motivo de la ruta");
    expect(html).toContain(`href="/productos/${seeded.item.id}"`);
    expect(html).toContain(`href="/cuentas/${seeded.bill.id}"`);
    // The author and the moment, in es-MX (spec §3.4): cancelled at 10:15.
    expect(html).toContain("Ana");
    expect(html).toContain(formatDay("2026-10-05"));
    expect(html).toContain(formatTime(Date.parse("2026-10-05T10:15:00-06:00")));
  });

  it("refuses a Worker, on the page and on its data request", async () => {
    const beto = await signedIn("worker", "Beto");

    const page = await beto.fetch("/historial");
    const data = await beto.fetch("/historial.data");

    expect(page.status).toBe(403);
    expect(data.status).toBe(403);
    expect(await page.text()).not.toContain("Producto quitado");
  });

  it("walks the keyset with the page's link, and falls back to the first page on a bad cursor", async () => {
    const seeded = await runTest(
      Effect.gen(function* () {
        yield* setClock("2026-10-05T12:00:00");
        const ana = yield* seedUser("admin", "Ana");
        const item = yield* seedItem({ name: "Historial páginas ruta", price: 1000, by: ana });
        const ids: Array<string> = [];
        for (let n = 0; n < 60; n++) {
          yield* advanceClock("1 minute");
          const adjustment = yield* recordAdjustment({ itemId: item.id, reason: "waste", units: 1 }).pipe(
            as(ana),
          );
          ids.push(adjustment.id);
        }
        return { ids: [...ids].reverse() };
      }),
    );

    const admin = await signedIn("admin", "Ana");
    const first = await admin.fetch("/historial");
    const firstHtml = await first.text();
    expect(firstHtml).toContain("Más movimientos");
    expect(historyIds(firstHtml).filter((id) => seeded.ids.includes(id))).toEqual(seeded.ids.slice(0, 50));

    // The link carries the keyset; the next page holds exactly the rest.
    const href = /href="(\/historial\?[^"]+)"/.exec(firstHtml)?.[1];
    expect(href).toBeTruthy();
    const second = await admin.fetch(href!.replaceAll("&amp;", "&"));
    const secondHtml = await second.text();
    expect(historyIds(secondHtml).filter((id) => seeded.ids.includes(id))).toEqual(seeded.ids.slice(50));
    expect(secondHtml).not.toContain("Más movimientos");

    // An unreadable cursor is no cursor: the first page, not an error.
    const bad = await admin.fetch("/historial?antes=ayer&id=");
    expect(bad.status).toBe(200);
    expect(historyIds(await bad.text()).filter((id) => seeded.ids.includes(id))).toEqual(
      seeded.ids.slice(0, 50),
    );
  });
});
