import { describe, expect, it } from "vitest";

import { listInventory, listRecentAdjustments, recordAdjustment } from "~/backend/inventory";
import { stockOf } from "~/backend/stock";
import { adjustHref, ADJUSTMENTS_HREF, cancelHref, STOCK_CHANGE_PATH } from "~/shared/stock-change";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { runTest } from "./support/effect";
import { recordStockChange } from "./support/sales";

// Inventario through the Worker: what the screen and its steps show, what
// `/inventario/ajustar` lets in, how it reads a change of Stock, and what it
// answers. The rules themselves are tested in inventory.test.ts, and the
// screen's state in stock-change.test.ts.

const stock = (admin: SignedIn, itemId: string) => runTest(stockOf(itemId).pipe(as(admin.user)));

/** The Adjustments recorded on an Item, newest first. */
const adjustmentsOf = async (admin: SignedIn, itemId: string) =>
  (await runTest(listRecentAdjustments().pipe(as(admin.user)))).filter((row) => row.itemId === itemId);

/** One Item's row of the list, as text. */
const rowOf = (html: string, name: string) => {
  const row = new RegExp(`<li[^>]*aria-label="${name}"[^>]*>(.*?)</li>`, "s").exec(html)?.[1];
  expect(row, `the row of ${name}`).toBeTruthy();
  return row!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
};

describe("a Worker", () => {
  it("is refused the screen, its steps and every change of Stock, and never sees a Stock number", async () => {
    const ana = await signedIn("admin");
    const beto = await signedIn("worker");
    const item = await runTest(seedItem({ name: "Intocable de inventario", startingStock: 7, by: ana.user }));
    const { id } = await runTest(
      recordAdjustment({ itemId: item.id, reason: "restock", units: 1 }).pipe(as(ana.user)),
    );
    const before = await runTest(listInventory.pipe(as(ana.user)));
    const adjustmentsBefore = await adjustmentsOf(ana, item.id);

    const requests: Array<[string, Promise<Response>]> = [
      ["GET /inventario", beto.fetch("/inventario")],
      ["GET /inventario.data", beto.fetch("/inventario.data")],
      ["the step that adjusts", beto.fetch(adjustHref({ itemId: item.id }))],
      ["the recent Adjustments", beto.fetch(ADJUSTMENTS_HREF)],
      ["the step that cancels", beto.fetch(cancelHref(id))],
      ["record", recordStockChange(beto, { intent: "registrar", itemId: item.id, reason: "restock", units: "1" }).then((sent) => sent.response)],
      ["cancel", recordStockChange(beto, { intent: "cancelar", adjustmentId: id, reason: "De Beto" }).then((sent) => sent.response)],
      ["no intent", recordStockChange(beto, {}).then((sent) => sent.response)],
    ];

    for (const [what, request] of requests) {
      const response = await request;
      expect(response.status, what).toBe(403);
      expect(await response.text(), what).not.toContain("Intocable de inventario");
    }
    expect(await runTest(listInventory.pipe(as(ana.user)))).toEqual(before);
    expect(await adjustmentsOf(ana, item.id)).toEqual(adjustmentsBefore);
  });
});

