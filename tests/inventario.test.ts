import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { listInventory, recordAdjustment } from "~/backend/inventory";
import { stockOf } from "~/backend/stock";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { runTest } from "./support/effect";

// Inventario through the Worker: what the route lets in, how it reads a form,
// and what it answers. The rules themselves are tested in inventory.test.ts.

const post = (who: SignedIn, fields: Record<string, string>) =>
  who.fetch("/inventario", { method: "POST", body: new URLSearchParams(fields) });

const stock = (admin: SignedIn, itemId: string) => runTest(stockOf(itemId).pipe(as(admin.user)));

describe("a Worker", () => {
  it("is refused every Inventario loader and action, and never sees a Stock number", async () => {
    const ana = await signedIn("admin");
    const beto = await signedIn("worker");
    const item = await runTest(seedItem({ name: "Intocable de inventario", startingStock: 7, by: ana.user }));
    const { id } = await runTest(
      recordAdjustment({ itemId: item.id, reason: "restock", units: 1 }).pipe(as(ana.user)),
    );
    const before = await runTest(listInventory.pipe(as(ana.user)));

    const requests: Array<[string, Promise<Response>]> = [
      ["GET /inventario", beto.fetch("/inventario")],
      ["GET /inventario.data", beto.fetch("/inventario.data")],
      ["record", post(beto, { intent: "record-adjustment", itemId: item.id, reason: "restock", units: "1" })],
      ["cancel", post(beto, { intent: "cancel-adjustment", adjustmentId: id, reason: "De Beto" })],
      ["no intent", post(beto, {})],
    ];

    for (const [what, request] of requests) {
      const response = await request;
      expect(response.status, what).toBe(403);
      expect(await response.text(), what).not.toContain("Intocable de inventario");
    }
    expect(await runTest(listInventory.pipe(as(ana.user)))).toEqual(before);
  });
});

describe("an Admin", () => {
  it("sees each stock-tracked Item's Stock and Minimum, flagged for restocking and for zero below", async () => {
    const ana = await signedIn("admin");
    const category = await runTest(seedCategory("Inventario visible", ana.user));
    await runTest(seedItem({ name: "Con mínimo justo", categoryId: category.id, startingStock: 5, minimum: 5, by: ana.user }));
    await runTest(seedItem({ name: "Con todo", categoryId: category.id, startingStock: 6, minimum: 5, by: ana.user }));
    const negative = await runTest(seedItem({ name: "En negativo", categoryId: category.id, startingStock: 1, by: ana.user }));
    await runTest(recordAdjustment({ itemId: negative.id, reason: "waste", units: 2 }).pipe(as(ana.user)));

    const response = await ana.fetch("/inventario");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Inventario");
    expect(html).toContain("Existencias: 5 · Mínimo: 5");
    expect(html).toContain("Existencias: 6 · Mínimo: 5");
    expect(html).toContain("Existencias: -1 · Mínimo: —");
    expect(html).toContain("Reponer");
    expect(html).toContain("Bajo cero");
  });

  it("records an Adjustment through the form and lists it among the recent ones", async () => {
    const ana = await signedIn("admin");
    const item = await runTest(seedItem({ name: "Por la ruta", by: ana.user }));

    const response = await post(ana, {
      intent: "record-adjustment",
      itemId: item.id,
      reason: "restock",
      units: "4",
      note: "Entrega de la semana",
    });

    expect(response.status).toBe(200);
    expect(await stock(ana, item.id)).toBe(4);
    const html = await (await ana.fetch("/inventario")).text();
    expect(html).toContain("Entrada +4");
    expect(html).toContain("Entrega de la semana");
    expect(html).toContain("Ana");
  });

  it("cancels an Adjustment through the form, reversing its Stock", async () => {
    const ana = await signedIn("admin");
    const item = await runTest(seedItem({ name: "Cancelable por la ruta", by: ana.user }));
    const { id } = await runTest(
      recordAdjustment({ itemId: item.id, reason: "waste", units: 3 }).pipe(as(ana.user)),
    );
    expect(await stock(ana, item.id)).toBe(-3);

    const response = await post(ana, { intent: "cancel-adjustment", adjustmentId: id, reason: "Se registró mal" });

    expect(response.status).toBe(200);
    expect(await stock(ana, item.id)).toBe(0);
    const html = await (await ana.fetch("/inventario")).text();
    expect(html).toContain("Cancelado: Se registró mal");
  });

  it("answers 400 or 404 for every form it cannot honour, and writes nothing", async () => {
    const ana = await signedIn("admin");
    const category = await runTest(seedCategory("Rechazos de inventario", ana.user));
    const tracked = await runTest(seedItem({ name: "Ajustable", categoryId: category.id, by: ana.user }));
    const untracked = await runTest(
      seedItem({ name: "Preparado al momento", categoryId: category.id, stockTracked: false, by: ana.user }),
    );
    const { id } = await runTest(
      recordAdjustment({ itemId: tracked.id, reason: "restock", units: 2 }).pipe(as(ana.user)),
    );

    const refuses = async (fields: Record<string, string>, status: number, message: string) => {
      const response = await post(ana, fields);
      expect(response.status, JSON.stringify(fields)).toBe(status);
      if (status === 400) expect(await response.text(), JSON.stringify(fields)).toContain(message);
    };

    await refuses({ intent: "record-adjustment", itemId: tracked.id, reason: "regalo", units: "1" }, 400, "Elige un motivo.");
    await refuses({ intent: "record-adjustment", itemId: tracked.id, reason: "restock", units: "0" }, 400, "Las unidades deben ser un número entero, uno o más.");
    await refuses({ intent: "record-adjustment", itemId: tracked.id, reason: "restock", units: "dos" }, 400, "Las unidades deben ser un número entero, uno o más.");
    await refuses({ intent: "record-adjustment", itemId: untracked.id, reason: "restock", units: "1" }, 400, "Este producto no lleva inventario.");
    await refuses({ intent: "record-adjustment", itemId: "no-existe", reason: "restock", units: "1" }, 404, "");
    await refuses({ intent: "cancel-adjustment", adjustmentId: id, reason: "  " }, 400, "Escribe el motivo de la cancelación.");
    await refuses({ intent: "cancel-adjustment", adjustmentId: "no-existe", reason: "porque sí" }, 404, "");
    await refuses({ intent: "borrar-todo" }, 400, "No entendimos esa acción.");

    expect((await post(ana, { intent: "cancel-adjustment", adjustmentId: id, reason: "Primera" })).status).toBe(200);
    await refuses({ intent: "cancel-adjustment", adjustmentId: id, reason: "Segunda" }, 400, "Este ajuste ya fue cancelado.");

    expect(await stock(ana, tracked.id)).toBe(0);
    expect(await stock(ana, untracked.id)).toBe(0);
  });
});
