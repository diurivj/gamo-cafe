import type { Locator, Page, Route } from "@playwright/test";

import { expect, test } from "./fixtures";
import { holdSubmissions } from "./support/held";
import { cutOff } from "./support/layout";
import { destinations, goTo } from "./support/navigate";
import {
  adjust,
  cancelAdjustment,
  expectStock,
  openAdjustments,
  openCancel,
  recentAdjustments,
  seeStock,
  STOCK_CHANGE,
  stockRow,
  typeAdjustment,
} from "./support/stock";

// Inventario (spec §5.8, §6.2, §8.6; UI redesign §6, §7, §10.1.9): the Stock
// of every stock-tracked Item, found by name, with what to mind in words; an
// Adjustment and its cancellation are steps of the screen, each sent once,
// frozen, and said only as what is known. Requests are held or failed on
// purpose; no test waits on the network's own timing. Both projects run a
// phone viewport (playwright.config.ts).

type Query = (sql: string, params?: Array<string | number | null>) => Promise<Array<Record<string, unknown>>>;

const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { name, level: 1 });
const dialog = (page: Page) => page.getByRole("alertdialog");
const nothingSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** An Item's Adjustments as the facts hold them, oldest first, and its Stock. */
const adjustmentsOf = (query: Query, itemId: string) =>
  query("SELECT reason, units, note FROM adjustments WHERE item_id = ? ORDER BY rowid", [itemId]);
const stockOf = async (query: Query, itemId: string) =>
  (await query("SELECT units FROM stock_levels WHERE item_id = ?", [itemId]))[0]?.units ?? 0;

/** Taps and reports what the page showed when the browser painted its next frame. */
async function tapAndSeeNextFrame(control: Locator, text: string): Promise<boolean> {
  await control.evaluate((element, wanted) => {
    element.addEventListener(
      "click",
      () =>
        requestAnimationFrame(() => {
          (window as unknown as { seen?: boolean }).seen = document.body.innerText.includes(wanted);
        }),
      { once: true },
    );
  }, text);
  await control.click();
  const seen = await control.page().waitForFunction(() => (window as unknown as { seen?: boolean }).seen !== undefined);
  await seen.dispose();
  return control.page().evaluate(() => (window as unknown as { seen?: boolean }).seen === true);
}

