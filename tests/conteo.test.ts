import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { listCounts } from "~/backend/counts";
import { listInventory } from "~/backend/inventory";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { runTest } from "./support/effect";

// Conteo and Diferencias through the Worker: the entry step shows no expected
// numbers, the review shows expected, found and difference, and confirming
// records the Count and lands on Diferencias. The rules are tested in
// counts.test.ts.

const post = (who: SignedIn, fields: Record<string, string>) =>
  who.fetch("/inventario/conteo", { method: "POST", body: new URLSearchParams(fields) });

/** An Admin with a fresh shelf: two counted Items (47 and 12) and one untracked. */
let shelfSerial = 0;
async function shelf() {
  const serial = ++shelfSerial;
  const ana = await signedIn("admin", `Ana del conteo ${serial}`);
  const category = await runTest(seedCategory(`Conteo por la ruta ${serial}`, ana.user));
  const cafe = await runTest(
    seedItem({ name: `Café de olla ${serial}`, categoryId: category.id, startingStock: 47, by: ana.user }),
  );
  const pan = await runTest(
    seedItem({ name: `Pan dulce ${serial}`, categoryId: category.id, startingStock: 12, by: ana.user }),
  );
  const untracked = await runTest(
    seedItem({
      name: `Preparado al momento ${serial}`,
      categoryId: category.id,
      stockTracked: false,
      by: ana.user,
    }),
  );
  return { ana, cafe, pan, untracked };
}

const stockNow = (who: SignedIn, itemId: string) =>
  runTest(listInventory.pipe(as(who.user))).then((lines) => lines.find((line) => line.id === itemId)!.stock);

describe("the entry step", () => {
  it("lists Item names and no expected numbers", async () => {
    const { ana, cafe, pan, untracked } = await shelf();

    const response = await ana.fetch("/inventario/conteo");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(cafe.name);
    expect(html).toContain(pan.name);
    expect(html).not.toContain(untracked.name);
    expect(html).not.toContain("Existencias");
    expect(html).not.toContain("Esperado");
    expect(html).not.toContain('value="47"');

    // The loader data itself carries a name and nothing about Stock.
    const body = await (await ana.fetch("/inventario/conteo.data")).text();
    expect(body).toContain(cafe.name);
    expect(body).not.toContain("stock");
    expect(body).not.toContain("expected");
    expect(body).not.toContain("Existencias");
  });
});

describe("the review step", () => {
  it("shows expected, found and difference, and records nothing", async () => {
    const { ana, cafe, pan } = await shelf();
    const before = (await runTest(listCounts().pipe(as(ana.user)))).length;

    const response = await post(ana, {
      intent: "review",
      [`units.${cafe.id}`]: "45",
      [`units.${pan.id}`]: "14",
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Esperado: 47");
    expect(html).toContain("Contado: 45");
    expect(html).toContain("Faltante: 2");
    expect(html).toContain("Sobrante: 2");
    expect(html).toContain("Confirmar conteo");

    expect((await runTest(listCounts().pipe(as(ana.user)))).length).toBe(before);
    expect(await stockNow(ana, cafe.id)).toBe(47);
    expect(await stockNow(ana, pan.id)).toBe(12);
  });
});

describe("confirming", () => {
  it("sets Stock to the units found, records every Discrepancy and lands on Diferencias", async () => {
    const { ana, cafe, pan } = await shelf();

    const response = await post(ana, {
      intent: "confirm",
      note: "Conteo de la tarde",
      [`units.${cafe.id}`]: "45",
      [`units.${pan.id}`]: "12",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/diferencias");
    expect(await stockNow(ana, cafe.id)).toBe(45);
    expect(await stockNow(ana, pan.id)).toBe(12);

    const html = await (await ana.fetch("/diferencias")).text();
    expect(html).toContain("Diferencias");
    expect(html).toContain(cafe.name);
    expect(html).toContain("Esperado: 47");
    expect(html).toContain("Contado: 45");
    expect(html).toContain("Faltante: 2");
    expect(html).toContain("Pan dulce");
    expect(html).toContain("Sin diferencia");
    expect(html).toContain("Conteo de la tarde");
  });

  it("answers 404 and writes nothing for an Item that does not exist", async () => {
    const { ana, cafe } = await shelf();
    const before = (await runTest(listCounts().pipe(as(ana.user)))).length;

    const response = await post(ana, {
      intent: "confirm",
      [`units.${cafe.id}`]: "45",
      "units.no-existe": "1",
    });

    expect(response.status).toBe(404);
    expect((await runTest(listCounts().pipe(as(ana.user)))).length).toBe(before);
    expect(await stockNow(ana, cafe.id)).toBe(47);
  });
});

describe("the forms the Conteo route cannot honour", () => {
  it("answers 400 in Spanish for units it cannot read, an empty Count and an unknown action", async () => {
    const { ana, cafe } = await shelf();

    const refuses = async (fields: Record<string, string>, message: string) => {
      const response = await post(ana, fields);
      expect(response.status, JSON.stringify(fields)).toBe(400);
      expect(await response.text(), JSON.stringify(fields)).toContain(message);
    };

    await refuses({ intent: "review", [`units.${cafe.id}`]: "dos" }, "Las unidades contadas deben ser un número entero, cero o más.");
    await refuses({ intent: "review", note: "nada" }, "Escribe las unidades de al menos un producto.");
    await refuses({ intent: "borrar-todo" }, "No entendimos esa acción.");
  });

  it("answers 400 for an Item that does not count its units, and writes nothing", async () => {
    const { ana, cafe } = await shelf();
    const untracked = await runTest(
      seedItem({ name: "Sin inventario contable", stockTracked: false, by: ana.user }),
    );
    const response = await post(ana, {
      intent: "review",
      [`units.${cafe.id}`]: "45",
      [`units.${untracked.id}`]: "1",
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Este producto no lleva inventario.");
  });

  it("answers 404 for an Item that does not exist", async () => {
    const { ana } = await shelf();
    const response = await post(ana, { intent: "review", "units.no-existe": "1" });
    expect(response.status).toBe(404);
  });
});

describe("a Worker", () => {
  it("is refused Conteo and Diferencias, and never records a Count", async () => {
    const { ana, cafe } = await shelf();
    const beto = await signedIn("worker", "Beto del conteo");

    const requests: Array<[string, Promise<Response>]> = [
      ["GET /inventario/conteo", beto.fetch("/inventario/conteo")],
      ["GET /inventario/conteo.data", beto.fetch("/inventario/conteo.data")],
      ["GET /diferencias", beto.fetch("/diferencias")],
      ["GET /diferencias.data", beto.fetch("/diferencias.data")],
      [
        "review",
        post(beto, { intent: "review", [`units.${cafe.id}`]: "1" }),
      ],
      [
        "confirm",
        post(beto, { intent: "confirm", [`units.${cafe.id}`]: "1" }),
      ],
    ];

    for (const [what, request] of requests) {
      const response = await request;
      expect(response.status, what).toBe(403);
      expect(await response.text(), what).not.toContain(cafe.name);
    }
    expect(await stockNow(ana, cafe.id)).toBe(47);
  });
});
