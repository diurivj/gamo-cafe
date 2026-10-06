import { expect, test } from "./fixtures";

test("an Admin adds a Category and an Item, and a second Item with the same name is refused", async ({ page, signInAs }) => {
  await signInAs("admin");
  await page.goto("/");

  await page.getByRole("navigation", { name: "Administración" }).getByRole("link", { name: "Productos" }).click();
  await expect(page.getByRole("heading", { name: "Productos", level: 1 })).toBeVisible();
  await expect(page.getByText("Todavía no hay categorías.")).toBeVisible();

  await page.getByLabel("Nombre de la categoría").fill("Bebidas");
  await page.getByRole("button", { name: "Agregar categoría" }).click();
  const bebidas = page.getByRole("region", { name: "Bebidas" });
  await expect(bebidas.getByText("Sin productos.")).toBeVisible();
  // The form is ready for the next Category.
  await expect(page.getByLabel("Nombre de la categoría").last()).toHaveValue("");

  await page.getByText("Nuevo producto").click();
  const form = page.locator("details", { hasText: "Nuevo producto" });
  await form.getByLabel("Nombre", { exact: true }).fill("Agua mineral");
  await form.getByLabel("Precio").fill("18.50");
  await expect(form.getByLabel("Lleva inventario")).toBeChecked();
  await form.getByLabel("Mínimo").fill("6");
  await form.getByLabel("Existencias iniciales").fill("24");
  await form.getByRole("button", { name: "Agregar producto" }).click();

  const item = bebidas.getByRole("link", { name: /Agua mineral/ });
  await expect(item).toContainText("$18.50");
  await expect(item).toContainText("Mínimo 6");
  await expect(form.getByLabel("Nombre", { exact: true })).toHaveValue("");

  // The same name in another case and without its accent is the same name.
  await form.getByLabel("Nombre", { exact: true }).fill("AGUA MINERAL");
  await form.getByLabel("Precio").fill("20");
  await form.getByRole("button", { name: "Agregar producto" }).click();

  await expect(form.getByRole("alert")).toHaveText("Ya hay un producto activo con ese nombre.");
  await expect(bebidas.getByRole("link")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("an Admin changes an Item's price, retires it and restores it", async ({ page, signInAs, addCategory, addItem }) => {
  const ana = await signInAs("admin");
  const snacks = await addCategory("Snacks");
  await addItem({ name: "Cacahuates", price: 1500, category: snacks, stock: { units: 10, by: ana } });
  await page.goto("/productos");

  await page.getByRole("link", { name: /Cacahuates/ }).click();
  await expect(page.getByRole("heading", { name: "Cacahuates" })).toBeVisible();
  await expect(page.getByLabel("Precio")).toHaveValue("15.00");
  await page.getByLabel("Precio").fill("17.5");
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByRole("heading", { name: "Productos", level: 1 })).toBeVisible();
  const item = page.getByRole("link", { name: /Cacahuates/ });
  await expect(item).toContainText("$17.50");

  await item.click();
  await page.getByRole("button", { name: "Retirar producto" }).click();
  await expect(page.getByText("Retirado: no aparece en Vender.")).toBeVisible();

  // Retired, not gone: Productos still lists it.
  await page.getByRole("link", { name: "Productos", exact: true }).first().click();
  await expect(page.getByRole("link", { name: /Cacahuates/ })).toContainText("Retirado");

  await page.getByRole("link", { name: /Cacahuates/ }).click();
  await page.getByRole("button", { name: "Restaurar producto" }).click();
  await expect(page.getByRole("button", { name: "Retirar producto" })).toBeVisible();
  await expect(page.getByText("Retirado: no aparece en Vender.")).toHaveCount(0);
});

test("a Category with active Items cannot be retired, and Categories can be reordered", async ({ page, signInAs, addCategory, addItem }) => {
  await signInAs("admin");
  const bebidas = await addCategory("Bebidas");
  await addCategory("Snacks");
  await addItem({ name: "Limonada", category: bebidas });
  await page.goto("/productos");

  const headings = page.getByRole("heading", { level: 2 });
  await expect(headings.first()).toHaveText("Bebidas");

  await page.getByRole("region", { name: "Bebidas" }).getByText("Cambiar categoría").click();
  await page.getByRole("button", { name: "Retirar Bebidas" }).click();
  await expect(page.getByRole("region", { name: "Bebidas" }).getByRole("alert")).toContainText(
    "Esta categoría tiene productos activos.",
  );

  await page.getByRole("button", { name: "Bajar Bebidas" }).click();
  await expect(headings.first()).toHaveText("Snacks");

  // Snacks has no Items, so it can go; it stays on the page to be restored.
  await page.getByRole("region", { name: "Snacks" }).getByText("Cambiar categoría").click();
  await page.getByRole("button", { name: "Retirar Snacks" }).click();
  await expect(page.getByRole("heading", { name: "Categorías retiradas" })).toBeVisible();
  await page.getByRole("button", { name: "Restaurar Snacks" }).click();
  await expect(page.getByRole("heading", { name: "Categorías retiradas" })).toHaveCount(0);
});

test("a Worker who opens Productos by its address gets nothing", async ({ page, signInAs, addItem }) => {
  await signInAs("worker");
  await addItem({ name: "Secreto" });

  const response = await page.goto("/productos");

  expect(response?.status()).toBe(403);
  await expect(page.getByText("Secreto")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Productos" })).toHaveCount(0);
});
