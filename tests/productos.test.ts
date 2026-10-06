import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { activeItemsByCategory, listCatalog } from "~/backend/catalog";
import { listAdjustments, stockOf } from "~/backend/stock";

import { as, signedIn, type SignedIn } from "./support/auth";
import { seedCategory, seedItem } from "./support/catalog";
import { runTest } from "./support/effect";

// Productos through the Worker: what the routes let in, how they read a form,
// and what they answer. The rules themselves are tested in catalog.test.ts.

const post = (who: SignedIn, path: string, fields: Record<string, string>) =>
  who.fetch(path, { method: "POST", body: new URLSearchParams(fields) });

/** The catalog as an Admin's Productos reads it. */
const catalog = (admin: SignedIn) => runTest(listCatalog.pipe(as(admin.user)));

describe("a Worker", () => {
  it("is refused every Productos loader and action, and nothing changes", async () => {
    const ana = await signedIn("admin");
    const beto = await signedIn("worker");
    const item = await runTest(seedItem({ name: "Intocable", by: ana.user }));
    const before = await catalog(ana);

    const item$ = `/productos/${item.id}`;
    const requests: Array<[string, Promise<Response>]> = [
      ["GET /productos", beto.fetch("/productos")],
      ["GET /productos.data", beto.fetch("/productos.data")],
      ["GET item", beto.fetch(item$)],
      ["GET item.data", beto.fetch(`${item$}.data`)],
      ["add-category", post(beto, "/productos", { intent: "add-category", name: "De Beto" })],
      ["add-item", post(beto, "/productos", { intent: "add-item", name: "De Beto", price: "10", categoryId: item.categoryId })],
      ["add-item, unreadable", post(beto, "/productos", { intent: "add-item", name: "De Beto", price: "mucho" })],
      ["rename-category", post(beto, "/productos", { intent: "rename-category", id: item.categoryId, name: "De Beto" })],
      ["move-category", post(beto, "/productos", { intent: "move-category", id: item.categoryId, direction: "earlier" })],
      ["retire-category", post(beto, "/productos", { intent: "retire-category", id: item.categoryId })],
      ["restore-category", post(beto, "/productos", { intent: "restore-category", id: item.categoryId })],
      ["no intent", post(beto, "/productos", {})],
      ["update-item", post(beto, item$, { intent: "update-item", name: "De Beto", price: "1", categoryId: item.categoryId })],
      ["retire-item", post(beto, item$, { intent: "retire-item" })],
      ["restore-item", post(beto, item$, { intent: "restore-item" })],
      ["retire-item, data request", post(beto, `${item$}.data`, { intent: "retire-item" })],
    ];

    for (const [what, request] of requests) {
      const response = await request;
      expect(response.status, what).toBe(403);
      expect(await response.text(), what).not.toContain("Intocable");
    }
    expect(await catalog(ana)).toEqual(before);
  });
});