test("an Admin records every kind of Adjustment and cancels one; Stock and Historial follow", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas con inventario");
  const agua = await addItem({
    name: "Agua de la casa",
    price: 1200,
    category: bebidas,
    minimum: 5,
    stock: { units: 6, by: ana },
  });
  await page.goto("/");

  await goTo(page, "Inventario");
  await expect(title(page, "Inventario")).toBeVisible();
  await expectStock(page, "Agua de la casa", 6);
  await expect(stockRow(page, "Agua de la casa")).toContainText("Mínimo 5");
  // No form is open on the list: each is a step away.
  await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);

  // Entrada, from the Item's own row: the step names the Item and says what it will do.
  await stockRow(page, "Agua de la casa").getByRole("link").click();
  await expect(title(page, "Registrar entrada")).toBeFocused();
  await expect(page.getByLabel("Producto", { exact: true })).toHaveValue(agua.id);
  await expect(page.getByText("Agua de la casa: 6 en existencias, mínimo 5.")).toBeVisible();
  await typeAdjustment(page, { units: "4", note: "Compra semanal" });
  await expect(page.getByText("Suma 4: Agua de la casa pasa de 6 a 10 en existencias.")).toBeVisible();
  await page.getByRole("button", { name: "Registrar entrada de 4" }).click();

  await expect(title(page, "Entrada registrada")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("+4 de Agua de la casa. Existencias: 10.");
  await seeStock(page);
  await expectStock(page, "Agua de la casa", 10);

  // Merma, from its own way in.
  await page.getByRole("link", { name: "Registrar merma o consumo interno" }).click();
  await expect(title(page, "Registrar merma")).toBeFocused();
  await typeAdjustment(page, { item: "Agua de la casa", units: "2" });
  await expect(page.getByText("Resta 2: Agua de la casa pasa de 10 a 8 en existencias.")).toBeVisible();
  await page.getByRole("button", { name: "Registrar merma de 2" }).click();
  await expect(title(page, "Merma registrada")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("-2 de Agua de la casa. Existencias: 8.");

  // Consumo interno, as another Adjustment right after: nothing typed is carried over.
  await page.getByRole("button", { name: "Registrar otro ajuste" }).click();
  await expect(title(page, "Registrar merma")).toBeVisible();
  await expect(page.getByLabel("Unidades", { exact: true })).toHaveValue("");
  await typeAdjustment(page, { item: "Agua de la casa", reason: "Consumo interno", units: "1" });
  await expect(title(page, "Registrar consumo interno")).toBeVisible();
  await page.getByRole("button", { name: "Registrar consumo interno de 1" }).click();
  await expect(title(page, "Consumo interno registrado")).toBeVisible();
  await seeStock(page);
  await expectStock(page, "Agua de la casa", 7);

  // The recent Adjustments, and the cancellation of one, with its reason.
  await openAdjustments(page);
  await expect(recentAdjustments(page)).toHaveCount(4);
  const merma = page.getByRole("listitem", { name: "Merma de 2 de Agua de la casa", exact: true });
  await expect(merma).toContainText("Merma -2 · Agua de la casa");
  await expect(page.getByRole("listitem", { name: "Entrada de 4 de Agua de la casa", exact: true })).toContainText(
    "Compra semanal",
  );
  await openCancel(page, "Merma de 2 de Agua de la casa");
  await expect(page.getByRole("region", { name: "Ajuste" })).toContainText("Merma -2 · Agua de la casa");
  await expect(page.getByText("Suma 2: Agua de la casa pasa de 7 a 9 en existencias.")).toBeVisible();
  // The reason is owed: without it nothing is sent.
  await page.getByRole("button", { name: "Cancelar merma de 2" }).click();
  await expect(page.getByRole("alert")).toHaveText("Escribe el motivo de la cancelación.");
  await page.getByLabel("Motivo de la cancelación").fill("Se cayó al piso");
  await page.getByRole("button", { name: "Cancelar merma de 2" }).click();

  await expect(title(page, "Ajuste cancelado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Ya no cuenta: Merma -2 de Agua de la casa. Existencias: 9.");
  await page.getByRole("button", { name: "Ver ajustes recientes" }).click();
  await expect(title(page, "Ajustes recientes")).toBeVisible();
  await expect(merma).toContainText("Cancelado: Se cayó al piso · Ana");
  // Cancelling happens once: the cancelled Adjustment has no way back.
  await expect(merma.getByRole("link", { name: "Cancelar ajuste" })).toHaveCount(0);
  await page.getByRole("button", { name: "Inventario" }).click();
  await expectStock(page, "Agua de la casa", 9);
  expect(await nothingSideways(page)).toBe(true);

  // The facts: every Adjustment stays, the cancellation beside the one it cancels.
  expect(await adjustmentsOf(query, agua.id)).toEqual([
    { reason: "restock", units: 6, note: null },
    { reason: "restock", units: 4, note: "Compra semanal" },
    { reason: "waste", units: 2, note: null },
    { reason: "internal_use", units: 1, note: null },
  ]);
  expect(await query("SELECT reason, cancelled_by FROM adjustment_cancellations")).toEqual([
    { reason: "Se cayó al piso", cancelled_by: ana.id },
  ]);
  expect(await stockOf(query, agua.id)).toBe(9);

  // And Historial says them, with who and why.
  await goTo(page, "Historial");
  await expect(page.getByRole("list", { name: "Movimientos" }).getByRole("listitem")).toHaveCount(5);
  const entries = await page.getByRole("list", { name: "Movimientos" }).getByRole("listitem").allInnerTexts();
  expect(entries).toHaveLength(5);
  expect(entries[0]).toContain("Ajuste cancelado");
  expect(entries[0]).toContain("Merma -2 · Agua de la casa");
  expect(entries[0]).toContain("Se cayó al piso");
  expect(entries[1]).toContain("Consumo interno -1 · Agua de la casa");
  expect(entries[2]).toContain("Merma -2 · Agua de la casa");
  expect(entries[3]).toContain("Entrada +4 · Agua de la casa");
  expect(entries[3]).toContain("Compra semanal");
});

test("an Admin finds an Item by name and reads what to mind in words: at its Minimum, and below zero", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  const ana = await signInAs("admin");
  const category = await addCategory("Inventario con señales");
  await addItem({ name: "Café justo en el mínimo", category, minimum: 5, stock: { units: 5, by: ana } });
  await addItem({ name: "Café con existencias de sobra", category, minimum: 5, stock: { units: 6, by: ana } });
  await addItem({ name: "Jugo en números rojos", category });
  await addItem({ name: "Pan que debe y no alcanza", category, minimum: 2 });
  await addItem({ name: "Se prepara al momento", category, stockTracked: false });
  await page.goto("/inventario");

  const rows = page.getByRole("list", { name: "Existencias" }).getByRole("listitem");
  await expect(rows).toHaveCount(4);
  await expect(stockRow(page, "Se prepara al momento")).toHaveCount(0);
  await expect(stockRow(page, "Café justo en el mínimo")).toContainText("Reponer");
  await expect(stockRow(page, "Café justo en el mínimo")).not.toContainText("Bajo cero");
  await expect(stockRow(page, "Café con existencias de sobra")).not.toContainText("Reponer");
  await expect(stockRow(page, "Jugo en números rojos")).toContainText("Sin mínimo");
  await expect(page.getByText("2 por reponer: en su mínimo o menos.")).toBeVisible();

  // Selling is never stopped by Stock, and a Merma can take it below zero: the two warnings are different words.
  await adjust(page, { item: "Jugo en números rojos", reason: "Merma", units: "1" });
  await page.getByRole("button", { name: "Registrar otro ajuste" }).click();
  await typeAdjustment(page, { item: "Pan que debe y no alcanza", units: "3" });
  await expect(page.getByText("Resta 3: Pan que debe y no alcanza pasa de 0 a -3 en existencias. Queda bajo cero.")).toBeVisible();
  await page.getByRole("button", { name: "Registrar merma de 3" }).click();
  await seeStock(page);

  await expectStock(page, "Jugo en números rojos", -1);
  await expect(stockRow(page, "Jugo en números rojos")).toContainText("Bajo cero");
  await expect(stockRow(page, "Jugo en números rojos")).not.toContainText("Reponer");
  await expect(stockRow(page, "Pan que debe y no alcanza")).toContainText("Reponer");
  await expect(stockRow(page, "Pan que debe y no alcanza")).toContainText("Bajo cero");
  await expect(page.getByText("2 por reponer: en su mínimo o menos · 2 bajo cero.")).toBeVisible();

  // The search is over every Item, ignoring case and accents, and asks nothing of the server.
  const asked: string[] = [];
  page.on("request", (request) => asked.push(request.url()));
  const search = page.getByRole("search").getByLabel("Buscar producto");
  await search.fill("CAFE");
  await expect(rows).toHaveCount(2);
  await expect(page.getByText("2 de 4 productos.")).toBeVisible();
  await search.fill("numeros");
  await expect(rows).toHaveCount(1);
  await expect(stockRow(page, "Jugo en números rojos")).toBeVisible();
  await search.fill("té de limón");
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("Ningún producto con inventario contiene «té de limón».")).toBeVisible();
  await page.getByRole("button", { name: "Ver todos" }).click();
  await expect(rows).toHaveCount(4);
  expect(asked).toEqual([]);

  // What was searched is still there on the way back from a step.
  await search.fill("jugo");
  await rows.first().getByRole("link").click();
  await expect(title(page, "Registrar entrada")).toBeVisible();
  await page.getByRole("button", { name: "Inventario" }).click();
  await expect(search).toHaveValue("jugo");
  await expect(rows).toHaveCount(1);
});

