import { describe, expect, it } from "vitest";

import { listRecentAdjustments } from "~/backend/inventory";
import { stockOf } from "~/backend/stock";
import { INTERNAL_USE_PATH } from "~/shared/internal-use";
import { adjustmentProblems } from "~/shared/stock-change";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { runTest } from "./support/effect";
import { recordStockChange, sendInternalUse } from "./support/sales";

// Consumo interno through the Worker (spec §4.1, §4.2): what the screen
// offers and shows, what `/consumo-interno/registrar` lets in, and what it
// answers. The rules are tested in inventory.test.ts, and the screen's state
// in internal-use.test.ts.

const stock = (admin: SignedIn, itemId: string) => runTest(stockOf(itemId).pipe(as(admin.user)));

/** The Internal uses recorded on an Item, newest first, as Inventario lists them. */
const internalUsesOf = async (admin: SignedIn, itemId: string) =>
  (await runTest(listRecentAdjustments().pipe(as(admin.user)))).filter(
    (row) => row.itemId === itemId && row.reason === "internal_use",
  );

describe("the screen", () => {
  it("offers a Worker every active Item that counts its units, and no Stock anywhere", async () => {
    const ana = await signedIn("admin");
    const beto = await signedIn("worker");
    const category = await runTest(seedCategory("Consumo a la vista", ana.user));
    await runTest(
      seedItem({ name: "Agua del personal", categoryId: category.id, startingStock: 98765, minimum: 3, by: ana.user }),
    );
    await runTest(seedItem({ name: "Café al momento", categoryId: category.id, stockTracked: false, by: ana.user }));

    const response = await beto.fetch(INTERNAL_USE_PATH);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Consumo interno");
    expect(html).toContain("Agua del personal");
    // Prepared to order: it has no units to take off.
    expect(html).not.toContain("Café al momento");
    expect(html, "no Stock number").not.toContain("98765");
    for (const word of ["Existencias", "Mínimo", "Reponer", "Bajo cero", "Historial"]) {
      expect(html, `no «${word}»`).not.toContain(word);
    }
    // What the browser's router reads for the screen carries none of it either.
    const data = await beto.fetch(`${INTERNAL_USE_PATH}.data`);
    expect(data.status).toBe(200);
    expect(await data.text()).not.toContain("98765");
  });

  it("is an Admin's screen too", async () => {
    const ana = await signedIn("admin");
    const response = await ana.fetch(INTERNAL_USE_PATH);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Consumo interno");
  });
});

describe("recording", () => {
  it("lets a Worker take units off an Item, under their name, and answers no Stock", async () => {
    const ana = await signedIn("admin");
    const beto = await signedIn("worker", "Beto Consume");
    const item = await runTest(seedItem({ name: "Refresco del personal", startingStock: 12, by: ana.user }));

    const sent = await sendInternalUse(beto, { itemId: item.id, units: "2", note: " Comida ", submissionKey: "consumo-1" });

    expect(sent.response.status).toBe(200);
    expect(Object.keys(sent.internalUse ?? {})).toEqual(["id"]);
    expect(await stock(ana, item.id)).toBe(10);
    expect(await internalUsesOf(ana, item.id)).toEqual([
      expect.objectContaining({ id: sent.internalUse!.id, units: 2, note: "Comida", byName: "Beto Consume", cancellation: null }),
    ]);
  });

  it("records a form sent twice once, and answers both alike", async () => {
    const ana = await signedIn("admin");
    const beto = await signedIn("worker");
    const item = await runTest(seedItem({ name: "Consumo enviado dos veces", startingStock: 5, by: ana.user }));
    const form = { itemId: item.id, units: "1", note: "", submissionKey: "consumo-repetido" };

    const first = await sendInternalUse(beto, form);
    const again = await sendInternalUse(beto, form);

    expect(again.internalUse).toEqual(first.internalUse);
    expect(await stock(ana, item.id)).toBe(4);
    expect(await internalUsesOf(ana, item.id)).toHaveLength(1);
  });

  it("refuses what it cannot record, with its reason, and writes nothing", async () => {
    const ana = await signedIn("admin");
    const beto = await signedIn("worker");
    const category = await runTest(seedCategory("Consumo rechazado", ana.user));
    const counted = await runTest(seedItem({ name: "Con unidades", categoryId: category.id, startingStock: 3, by: ana.user }));
    const prepared = await runTest(seedItem({ name: "Sin unidades", categoryId: category.id, stockTracked: false, by: ana.user }));

    const refusals: Array<[string, Record<string, string>, number, string]> = [
      ["no Item", { itemId: "", units: "1" }, 400, adjustmentProblems.itemMissing],
      ["no units", { itemId: counted.id, units: "" }, 400, adjustmentProblems.unitsInvalid],
      ["zero", { itemId: counted.id, units: "0" }, 400, adjustmentProblems.unitsInvalid],
      ["words", { itemId: counted.id, units: "dos" }, 400, adjustmentProblems.unitsInvalid],
      ["not stock-tracked", { itemId: prepared.id, units: "1" }, 400, "Ese producto ya no lleva inventario: su consumo no se registra aquí."],
      ["not there", { itemId: "no-existe", units: "1" }, 404, "Ese producto ya no existe."],
    ];
    for (const [what, fields, status, error] of refusals) {
      const sent = await sendInternalUse(beto, fields);
      expect(sent.response.status, what).toBe(status);
      expect(sent.error, what).toBe(error);
    }

    expect(await stock(ana, counted.id)).toBe(3);
    expect(await internalUsesOf(ana, counted.id)).toEqual([]);
    expect(await internalUsesOf(ana, prepared.id)).toEqual([]);
  });

  it("leaves cancelling it to an Admin, on Inventario", async () => {
    const ana = await signedIn("admin");
    const beto = await signedIn("worker");
    const item = await runTest(seedItem({ name: "Consumo que se cancela", startingStock: 4, by: ana.user }));
    const { internalUse } = await sendInternalUse(beto, { itemId: item.id, units: "4" });
    expect(await stock(ana, item.id)).toBe(0);

    const byWorker = await recordStockChange(beto, { intent: "cancelar", adjustmentId: internalUse!.id, reason: "Me equivoqué" });
    expect(byWorker.response.status).toBe(403);
    expect(await stock(ana, item.id)).toBe(0);

    const byAdmin = await recordStockChange(ana, { intent: "cancelar", adjustmentId: internalUse!.id, reason: "No se consumió" });
    expect(byAdmin.change).toEqual({ stock: 4 });
  });
});
