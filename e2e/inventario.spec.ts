import { expect, test } from "./fixtures";

test("an Admin records every kind of Adjustment and cancels one, and Stock follows", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  const ana = await signInAs("admin");
  const bebidas = await addCategory("Bebidas con inventario");
  await addItem({
    name: "Agua de la casa",
    price: 1200,
    category: bebidas,
    minimum: 5,
    stock: { units: 6, by: ana },
  });
  await page.goto("/");

  await page.getByRole("navigation", { name: "Administración" }).getByRole("link", { name: "Inventario" }).click();
  await expect(page.getByRole("heading", { name: "Inventario", level: 1 })).toBeVisible();
  const row = page.getByRole("listitem", { name: "Agua de la casa", exact: true });
  await expect(row).toContainText("Existencias: 6 · Mínimo: 5");

  const record = async (reason: string, units: string, note?: string) => {
    await page.getByRole("combobox", { name: "Producto" }).selectOption({ label: "Agua de la casa" });
    await page.getByRole("combobox", { name: "Motivo" }).selectOption({ label: reason });
    await page.getByLabel("Unidades").fill(units);
    if (note) await page.getByLabel("Nota (opcional)").fill(note);
    await page.getByRole("button", { name: "Registrar ajuste" }).click();
  };

  await record("Entrada", "4", "Compra semanal");
  await expect(row).toContainText("Existencias: 10");
  await expect(page.getByRole("listitem", { name: "Entrada de 4 de Agua de la casa", exact: true })).toContainText(
    "Compra semanal",
  );

  await record("Merma", "2");
  await expect(row).toContainText("Existencias: 8");

  await record("Consumo interno", "1");
  await expect(row).toContainText("Existencias: 7");

  const merma = page.getByRole("listitem", { name: "Merma de 2 de Agua de la casa", exact: true });
  await expect(merma).toContainText("Merma -2");
  await merma.getByLabel("Motivo de la cancelación").fill("Se cayó al piso");
  await merma.getByRole("button", { name: "Cancelar ajuste" }).click();

  await expect(merma).toContainText("Cancelado: Se cayó al piso");
  await expect(row).toContainText("Existencias: 9");
  // Cancelling happens once: the cancelled Adjustment has no way back.
  await expect(merma.getByRole("button", { name: "Cancelar ajuste" })).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("an Admin sees which Items to restock and which are below zero", async ({ page, signInAs, addCategory, addItem }) => {
  const ana = await signInAs("admin");
  const category = await addCategory("Inventario con señales");
  await addItem({ name: "Justo en el mínimo", category, minimum: 5, stock: { units: 5, by: ana } });
  await addItem({ name: "Con existencias de sobra", category, minimum: 5, stock: { units: 6, by: ana } });
  await addItem({ name: "En números rojos", category });
  await addItem({ name: "Se prepara al momento", category, stockTracked: false });
  await page.goto("/inventario");

  await expect(page.getByRole("listitem", { name: "Justo en el mínimo", exact: true })).toContainText("Reponer");
  await expect(page.getByRole("listitem", { name: "Con existencias de sobra", exact: true })).not.toContainText(
    "Reponer",
  );

  // A Waste on an Item with nothing on the shelf takes it below zero.
  await page.getByRole("combobox", { name: "Producto" }).selectOption({ label: "En números rojos" });
  await page.getByRole("combobox", { name: "Motivo" }).selectOption({ label: "Merma" });
  await page.getByLabel("Unidades").fill("1");
  await page.getByRole("button", { name: "Registrar ajuste" }).click();

  const negative = page.getByRole("listitem", { name: "En números rojos", exact: true });
  await expect(negative).toContainText("Existencias: -1 · Mínimo: —");
  await expect(negative).toContainText("Bajo cero");
  await expect(negative).not.toContainText("Reponer");
  await expect(page.getByRole("listitem", { name: "Se prepara al momento", exact: true })).toHaveCount(0);
});

test("a Worker who opens Inventario by its address gets nothing", async ({ page, signInAs, addUser, addItem }) => {
  const ana = await addUser("admin");
  await addItem({ name: "Producto reservado", stock: { units: 9, by: ana } });
  await signInAs("worker");

  const response = await page.goto("/inventario");

  expect(response?.status()).toBe(403);
  await expect(page.getByText("Producto reservado")).toHaveCount(0);
  await expect(page.getByText("Existencias")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Inventario" })).toHaveCount(0);
});