test("Inventario with no stock-tracked Item says so, and still leads to its Counts", async ({ page, signInAs, addItem }) => {
  await signInAs("admin");
  await addItem({ name: "Se prepara al momento", stockTracked: false });
  await page.goto("/inventario");

  await expect(page.getByText("Todavía no hay productos con inventario.")).toBeVisible();
  await expect(page.getByRole("search")).toHaveCount(0);
  await page.getByRole("link", { name: "Ajustes recientes" }).click();
  await expect(page.getByText("Todavía no hay ajustes.")).toBeVisible();
  await page.getByRole("button", { name: "Inventario" }).click();
  await page.getByRole("link", { name: "Diferencias de los conteos" }).click();
  await expect(title(page, "Diferencias")).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: "Contar existencias" }).click();
  await expect(title(page, "Conteo")).toBeVisible();
});

test("an Adjustment on its way is said at once, keeps what was sent, moves no Stock and is not left by accident", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const agua = await addItem({ name: "Agua de la casa", stock: { units: 6, by: ana } });
  await page.goto("/inventario");
  await stockRow(page, "Agua de la casa").getByRole("link").click();
  await typeAdjustment(page, { units: "4", note: "Compra semanal" });
  const held = await holdSubmissions(page);

  // The tap is answered by the next frame, before any answer can have come.
  expect(
    await tapAndSeeNextFrame(page.getByRole("button", { name: "Registrar entrada de 4" }), "Registrando entrada de 4…"),
  ).toBe(true);
  await held.waitFor(1);

  // Frozen: what was sent is in sight, and there is nothing to type or send again.
  const main = page.getByRole("main");
  await expect(title(page, "Registrando entrada de 4…")).toBeFocused();
  await expect(main).toContainText("Espera la confirmación.");
  await expect(main).toContainText("Agua de la casa");
  await expect(main).toContainText("Entrada +4");
  await expect(main).toContainText("Compra semanal");
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(page.getByText(/registrada|Existencias: 10/)).toHaveCount(0);
  expect(await stockOf(query, agua.id)).toBe(6);

  // Leaving does not cancel it, and says so.
  await destinations(page).getByRole("link", { name: "Inicio", exact: true }).click();
  await expect(dialog(page)).toContainText("El ajuste puede estarse registrando");
  await expect(dialog(page)).toContainText("Salir no cancela el registro.");
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  await page.goBack();
  await dialog(page).getByRole("button", { name: "Quedarme aquí" }).click();
  await expect(title(page, "Registrando entrada de 4…")).toBeVisible();
  await held.waitFor(1);

  await held.release();
  await expect(title(page, "Entrada registrada")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("+4 de Agua de la casa. Existencias: 10.");
  await held.stop();

  // Its cancellation is held the same way, and nothing says cancelled meanwhile.
  await page.getByRole("button", { name: "Volver a Inventario" }).click();
  await openAdjustments(page);
  await openCancel(page, "Entrada de 4 de Agua de la casa");
  await page.getByLabel("Motivo de la cancelación").fill("Se contó dos veces");
  const heldAgain = await holdSubmissions(page);
  expect(
    await tapAndSeeNextFrame(page.getByRole("button", { name: "Cancelar entrada de 4" }), "Cancelando ajuste…"),
  ).toBe(true);
  await heldAgain.waitFor(1);
  await expect(main).toContainText("Se contó dos veces");
  await expect(page.getByText(/Ajuste cancelado|Cancelado:/)).toHaveCount(0);
  expect(await stockOf(query, agua.id)).toBe(10);
  await heldAgain.release();
  await expect(title(page, "Ajuste cancelado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Ya no cuenta: Entrada +4 de Agua de la casa. Existencias: 6.");
  expect(await stockOf(query, agua.id)).toBe(6);
});

test("an Adjustment that got no answer is of unknown outcome, never failed, and is retried as the very same one", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const agua = await addItem({ name: "Agua de la casa", stock: { units: 6, by: ana } });
  await page.goto("/inventario");
  await stockRow(page, "Agua de la casa").getByRole("link").click();
  await typeAdjustment(page, { reason: "Merma", units: "2", note: "Se rompió" });

  // The connection drops before the server gets anything.
  const dropped = (route: Route) => route.abort("connectionfailed");
  await page.route(STOCK_CHANGE, dropped);
  await page.getByRole("button", { name: "Registrar merma de 2" }).click();

  await expect(title(page, "No sabemos si se registró")).toBeFocused();
  const main = page.getByRole("main");
  await expect(main).toContainText("El ajuste pudo registrarse o no. Volver a intentar no lo registra dos veces.");
  await expect(main).not.toContainText(/falló|no se registró|registrada/i);
  // The screen is still Inventario's own, with what was sent and nothing to edit.
  await expect(title(page, "Algo salió mal")).toHaveCount(0);
  await expect(main).toContainText("Merma -2");
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("button")).toHaveText(["Volver a intentar"]);
  await expect(main.getByRole("link", { name: "Revisar en Historial" })).toBeVisible();
  expect(await adjustmentsOf(query, agua.id)).toHaveLength(1);
  await page.unroute(STOCK_CHANGE, dropped);

  // The server fails: unknown too, and the screen is not replaced by an error page.
  const broken = (route: Route) => route.fulfill({ status: 500, body: "Internal Server Error" });
  await page.route(STOCK_CHANGE, broken);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await expect(title(page, "Algo salió mal")).toHaveCount(0);
  await page.unroute(STOCK_CHANGE, broken);

  // The server records it; its answer never reaches the phone.
  const bodies: Array<string | null> = [];
  const lost = async (route: Route) => {
    bodies.push(route.request().postData());
    await route.fetch();
    await route.abort("connectionreset");
  };
  await page.route(STOCK_CHANGE, lost);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect.poll(async () => (await adjustmentsOf(query, agua.id)).length).toBe(2);
  await expect(title(page, "No sabemos si se registró")).toBeVisible();
  await expect(main).not.toContainText(/falló|no se registró/i);
  await page.unroute(STOCK_CHANGE, lost);

  // The very same form, its key and its content: answered as the first, recorded once.
  const retried = page.waitForRequest(STOCK_CHANGE);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  expect((await retried).postData()).toBe(bodies[0]);
  expect(bodies[0]).toMatch(/submissionKey=[0-9a-f-]{36}/);

  await expect(title(page, "Merma registrada")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("-2 de Agua de la casa. Existencias: 4.");
  expect(await adjustmentsOf(query, agua.id)).toEqual([
    { reason: "restock", units: 6, note: null },
    { reason: "waste", units: 2, note: "Se rompió" },
  ]);
  expect(await stockOf(query, agua.id)).toBe(4);

  // A cancellation whose answer was lost is told as cancelled when it is sent again, and reverses once.
  await seeStock(page);
  await openAdjustments(page);
  await openCancel(page, "Merma de 2 de Agua de la casa");
  await page.getByLabel("Motivo de la cancelación").fill("No se rompió");
  await page.route(STOCK_CHANGE, lost);
  await page.getByRole("button", { name: "Cancelar merma de 2" }).click();
  await expect(title(page, "No sabemos si se registró")).toBeFocused();
  await expect(main).toContainText("La cancelación pudo registrarse o no. Volver a intentar no la registra dos veces.");
  await expect.poll(() => stockOf(query, agua.id)).toBe(6);
  await page.unroute(STOCK_CHANGE, lost);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(title(page, "Ajuste cancelado")).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Ya no cuenta: Merma -2 de Agua de la casa. Existencias: 6.");
  expect(await query("SELECT reason FROM adjustment_cancellations")).toEqual([{ reason: "No se rompió" }]);
  expect(await stockOf(query, agua.id)).toBe(6);
});