describe("an Admin", () => {
  it("sees Categories and Items on Productos, with prices in pesos", async () => {
    const ana = await signedIn("admin");
    const bebidas = await runTest(seedCategory("Bebidas frías", ana.user));
    await runTest(seedItem({ name: "Limonada", price: 1850, categoryId: bebidas.id, by: ana.user }));

    const response = await ana.fetch("/productos");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Productos");
    expect(html).toContain("Bebidas frías");
    expect(html).toContain("Limonada");
    expect(html).toContain("$18.50");
  });

  it("adds a Category and an Item whose price is typed in pesos and whose starting Stock is a Restock", async () => {
    const ana = await signedIn("admin");

    expect((await post(ana, "/productos", { intent: "add-category", name: "Botanas" })).status).toBe(200);
    const botanas = (await catalog(ana)).find((category) => category.name === "Botanas")!;

    const response = await post(ana, "/productos", {
      intent: "add-item",
      name: "Papas con chile",
      price: "$22.50",
      categoryId: botanas.id,
      stockTracked: "on",
      minimum: "5",
      startingStock: "30",
    });

    expect(response.status).toBe(200);
    const [item] = (await catalog(ana)).find((category) => category.id === botanas.id)!.items;
    expect(item).toMatchObject({ name: "Papas con chile", price: 2250, stockTracked: true, minimum: 5, retired: false });
    expect(await runTest(stockOf(item!.id).pipe(as(ana.user)))).toBe(30);
    expect(await runTest(listAdjustments(item!.id).pipe(as(ana.user)))).toMatchObject([
      { reason: "restock", units: 30, by: ana.user.id },
    ]);
  });

  it("adds an Item that is not stock-tracked when the box is left unticked", async () => {
    const ana = await signedIn("admin");
    const category = await runTest(seedCategory("Cocina", ana.user));

    await post(ana, "/productos", { intent: "add-item", name: "Molletes", price: "45", categoryId: category.id, minimum: "", startingStock: "" });

    const [item] = (await catalog(ana)).find(({ id }) => id === category.id)!.items;
    expect(item).toMatchObject({ name: "Molletes", price: 4500, stockTracked: false, minimum: null });
  });

  it.for([
    ["a name an active Item has", { name: "CAFE FRIO" }, "Ya hay un producto activo con ese nombre."],
    ["no name", { name: " " }, "Escribe un nombre."],
    ["a price that is not an amount", { price: "veinte" }, "Escribe el precio en pesos, por ejemplo 18.50."],
    ["a price of zero", { price: "0" }, "El precio debe ser mayor a cero."],
    ["a Minimum that is not a whole number", { minimum: "2.5" }, "El mínimo debe ser un número entero, cero o más."],
    ["a starting Stock that is not a whole number", { startingStock: "-4" }, "Las existencias iniciales deben ser un número entero, cero o más."],
    ["a Category that does not exist", { categoryId: "nope" }, "Esa categoría no existe o está retirada."],
  ] as const)("is told in Spanish when an Item has %s", async ([, change, message]) => {
    const ana = await signedIn("admin");
    const category = await runTest(seedCategory(undefined, ana.user));
    await runTest(Effect.ignore(seedItem({ name: "Café frío", by: ana.user })));
    const name = `Rechazado ${message}`;

    const response = await post(ana, "/productos", { intent: "add-item", name, price: "20", categoryId: category.id, stockTracked: "on", ...change });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(message);
    expect((await catalog(ana)).flatMap(({ items }) => items.map((item) => item.name))).not.toContain(name);
  });

  it("is told why a Category with active Items cannot be retired", async () => {
    const ana = await signedIn("admin");
    const item = await runTest(seedItem({ by: ana.user }));

    const response = await post(ana, "/productos", { intent: "retire-category", id: item.categoryId });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Esta categoría tiene productos activos.");
  });

  it("renames, moves, retires and restores a Category", async () => {
    const ana = await signedIn("admin");
    const first = await runTest(seedCategory("Primera", ana.user));
    const second = await runTest(seedCategory("Segunda", ana.user));
    const ours = async () =>
      (await catalog(ana)).filter(({ id }) => id === first.id || id === second.id).map(({ name, retired }) => [name, retired]);

    await post(ana, "/productos", { intent: "move-category", id: second.id, direction: "earlier" });
    await post(ana, "/productos", { intent: "rename-category", id: first.id, name: "Última" });
    await post(ana, "/productos", { intent: "retire-category", id: second.id });
    expect(await ours()).toEqual([["Segunda", true], ["Última", false]]);

    await post(ana, "/productos", { intent: "restore-category", id: second.id });
    expect(await ours()).toEqual([["Segunda", false], ["Última", false]]);
  });

  it("edits an Item on its own page, then retires and restores it", async () => {
    const ana = await signedIn("admin");
    const item = await runTest(seedItem({ name: "Tamal", price: 2000, by: ana.user }));
    const path = `/productos/${item.id}`;
    const sold = async () =>
      (await runTest(activeItemsByCategory)).flatMap(({ items }) => items).find(({ id }) => id === item.id);

    const page = await ana.fetch(path);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Tamal");

    const saved = await post(ana, path, { intent: "update-item", name: "Tamal verde", price: "25.5", categoryId: item.categoryId, stockTracked: "on", minimum: "4" });
    expect(saved.status).toBe(302);
    expect(saved.headers.get("Location")).toBe("/productos");
    expect(await sold()).toEqual({ id: item.id, name: "Tamal verde", price: 2550 });

    await post(ana, path, { intent: "retire-item" });
    expect(await sold()).toBeUndefined();

    await post(ana, path, { intent: "restore-item" });
    expect(await sold()).toEqual({ id: item.id, name: "Tamal verde", price: 2550 });
  });

  it("gets a 404 for an Item that does not exist and a 400 for a form the page never sends", async () => {
    const ana = await signedIn("admin");

    expect((await ana.fetch("/productos/nope")).status).toBe(404);
    expect((await post(ana, "/productos/nope", { intent: "retire-item" })).status).toBe(404);
    expect((await post(ana, "/productos", { intent: "delete-everything" })).status).toBe(400);
  });
});
