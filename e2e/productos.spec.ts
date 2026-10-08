import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  backTo,
  catalogCategory,
  catalogItem,
  categoryOrder,
  categoryRow,
  openCategories,
  openCategory,
  openNewItem,
  said,
  title,
  typeItem,
} from "./support/catalog";
import { cutOff } from "./support/layout";
import { destinations, goTo } from "./support/navigate";
import { itemButton, pay } from "./support/sell";
import { expectStock, stockRow } from "./support/stock";

// Productos and Producto (UI redesign §7, ticket 10): the catalog, apart from
// selling, with every form in a step of its own. What a form recorded is said
// by the server's answer; what it changed is then looked for where it
// matters: on Vender, on Inventario and in the facts.

const nothingSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("an Admin adds a Category and an Item with its starting Stock, and finds it on Vender and Inventario", async ({
  page,
  signInAs,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  await page.goto("/");

  await goTo(page, "Productos");
  await expect(title(page, "Productos")).toBeVisible();
  // The catalog says it is not where a sale is made, and where one is.
  await expect(page.getByRole("main")).toContainText("Las ventas se registran en Vender.");
  await expect(page.getByText("Todavía no hay categorías.")).toBeVisible();
  // No form is on the list.
  await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);

  // An Item goes in a Category: with none, the step says so and leads to them.
  await openNewItem(page);
  await expect(page.getByText("Un producto va en una categoría, y todavía no hay ninguna.")).toBeVisible();
  await page.getByRole("link", { name: "Agregar una categoría" }).click();
  await expect(title(page, "Categorías")).toBeFocused();

  // A Category needs a name and nothing else: no drawing is asked for.
  await page.getByLabel("Nombre de la categoría").fill("Antojitos de la casa");
  await page.getByRole("button", { name: "Agregar categoría" }).click();
  await expect(said(page)).toHaveText("Se agregó la categoría «Antojitos de la casa».");
  await expect(categoryRow(page, "Antojitos de la casa")).toContainText("1 de 1 · 0 productos");
  // The form is ready for the next Category.
  await expect(page.getByLabel("Nombre de la categoría")).toHaveValue("");

  await backTo(page, "Productos");
  await expect(catalogCategory(page, "Antojitos de la casa").getByText("Sin productos.")).toBeVisible();

  await openNewItem(page);
  await expect(title(page, "Agregar producto")).toBeFocused();
  await expect(page.getByLabel("Lleva inventario")).toBeChecked();
  await typeItem(page, { name: "Agua mineral", price: "18.50", minimum: "6", stock: "24" });
  await page.getByRole("button", { name: "Agregar producto" }).click();

  // Said by the server's answer: the Item, and the Entrada its starting Stock was recorded as.
  await expect(said(page)).toHaveText("Se agregó «Agua mineral». Se registró una entrada de 24 en existencias.");
  // The step stays, ready for the next Item, and the keyboard is on what was said.
  await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("");
  await expect(page.locator("#recorded")).toBeFocused();
  expect(
    await query("SELECT reason, units, recorded_by FROM adjustments WHERE item_id = (SELECT id FROM items WHERE name = ?)", [
      "Agua mineral",
    ]),
  ).toEqual([{ reason: "restock", units: 24, recorded_by: ana.id }]);

  // The same name in another case and without its accent is the same name:
  // refused on its field, which takes the keyboard, and nothing typed is lost.
  await typeItem(page, { name: "AGUA MINERAL", price: "20", minimum: "3" });
  await page.getByRole("button", { name: "Agregar producto" }).click();
  const name = page.getByLabel("Nombre", { exact: true });
  await expect(page.getByRole("alert")).toHaveText("Ya hay un producto activo con ese nombre.");
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("Ya hay un producto activo con ese nombre.");
  await expect(name).toHaveValue("AGUA MINERAL");
  await expect(page.getByLabel("Precio", { exact: true })).toHaveValue("20");
  await expect(page.getByLabel("Mínimo (opcional)")).toHaveValue("3");
  await expect(said(page)).toHaveCount(0);

  // A price that is no amount is said on the price.
  await typeItem(page, { name: "Agua de sabor", price: "veinte" });
  await page.getByRole("button", { name: "Agregar producto" }).click();
  await expect(page.getByRole("alert")).toHaveText("Escribe el precio en pesos, por ejemplo 18.50.");
  await expect(page.getByLabel("Precio", { exact: true })).toBeFocused();

  // An Item prepared to order counts no units: its Stock fields are not asked for.
  await typeItem(page, { name: "Quesadilla", price: "35", tracked: false });
  await expect(page.getByLabel("Mínimo (opcional)")).toBeHidden();
  await expect(page.getByLabel("Existencias iniciales (opcional)")).toBeHidden();
  await page.getByRole("button", { name: "Agregar producto" }).click();
  await expect(said(page)).toHaveText("Se agregó «Quesadilla».");

  await backTo(page, "Productos");
  const antojitos = catalogCategory(page, "Antojitos de la casa");
  await expect(antojitos.getByRole("link")).toHaveCount(2);
  await expect(catalogItem(page, "Agua mineral")).toContainText("$18.50");
  await expect(catalogItem(page, "Agua mineral")).toContainText("Mínimo 6");
  await expect(catalogItem(page, "Quesadilla")).toContainText("Sin inventario");
  expect(await nothingSideways(page)).toBe(true);

  // Where it matters: Inventario has the Stock, and only of what counts its units.
  await goTo(page, "Inventario");
  await expectStock(page, "Agua mineral", 24);
  await expect(stockRow(page, "Quesadilla")).toHaveCount(0);

  await goTo(page, "Vender");
  await expect(itemButton(page, "Agua mineral")).toContainText("$18.50");
  await expect(itemButton(page, "Quesadilla")).toContainText("$35.00");
});

