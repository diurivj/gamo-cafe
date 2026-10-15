import type { Page, Route } from "@playwright/test";

import { expect, test } from "./fixtures";
import { holdSubmissions } from "./support/held";
import { anotherInternalUse, INTERNAL_USE, recordInternalUse, typeInternalUse } from "./support/internal-use";
import { destinations, goTo } from "./support/navigate";
import { cancelAdjustment, expectStock, openAdjustments, recentAdjustments } from "./support/stock";

// Consumo interno (spec §4.1, §4.2, §5.8; UI redesign §6, §7): any User,
// a Worker included, records the units of an Item that staff consumed or gave
// away. The step shows no Stock, the Internal use is sent once, frozen, and
// said only as what is known, and cancelling it stays an Admin's, on
// Inventario. Requests are held or failed on purpose; no test waits on the
// network's own timing. Both projects run a phone viewport.

type Query = (sql: string, params?: Array<string | number | null>) => Promise<Array<Record<string, unknown>>>;

const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { name, level: 1 });
const dialog = (page: Page) => page.getByRole("alertdialog");
const nothingSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const stockOf = async (query: Query, itemId: string) =>
  (await query("SELECT units FROM stock_levels WHERE item_id = ?", [itemId]))[0]?.units ?? 0;

test("a Worker records what staff consumed from Más, sees no Stock, and an Admin finds it under their name", async ({
  page,
  signInAs,
  signIn,
  addUser,
  addCategory,
  addItem,
  query,
}) => {
  const ana = await addUser("admin", "Ana");
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  const agua = await addItem({ name: "Agua mineral", price: 1850, category: bebidas, minimum: 3, stock: { units: 98, by: ana } });
  await addItem({ name: "Café de olla", price: 2500, category: bebidas, stockTracked: false });
  await page.goto("/inicio");

  // Más offers it to a Worker, among what they record.
  await goTo(page, "Consumo interno");
  await expect(title(page, "Consumo interno")).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toContainText("Lo que tomó el personal o se regaló. No es una venta.");
  // Only what counts its units is offered, by name, and nothing says how many there are.
  const items = page.getByLabel("Producto", { exact: true }).locator("option");
  await expect(items).toHaveText(["Elige un producto", "Agua mineral"]);
  await expect(main).not.toContainText(/98|existencias|mínimo/i);

  await typeInternalUse(page, { item: "Agua mineral", units: "2", note: "Comida del turno" });
  await expect(page.getByText("Resta 2 de Agua mineral del inventario. No se cobra.")).toBeVisible();
  await expect(main).toContainText("Si te equivocas, solo un administrador puede cancelarlo.");
  await expect(main).not.toContainText(/98|96/);
  await page.getByRole("button", { name: "Registrar consumo interno de 2" }).click();

  await expect(title(page, "Consumo interno registrado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("-2 de Agua mineral.");
  await expect(main).toContainText("Si te equivocaste, pide a un administrador que lo cancele.");
  await expect(main).toContainText("Comida del turno");
  await expect(main).not.toContainText(/98|96|existencias/i);
  expect(await query("SELECT reason, units, note, recorded_by FROM adjustments WHERE item_id = ? AND reason = 'internal_use'", [agua.id])).toEqual([
    { reason: "internal_use", units: 2, note: "Comida del turno", recorded_by: beto.id },
  ]);
  expect(await stockOf(query, agua.id)).toBe(96);

  // The next one starts from nothing.
  await anotherInternalUse(page);
  await expect(page.getByLabel("Producto", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Unidades", { exact: true })).toHaveValue("");
  expect(await nothingSideways(page)).toBe(true);

  // An Admin reads it on Inventario with who recorded it, and is the one who cancels it.
  await signIn(ana);
  await page.goto("/inventario");
  await expectStock(page, "Agua mineral", 96);
  await openAdjustments(page);
  await expect(recentAdjustments(page).first()).toContainText("Consumo interno -2 · Agua mineral");
  await expect(recentAdjustments(page).first()).toContainText("Beto");
  await cancelAdjustment(page, "Consumo interno de 2 de Agua mineral", "Se anotó de más");
  expect(await stockOf(query, agua.id)).toBe(98);
});

test("an Internal use on its way is said at once, frozen, and not left by accident; one that got no answer is retried once", async ({
  page,
  signInAs,
  addUser,
  addItem,
  query,
}) => {
  const ana = await addUser("admin", "Ana");
  await signInAs("worker", "Beto");
  const pan = await addItem({ name: "Pan dulce", price: 1200, stock: { units: 10, by: ana } });
  await page.goto("/consumo-interno");
  await typeInternalUse(page, { item: "Pan dulce", units: "3" });

  const held = await holdSubmissions(page);
  await page.getByRole("button", { name: "Registrar consumo interno de 3" }).click();
  await held.waitFor(1);
  await expect(title(page, "Registrando consumo interno de 3…")).toBeFocused();
  const main = page.getByRole("main");
  // What was sent stays in sight, and nothing about it can be changed or sent again.
  await expect(main).toContainText("Pan dulce");
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByText("Consumo interno registrado")).toHaveCount(0);
  expect(await query("SELECT id FROM adjustments WHERE reason = 'internal_use'")).toHaveLength(0);

  // Leaving does not cancel it, and says so in a Worker's words.
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(dialog(page)).toContainText("El consumo interno puede estarse registrando");
  await expect(dialog(page)).toContainText("Salir no cancela el registro. Antes de repetirlo, pregunta a un administrador.");
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();

  await held.release();
  await expect(title(page, "Consumo interno registrado")).toBeFocused();
  await held.stop();
  expect(await stockOf(query, pan.id)).toBe(7);

  // Another, which the server records and whose answer never reaches the phone.
  await anotherInternalUse(page);
  await typeInternalUse(page, { item: "Pan dulce", units: "1" });
  const bodies: Array<string | null> = [];
  const lost = async (route: Route) => {
    bodies.push(route.request().postData());
    await route.fetch();
    await route.abort("connectionreset");
  };
  await page.route(INTERNAL_USE, lost);
  await page.getByRole("button", { name: "Registrar consumo interno de 1" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeFocused();
  await expect(main).toContainText(
    "El consumo interno pudo registrarse o no. Volver a intentar no lo registra dos veces. Si sigue sin saberse, pide a un administrador que lo revise.",
  );
  await expect(main).not.toContainText(/falló|no se registró|Historial/i);
  await expect.poll(() => stockOf(query, pan.id)).toBe(6);
  await page.unroute(INTERNAL_USE, lost);

  // The very same form, its key and its content: answered as the first, recorded once.
  const retried = page.waitForRequest(INTERNAL_USE);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  expect((await retried).postData()).toBe(bodies[0]);
  expect(bodies[0]).toMatch(/submissionKey=[0-9a-f-]{36}/);
  await expect(title(page, "Consumo interno registrado")).toBeVisible();
  expect(await query("SELECT units FROM adjustments WHERE item_id = ? AND reason = 'internal_use' ORDER BY rowid", [pan.id])).toEqual([
    { units: 3 },
    { units: 1 },
  ]);
  expect(await stockOf(query, pan.id)).toBe(6);

  // A confirmed one has nothing to lose: leaving it asks nothing.
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(page).toHaveURL(/\/inicio$/);
});

test("what is missing is said on its field, and a refused Internal use keeps what was typed and says why", async ({
  page,
  signInAs,
  addUser,
  addItem,
  query,
}) => {
  const ana = await addUser("admin", "Ana");
  await signInAs("worker", "Beto");
  const galleta = await addItem({ name: "Galleta de nuez", price: 900, stock: { units: 4, by: ana } });
  await addItem({ name: "Agua mineral", price: 1850, stock: { units: 4, by: ana } });
  await page.goto("/consumo-interno");

  // Nothing chosen: the field says so and takes the keyboard; nothing is sent.
  await page.getByRole("button", { name: "Registrar consumo interno" }).click();
  await expect(page.getByRole("alert").first()).toHaveText("Elige un producto.");
  await expect(page.getByLabel("Producto", { exact: true })).toBeFocused();
  await typeInternalUse(page, { item: "Galleta de nuez", units: "dos" });
  await expect(page.getByRole("alert")).toHaveText("Las unidades deben ser un número entero, uno o más.");
  await page.getByRole("button", { name: "Registrar consumo interno" }).click();
  await expect(page.getByLabel("Unidades", { exact: true })).toBeFocused();
  expect(await query("SELECT id FROM adjustments WHERE reason = 'internal_use'")).toHaveLength(0);

  // Since the screen was read, the Item stopped counting its units.
  await page.getByLabel("Unidades", { exact: true }).fill("2");
  await query("UPDATE items SET stock_tracked = 0 WHERE id = ?", [galleta.id]);
  await page.getByRole("button", { name: "Registrar consumo interno de 2" }).click();

  await expect(page.getByRole("alert")).toHaveText("Ese producto ya no lleva inventario: su consumo no se registra aquí.");
  await expect(title(page, "Consumo interno")).toBeVisible();
  // The list was read again: the Item is no longer offered, and the units are kept.
  await expect(page.getByLabel("Producto", { exact: true }).locator("option")).toHaveText(["Elige un producto", "Agua mineral"]);
  await expect(page.getByLabel("Unidades", { exact: true })).toHaveValue("2");
  expect(await query("SELECT id FROM adjustments WHERE reason = 'internal_use'")).toHaveLength(0);

  await recordInternalUse(page, { item: "Agua mineral", units: "2" });
  expect(await query("SELECT units FROM adjustments WHERE reason = 'internal_use'")).toEqual([{ units: 2 }]);
});

test("an Admin records it on the same screen, and is told to look in Historial when its outcome is unknown", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const agua = await addItem({ name: "Agua mineral", price: 1850, stock: { units: 5, by: ana } });
  await page.goto("/mas");
  await goTo(page, "Consumo interno");
  await typeInternalUse(page, { item: "Agua mineral", units: "1" });
  await expect(page.getByRole("main")).not.toContainText("solo un administrador");

  const dropped = (route: Route) => route.abort("connectionfailed");
  await page.route(INTERNAL_USE, dropped);
  await page.getByRole("button", { name: "Registrar consumo interno de 1" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Revisar en Historial" })).toBeVisible();
  await page.unroute(INTERNAL_USE, dropped);

  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(title(page, "Consumo interno registrado")).toBeVisible();
  expect(await stockOf(query, agua.id)).toBe(4);
});