describe("an Admin", () => {
  it("sees each stock-tracked Item's Stock and Minimum, with what to mind in words", async () => {
    const ana = await signedIn("admin");
    const category = await runTest(seedCategory("Inventario visible", ana.user));
    await runTest(seedItem({ name: "Con mínimo justo", categoryId: category.id, startingStock: 5, minimum: 5, by: ana.user }));
    await runTest(seedItem({ name: "Con todo", categoryId: category.id, startingStock: 6, minimum: 5, by: ana.user }));
    const negative = await runTest(seedItem({ name: "En negativo", categoryId: category.id, startingStock: 1, by: ana.user }));
    await runTest(recordAdjustment({ itemId: negative.id, reason: "waste", units: 2 }).pipe(as(ana.user)));
    await runTest(seedItem({ name: "Hecho al momento", categoryId: category.id, stockTracked: false, by: ana.user }));

    const response = await ana.fetch("/inventario");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(rowOf(html, "Con mínimo justo")).toMatch(/Reponer.*Existencias 5 Mínimo 5/);
    expect(rowOf(html, "Con mínimo justo")).not.toContain("Bajo cero");
    expect(rowOf(html, "Con todo")).toMatch(/Existencias 6 Mínimo 5/);
    expect(rowOf(html, "Con todo")).not.toContain("Reponer");
    expect(rowOf(html, "En negativo")).toMatch(/Bajo cero.*Existencias -1 Sin mínimo/);
    expect(rowOf(html, "En negativo")).not.toContain("Reponer");
    expect(html).not.toContain("Hecho al momento");
    // The ways on are there, and no form of theirs is.
    for (const way of ["Registrar entrada", "Contar existencias", "Registrar merma o consumo interno", "Ajustes recientes"]) {
      expect(html, way).toContain(way);
    }
    expect(html).toContain('href="/inventario/conteo"');
    expect(html).toContain('href="/diferencias"');
    expect(html).not.toContain("Motivo de la cancelación");
  });

  it("opens the step that adjusts with the Item and the reason its address names", async () => {
    const ana = await signedIn("admin");
    const item = await runTest(seedItem({ name: "Abierto por su dirección", startingStock: 3, minimum: 1, by: ana.user }));

    const html = await (await ana.fetch(adjustHref({ itemId: item.id, reason: "waste" }))).text();

    expect(html).toContain("Registrar merma");
    expect(html).toContain("Abierto por su dirección: 3 en existencias, mínimo 1.");
    expect(html).toMatch(new RegExp(`<option[^>]*value="${item.id}"[^>]*selected`));
  });

  it("records an Adjustment, answers the Stock it left, and lists it among the recent ones", async () => {
    const ana = await signedIn("admin");
    const item = await runTest(seedItem({ name: "Por la ruta", by: ana.user }));

    const { response, change } = await recordStockChange(ana, {
      intent: "registrar",
      itemId: item.id,
      reason: "restock",
      units: "4",
      note: "Entrega de la semana",
    });

    expect(response.status).toBe(200);
    expect(change).toEqual({ stock: 4 });
    expect(await stock(ana, item.id)).toBe(4);
    const html = await (await ana.fetch(ADJUSTMENTS_HREF)).text();
    expect(html).toContain("Entrada +4 · Por la ruta");
    expect(html).toContain("Entrega de la semana");
    expect(html).toContain("Ana");
  });

  it("cancels an Adjustment, reversing its Stock, and answers the same cancellation sent again", async () => {
    const ana = await signedIn("admin");
    const item = await runTest(seedItem({ name: "Cancelable por la ruta", by: ana.user }));
    const { id } = await runTest(
      recordAdjustment({ itemId: item.id, reason: "waste", units: 3 }).pipe(as(ana.user)),
    );
    expect(await stock(ana, item.id)).toBe(-3);
    const step = await (await ana.fetch(cancelHref(id))).text();
    expect(step).toContain("Suma 3: Cancelable por la ruta pasa de -3 a 0 en existencias.");

    const cancellation = { intent: "cancelar", adjustmentId: id, reason: "Se registró mal" };
    const first = await recordStockChange(ana, cancellation);

    expect([first.response.status, first.change]).toEqual([200, { stock: 0 }]);
    expect(await stock(ana, item.id)).toBe(0);
    expect(await (await ana.fetch(ADJUSTMENTS_HREF)).text()).toContain("Cancelado: Se registró mal");

    // Its answer was lost and it is sent again: the same answer, nothing reversed twice.
    const again = await recordStockChange(ana, { ...cancellation, reason: " Se registró mal " });
    expect([again.response.status, again.change]).toEqual([200, { stock: 0 }]);
    expect(await stock(ana, item.id)).toBe(0);

    // Another reason, or another Admin, is not that cancellation.
    const other = await recordStockChange(ana, { ...cancellation, reason: "Otra razón" });
    expect([other.response.status, other.error]).toEqual([400, "Este ajuste ya fue cancelado."]);
    const carla = await signedIn("admin", "Carla");
    const theirs = await recordStockChange(carla, cancellation);
    expect([theirs.response.status, theirs.error]).toEqual([400, "Este ajuste ya fue cancelado."]);
    expect(await stock(ana, item.id)).toBe(0);
    // The step of a cancelled Adjustment says so and offers nothing.
    expect(await (await ana.fetch(cancelHref(id))).text()).toContain("Este ajuste ya fue cancelado.");
  });

  it("answers 400 or 404 with its reason for every change it cannot honour, and writes nothing", async () => {
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
      const { response, error, change } = await recordStockChange(ana, fields);
      expect([response.status, error, change], JSON.stringify(fields)).toEqual([status, message, undefined]);
    };
    const units = "Las unidades deben ser un número entero, uno o más.";

    await refuses({ intent: "registrar", itemId: tracked.id, reason: "regalo", units: "1" }, 400, "Elige un motivo.");
    await refuses({ intent: "registrar", itemId: tracked.id, reason: "restock", units: "0" }, 400, units);
    await refuses({ intent: "registrar", itemId: tracked.id, reason: "restock", units: "dos" }, 400, units);
    await refuses({ intent: "registrar", itemId: untracked.id, reason: "restock", units: "1" }, 400, "Este producto no lleva inventario.");
    await refuses({ intent: "registrar", itemId: "no-existe", reason: "restock", units: "1" }, 404, "Ese producto ya no existe.");
    await refuses({ intent: "cancelar", adjustmentId: id, reason: "  " }, 400, "Escribe el motivo de la cancelación.");
    await refuses({ intent: "cancelar", adjustmentId: "no-existe", reason: "porque sí" }, 404, "Ese ajuste ya no existe.");
    await refuses({ intent: "borrar-todo" }, 400, "No entendimos esa acción. Recarga la página e intenta de nuevo.");

    expect(await stock(ana, tracked.id)).toBe(2);
    expect(await stock(ana, untracked.id)).toBe(0);
    expect(await adjustmentsOf(ana, tracked.id)).toHaveLength(1);
  });

  it("has no form of its own: the screen takes no POST", async () => {
    const ana = await signedIn("admin");
    const response = await ana.fetch("/inventario", { method: "POST", body: new URLSearchParams({ intent: "registrar" }) });
    expect(response.status).toBe(405);
    expect(STOCK_CHANGE_PATH).toBe("/inventario/ajustar");
  });
});