test("a new price reaches only what is sold afterwards, and retiring an Item takes it off Vender without erasing anything", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const snacks = await addCategory("Snacks");
  const item = await addItem({ name: "Cacahuates", price: 1500, category: snacks, stock: { units: 10, by: ana } });
  await page.goto("/");
  await pay(page, { items: ["Cacahuates"] });

  await goTo(page, "Productos");
  await catalogItem(page, "Cacahuates").click();
  await expect(title(page, "Cacahuates")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Aparece en Vender.");
  // The price says what a change does not reach, before it is made.
  await expect(page.getByLabel("Precio", { exact: true })).toHaveValue("15.00");
  await expect(page.getByLabel("Precio", { exact: true })).toHaveAccessibleDescription(/lo ya vendido conserva el suyo/);
  await typeItem(page, { name: "  Cacahuates   enchilados ", price: "17.5" });
  await page.getByRole("button", { name: "Guardar cambios" }).click();

  // The Item's own page says it was saved, and shows it as it was stored.
  await expect(said(page)).toHaveText("Cambios guardados.");
  await expect(title(page, "Cacahuates enchilados")).toBeVisible();
  await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("Cacahuates enchilados");
  await expect(page.getByLabel("Precio", { exact: true })).toHaveValue("17.50");

  // The Line recorded before keeps its price; the next one has the new price.
  await goTo(page, "Vender");
  await expect(itemButton(page, "Cacahuates enchilados")).toContainText("$17.50");
  await pay(page, { items: ["Cacahuates enchilados"] });
  expect(await query("SELECT unit_price FROM lines WHERE item_id = ? ORDER BY rowid", [item.id])).toEqual([
    { unit_price: 1500 },
    { unit_price: 1750 },
  ]);

  // Retiring says what it does before its button, and then what it did.
  await goTo(page, "Productos");
  await catalogItem(page, "Cacahuates enchilados").click();
  await expect(page.getByRole("main")).toContainText(
    "Al retirarlo deja de aparecer en Vender. Sus ventas y sus movimientos de inventario se conservan, y se puede restaurar después.",
  );
  await page.getByRole("button", { name: "Retirar producto" }).click();
  await expect(said(page)).toHaveText("Producto retirado. Ya no aparece en Vender.");
  await expect(page.getByRole("main")).toContainText("No aparece en Vender.");

  // Retired, not gone: the catalog lists it apart, in words, and its records are all there.
  await backTo(page, "Productos");
  const retired = page.getByRole("region", { name: "Productos retirados" });
  await expect(retired.getByRole("link", { name: /Cacahuates enchilados/ })).toContainText("Retirado");
  await expect(catalogCategory(page, "Snacks").getByRole("link")).toHaveCount(0);
  expect(await query("SELECT COUNT(*) AS n FROM lines WHERE item_id = ?", [item.id])).toEqual([{ n: 2 }]);
  expect(await query("SELECT units FROM stock_levels WHERE item_id = ?", [item.id])).toEqual([{ units: 8 }]);
  await goTo(page, "Vender");
  await expect(title(page, "Vender")).toBeVisible();
  await expect(itemButton(page, "Cacahuates enchilados")).toHaveCount(0);

  await goTo(page, "Productos");
  await retired.getByRole("link", { name: /Cacahuates enchilados/ }).click();
  await page.getByRole("button", { name: "Restaurar producto" }).click();
  await expect(said(page)).toHaveText("Producto restaurado. Ya aparece en Vender.");
  await expect(page.getByRole("button", { name: "Retirar producto" })).toBeVisible();
  await goTo(page, "Vender");
  await expect(itemButton(page, "Cacahuates enchilados")).toContainText("$17.50");
});