test("a refused Adjustment keeps what was typed and says why; a stale cancellation says who was first", async ({
  page,
  signInAs,
  addUser,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const agua = await addItem({ name: "Agua de la casa", stock: { units: 6, by: ana } });
  await addItem({ name: "Pan dulce", stock: { units: 2, by: ana } });
  await page.goto("/inventario");
  await stockRow(page, "Agua de la casa").getByRole("link").click();

  // Nothing is sent while a field cannot be read, and each field says what it lacks.
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(new URL(request.url()).pathname);
  });
  await page.getByRole("button", { name: "Registrar entrada", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Escribe cuántas unidades.");
  await expect(page.getByLabel("Unidades", { exact: true })).toBeFocused();
  await page.getByLabel("Unidades", { exact: true }).fill("1.5");
  await expect(page.getByRole("alert")).toHaveText("Las unidades deben ser un número entero, uno o más.");
  await expect(page.getByLabel("Unidades", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Registrar entrada", exact: true }).click();
  expect(sent).toEqual([]);

  // Another phone switches the Item's stock tracking off before the tap.
  await typeAdjustment(page, { units: "3", note: "Llegó el pedido" });
  await query("UPDATE items SET stock_tracked = 0 WHERE id = ?", [agua.id]);
  await page.getByRole("button", { name: "Registrar entrada de 3" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Este producto no lleva inventario." })).toBeVisible();
  await expect(title(page, "Registrar entrada")).toBeVisible();
  // What was typed is kept, and the screen read the catalog again: the Item
  // is no longer one to choose, and no other Item passes for it.
  await expect(page.getByLabel("Producto", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Registrar entrada de 3" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Elige un producto." })).toBeVisible();
  await expect(page.getByLabel("Unidades", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Nota (opcional)")).toHaveValue("Llegó el pedido");
  expect(await adjustmentsOf(query, agua.id)).toHaveLength(1);
  expect(await stockOf(query, agua.id)).toBe(6);

  // Back on, the same Adjustment goes through.
  await query("UPDATE items SET stock_tracked = 1 WHERE id = ?", [agua.id]);
  await page.reload();
  await typeAdjustment(page, { units: "3" });
  await page.getByRole("button", { name: "Registrar entrada de 3" }).click();
  await expect(title(page, "Entrada registrada")).toBeVisible();

  // Another Admin cancels it while this phone has its step open.
  await seeStock(page);
  await openAdjustments(page);
  await openCancel(page, "Entrada de 3 de Agua de la casa");
  await page.getByLabel("Motivo de la cancelación").fill("Yo también lo vi");
  const [{ id: adjustmentId }] = await query("SELECT id FROM adjustments WHERE units = 3");
  const carla = await addUser("admin", "Carla");
  await query(
    "INSERT INTO adjustment_cancellations (id, adjustment_id, cancelled_by, cancelled_at, reason) VALUES ('otra', ?, ?, ?, 'Se contó dos veces')",
    [adjustmentId as string, carla.id, Date.now()],
  );
  await query("UPDATE stock_levels SET units = units - 3 WHERE item_id = ?", [agua.id]);
  await page.getByRole("button", { name: "Cancelar entrada de 3" }).click();

  // Nothing is reversed twice; the step shows the Adjustment as it is now, with nothing left to do.
  await expect(page.getByRole("alert")).toHaveText("Este ajuste ya fue cancelado.");
  await expect(page.getByRole("region", { name: "Ajuste" })).toContainText("Cancelado: Se contó dos veces · Carla");
  await expect(page.getByRole("button", { name: /^Cancelar / })).toHaveCount(0);
  expect(await stockOf(query, agua.id)).toBe(6);
  expect(await query("SELECT COUNT(*) AS n FROM adjustment_cancellations")).toEqual([{ n: 1 }]);
});

test("a double tap on the action sends one Adjustment, and the next one is recorded too", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const agua = await addItem({ name: "Agua de la casa", stock: { units: 1, by: ana } });
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(new URL(request.url()).pathname);
  });

  await page.goto("/inventario");
  await stockRow(page, "Agua de la casa").getByRole("link").click();
  await typeAdjustment(page, { units: "12" });
  // Twice in the same instant, before the screen can take the button away.
  await page.getByRole("button", { name: "Registrar entrada de 12" }).evaluate((button: HTMLElement) => {
    button.click();
    button.click();
  });

  await expect(title(page, "Entrada registrada")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(sent).toEqual(["/inventario/ajustar"]);
  expect(await stockOf(query, agua.id)).toBe(13);

  // The same units again are another Adjustment, with a key of its own.
  await page.getByRole("button", { name: "Registrar otro ajuste" }).click();
  await typeAdjustment(page, { item: "Agua de la casa", units: "12" });
  await page.getByRole("button", { name: "Registrar entrada de 12" }).click();
  await expect(page.getByRole("status")).toHaveText("+12 de Agua de la casa. Existencias: 25.");
  expect((await adjustmentsOf(query, agua.id)).map((row) => row.units)).toEqual([1, 12, 12]);
});

test("a Worker who opens Inventario or one of its steps by its address gets nothing", async ({
  page,
  signInAs,
  addUser,
  addItem,
  query,
}) => {
  const ana = await addUser("admin");
  const item = await addItem({ name: "Producto reservado", stock: { units: 9, by: ana } });
  await signInAs("worker");

  for (const path of ["/inventario", `/inventario?paso=ajustar&producto=${item.id}`, "/inventario?paso=ajustes"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(403);
    await expect(page.getByText("Producto reservado")).toHaveCount(0);
    await expect(page.getByText("Existencias")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Inventario" })).toHaveCount(0);
  }
  // Nor may their phone send a change of Stock.
  const status = await page.evaluate(async (itemId) => {
    const body = new URLSearchParams({ intent: "registrar", itemId, reason: "restock", units: "5" });
    return (await fetch("/inventario/ajustar", { method: "POST", body })).status;
  }, item.id);
  expect(status).toBe(403);
  expect(await stockOf(query, item.id)).toBe(9);
});

test("on a 320px phone with text twice as large long names and large numbers stay whole, and an Adjustment is recorded with the keyboard alone", async ({
  page,
  signInAs,
  addItem,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const ana = await signInAs("admin", "María Guadalupe Hernández de la Torre");
  const long = "Concentrado de horchata tradicional con canela y vainilla, presentación familiar";
  await addItem({ name: long, minimum: 123456, stock: { units: 98765, by: ana } });
  await addItem({ name: "Supercalifragilisticoespialidosoconchocolate", minimum: 0 });
  const enlarge = () => page.addStyleTag({ content: "html { font-size: 200% }" });
  const main = page.getByRole("main");

  await page.goto("/inventario");
  await expect(stockRow(page, long)).toContainText("Mínimo 123456");
  expect(await nothingSideways(page)).toBe(true);
  expect(await cutOff(main)).toEqual([]);
  for (const control of await main.getByRole("link").or(main.getByRole("button")).all()) {
    // A row is a card that is a link; every other control is a 48px target.
    if (await control.locator("[data-slot=card]").count()) continue;
    expect((await control.boundingBox())!.height, await control.innerText()).toBeGreaterThanOrEqual(48);
  }
  await enlarge();
  expect(await nothingSideways(page)).toBe(true);
  expect(await cutOff(main)).toEqual([]);

  // With the keyboard: the row, the reason, the units, and the action.
  await stockRow(page, long).getByRole("link").focus();
  await page.keyboard.press("Enter");
  await expect(title(page, "Registrar entrada")).toBeFocused();
  await enlarge();
  await page.getByRole("radio", { name: /^Entrada/ }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /^Merma/ })).toBeChecked();
  await expect(title(page, "Registrar merma")).toBeVisible();
  await page.getByLabel("Unidades", { exact: true }).focus();
  await page.keyboard.type("765");
  await expect(page.getByText(`Resta 765: ${long} pasa de 98765 a 98000 en existencias.`)).toBeVisible();
  expect(await nothingSideways(page)).toBe(true);
  // The select cuts a long name as every phone's does; the lines under it say it whole.
  // A radio's target reaches past its circle, which is no text.
  expect((await cutOff(main)).filter((cut) => !cut.startsWith("select") && cut !== 'span ""')).toEqual([]);

  const record = page.getByRole("button", { name: "Registrar merma de 765" });
  await record.focus();
  // The bar at the bottom leaves the action in sight.
  const bar = (await destinations(page).boundingBox())!;
  const box = (await record.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  await page.keyboard.press("Enter");

  await expect(title(page, "Merma registrada")).toBeFocused();
  await enlarge();
  await expect(page.getByRole("status")).toHaveText(`-765 de ${long}. Existencias: 98000.`);
  expect(await nothingSideways(page)).toBe(true);
  expect(await cutOff(main)).toEqual([]);
  await page.getByRole("button", { name: "Volver a Inventario" }).focus();
  await page.keyboard.press("Enter");
  await expect(title(page, "Inventario")).toBeFocused();
  await expectStock(page, long, 98000);

  // The recent Adjustments and the step that cancels one, as large.
  await page.getByRole("link", { name: "Ajustes recientes" }).focus();
  await page.keyboard.press("Enter");
  await expect(title(page, "Ajustes recientes")).toBeFocused();
  await enlarge();
  await expect(recentAdjustments(page).first()).toContainText("María Guadalupe Hernández de la Torre");
  expect(await nothingSideways(page)).toBe(true);
  expect(await cutOff(main)).toEqual([]);
  await cancelAdjustment(page, `Merma de 765 de ${long}`, "Se registró en el producto equivocado");
  await enlarge();
  expect(await nothingSideways(page)).toBe(true);
  expect(await cutOff(main)).toEqual([]);
});