test("switching stock tracking off takes an Item out of Inventario and rewrites nothing recorded", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const item = await addItem({ name: "Pan dulce", price: 1200, minimum: 4, stock: { units: 9, by: ana } });
  const recorded = () =>
    Promise.all([
      query("SELECT reason, units FROM adjustments WHERE item_id = ?", [item.id]),
      query("SELECT units FROM stock_levels WHERE item_id = ?", [item.id]),
    ]);
  const before = await recorded();
  await page.goto(`/productos/${item.id}`);

  // The way to its Stock is Inventario, not this form.
  await expect(page.getByRole("link", { name: "Ver o ajustar sus existencias en Inventario" })).toBeVisible();
  await expect(page.getByLabel("Existencias iniciales (opcional)")).toHaveCount(0);
  await expect(page.getByLabel("Lleva inventario")).toHaveAccessibleDescription(
    /Cambiarlo no modifica las existencias ni los movimientos ya registrados/,
  );
  await typeItem(page, { tracked: false });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(said(page)).toHaveText("Cambios guardados.");
  await expect(page.getByLabel("Lleva inventario")).not.toBeChecked();
  await expect(page.getByRole("link", { name: "Ver o ajustar sus existencias en Inventario" })).toHaveCount(0);

  expect(await recorded()).toEqual(before);
  await goTo(page, "Inventario");
  await expect(title(page, "Inventario")).toBeVisible();
  await expect(stockRow(page, "Pan dulce")).toHaveCount(0);

  // Switched back on, it is in Inventario with the Stock and the Minimum it had.
  await page.goto(`/productos/${item.id}`);
  await typeItem(page, { tracked: true });
  await expect(page.getByLabel("Mínimo (opcional)")).toHaveValue("4");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(said(page)).toHaveText("Cambios guardados.");
  await goTo(page, "Inventario");
  await expectStock(page, "Pan dulce", 9);
  expect(await recorded()).toEqual(before);
});

test("Categories are ordered, renamed, retired and restored with buttons, and Vender follows their order", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  const snacks = await addCategory("Snacks");
  await addCategory("Temporada");
  await addItem({ name: "Limonada", category: bebidas });
  await addItem({ name: "Papas", category: snacks });
  await page.goto("/productos");
  const sellingOrder = () =>
    page.getByRole("main").getByRole("heading", { level: 2 }).evaluateAll((all) => all.map((one) => one.textContent));

  await openCategories(page);
  expect(await categoryOrder(page)).toEqual(["Bebidas", "Snacks", "Temporada"]);
  // The ends of the list say so: the first cannot go up, the last cannot go down.
  await expect(page.getByRole("button", { name: "Subir Bebidas" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Bajar Temporada" })).toBeDisabled();

  // With the keyboard alone: the button that moved a Category keeps the keyboard.
  const down = page.getByRole("button", { name: "Bajar Bebidas" });
  await down.focus();
  await page.keyboard.press("Enter");
  await expect(said(page)).toHaveText("Orden guardado.");
  await expect(categoryRow(page, "Bebidas")).toContainText("2 de 3 · 1 producto");
  expect(await categoryOrder(page)).toEqual(["Snacks", "Bebidas", "Temporada"]);
  await expect(down).toBeFocused();
  // At the end of the list that button has nothing left to do: the Category's other one takes the keyboard.
  await page.keyboard.press("Enter");
  await expect(categoryRow(page, "Bebidas")).toContainText("3 de 3");
  await expect(down).toBeDisabled();
  await expect(page.getByRole("button", { name: "Subir Bebidas" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(categoryRow(page, "Bebidas")).toContainText("2 de 3");

  // A Category with active Items cannot be retired: its step says what to do first, and has no action for it.
  await openCategory(page, "Bebidas");
  await expect(title(page, "Bebidas")).toBeFocused();
  await expect(page.getByRole("main")).toContainText(
    "Tiene 1 producto activo. Para retirarla, primero retira ese producto o cámbialo de categoría.",
  );
  await expect(page.getByRole("button", { name: "Retirar categoría" })).toHaveCount(0);

  // A name that says nothing is refused on its field, which keeps what was typed.
  await page.getByLabel("Nombre de la categoría").fill("   ");
  await page.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(page.getByRole("alert")).toHaveText("Escribe un nombre.");
  await expect(page.getByLabel("Nombre de la categoría")).toBeFocused();
  await page.getByLabel("Nombre de la categoría").fill("Bebidas frías");
  await page.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(said(page)).toHaveText("Nombre guardado.");
  await expect(title(page, "Bebidas frías")).toBeVisible();

  // One with none can go; it stays, to be restored.
  await backTo(page, "Categorías");
  await openCategory(page, "Temporada");
  await page.getByRole("button", { name: "Retirar categoría" }).click();
  await expect(said(page)).toHaveText("Categoría retirada.");
  await expect(page.getByRole("main")).toContainText("Categoría retirada");
  await backTo(page, "Categorías");
  expect(await categoryOrder(page)).toEqual(["Snacks", "Bebidas frías"]);
  await expect(page.getByRole("region", { name: "Categorías retiradas" }).getByRole("link")).toContainText("Retirada");

  // Vender and the catalog follow the order, with the new name.
  await backTo(page, "Productos");
  expect(await sellingOrder()).toEqual(["Snacks", "Bebidas frías"]);
  await goTo(page, "Vender");
  await expect(title(page, "Vender")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 }).first()).toContainText("Snacks");
  await expect(page.getByRole("heading", { level: 2 }).nth(1)).toContainText("Bebidas frías");

  await page.goto("/productos?paso=categorias");
  await openCategory(page, "Temporada");
  await page.getByRole("button", { name: "Restaurar categoría" }).click();
  await expect(said(page)).toHaveText("Categoría restaurada.");
  await backTo(page, "Categorías");
  expect(await categoryOrder(page)).toEqual(["Snacks", "Bebidas frías", "Temporada"]);
  await expect(page.getByRole("region", { name: "Categorías retiradas" })).toHaveCount(0);
});

test("an Item whose Category is retired says what stands in the way of restoring it, before it is tried", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  await signInAs("admin", "Ana");
  await addCategory("Bebidas");
  const temporada = await addCategory("Temporada", { retired: true });
  const item = await addItem({ name: "Ponche", category: temporada, retired: true });
  await page.goto(`/productos/${item.id}`);

  // Its own Category is still offered, marked as what it is, and there is nothing to tap that would be refused.
  await expect(page.getByLabel("Categoría", { exact: true }).locator("option")).toHaveText([
    "Bebidas",
    "Temporada (retirada)",
  ]);
  await expect(page.getByRole("main")).toContainText(
    "Su categoría está retirada. Para restaurarlo, primero restaura la categoría en Categorías, o guárdalo aquí en otra.",
  );
  await expect(page.getByRole("button", { name: "Restaurar producto" })).toHaveCount(0);

  // Saved in another Category, it can be restored.
  await typeItem(page, { category: "Bebidas" });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(said(page)).toHaveText("Cambios guardados.");
  await page.getByRole("button", { name: "Restaurar producto" }).click();
  await expect(said(page)).toHaveText("Producto restaurado. Ya aparece en Vender.");
});

test("a refused change to an Item keeps what was typed, and a name taken since keeps an Item from being restored", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Atole", category: bebidas });
  const champurrado = await addItem({ name: "Champurrado", price: 2000, category: bebidas });
  const old = await addItem({ name: "atole", category: bebidas, retired: true });

  // The name of another active Item, whatever its case: refused on the name, and the rest stays as typed.
  await page.goto(`/productos/${champurrado.id}`);
  await typeItem(page, { name: "ATOLE", price: "23.5", minimum: "4" });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  const name = page.getByLabel("Nombre", { exact: true });
  await expect(page.getByRole("alert")).toHaveText("Ya hay un producto activo con ese nombre.");
  await expect(name).toBeFocused();
  await expect(name).toHaveAccessibleDescription("Ya hay un producto activo con ese nombre.");
  await expect(name).toHaveValue("ATOLE");
  await expect(page.getByLabel("Precio", { exact: true })).toHaveValue("23.5");
  await expect(page.getByLabel("Mínimo (opcional)")).toHaveValue("4");
  // Nothing was saved: the Item is still what it was.
  await expect(title(page, "Champurrado")).toBeVisible();
  await expect(said(page)).toHaveCount(0);

  // A retired Item keeps its name, but cannot come back while an active one has it.
  await page.goto(`/productos/${old.id}`);
  await page.getByRole("button", { name: "Restaurar producto" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Otro producto activo ya se llama así. Cambia el nombre de uno de los dos y vuelve a restaurarlo.",
  );
  await expect(page.getByRole("main")).toContainText("No aparece en Vender.");
  await typeItem(page, { name: "Atole de fresa" });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(said(page)).toHaveText("Cambios guardados.");
  await page.getByRole("button", { name: "Restaurar producto" }).click();
  await expect(said(page)).toHaveText("Producto restaurado. Ya aparece en Vender.");
});

test("a Worker who opens Productos by its address gets nothing", async ({ page, signInAs, addItem }) => {
  await signInAs("worker");
  const item = await addItem({ name: "Secreto" });

  const paths = [
    "/productos",
    "/productos?paso=nuevo",
    "/productos?paso=categorias",
    `/productos?paso=categoria&id=${item.category.id}`,
    `/productos/${item.id}`,
  ];
  for (const path of paths) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(403);
    await expect(page.getByText("Secreto")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Productos" })).toHaveCount(0);
  }
});

test("on a 320px phone with text twice as large long names stay whole, and an Item is added with the keyboard alone", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await signInAs("admin", "María Guadalupe Hernández de la Torre");
  const long = "Concentrado de horchata tradicional con canela y vainilla, presentación familiar";
  const word = "Supercalifragilisticoespialidosoconchocolate";
  const category = await addCategory("Bebidas preparadas al momento y de temporada");
  const item = await addItem({ name: long, price: 12345678, category, minimum: 123456 });
  await addItem({ name: word, price: 1850, category, stockTracked: false });
  await addCategory(word);
  const enlarge = () => page.addStyleTag({ content: "html { font-size: 200% }" });
  const main = page.getByRole("main");
  const bar = destinations(page);
  /** Nothing is cut or sticks out, and every control that is not a row is a 48px target. */
  const fits = async (what: string) => {
    expect(await nothingSideways(page), what).toBe(true);
    // A field scrolls what it holds, as every text field does: the heading over it has the name whole.
    expect((await cutOff(main)).filter((cut) => !/^(input|select) /.test(cut)), what).toEqual([]);
    const controls = main.getByRole("link").or(main.getByRole("button")).or(main.getByRole("textbox")).or(main.getByRole("combobox"));
    for (const control of await controls.all()) {
      // A row is a card that is a link, and the link inside a sentence is text.
      if (await control.locator("[data-slot=card]").count()) continue;
      if ((await control.getAttribute("href")) === "/") continue;
      expect((await control.boundingBox())!.height, `${what}: ${await control.innerText()}`).toBeGreaterThanOrEqual(48);
    }
  };
  /** The control is whole and above the bar at the bottom. */
  const inSight = async (control: Locator) => {
    const box = (await control.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual((await bar.boundingBox())!.y);
  };

  for (const path of ["/productos", "/productos?paso=categorias", `/productos?paso=categoria&id=${category.id}`, `/productos/${item.id}`, "/productos?paso=nuevo"]) {
    await page.goto(path);
    await fits(path);
    await enlarge();
    await fits(`${path}, enlarged`);
  }
  // The ticked box's label is its target.
  expect((await page.locator("label", { hasText: "Lleva inventario" }).boundingBox())!.height).toBeGreaterThanOrEqual(48);

  // The step that adds, with the keyboard alone and the text enlarged.
  await page.getByLabel("Nombre", { exact: true }).focus();
  await page.keyboard.type("Jugo verde");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Precio", { exact: true })).toBeFocused();
  await inSight(page.getByLabel("Precio", { exact: true }));
  await page.keyboard.type("0");
  await page.keyboard.press("Enter");
  // Refused: the price takes the keyboard back, in sight, with its reason.
  await expect(page.getByRole("alert")).toHaveText("El precio debe ser mayor a cero.");
  await expect(page.getByLabel("Precio", { exact: true })).toBeFocused();
  await inSight(page.getByLabel("Precio", { exact: true }));
  await fits("a refused Item");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("30");
  // Which controls Tab stops at is the browser's own choice (Safari skips a
  // box and a button), so the box is reached directly; Space ticks it and
  // Enter in a field sends the form.
  await page.getByLabel("Lleva inventario").focus();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Lleva inventario")).not.toBeChecked();
  await expect(page.getByLabel("Mínimo (opcional)")).toBeHidden();
  await page.getByLabel("Precio", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(said(page)).toHaveText("Se agregó «Jugo verde».");
  await fits("a recorded Item");
});
