import { expect, test } from "./fixtures";

// Flow §8.7: an Admin starts a Conteo on Inventario, enters the units found
// without seeing expected numbers, reviews expected/found/difference, confirms,
// and reads the Diferencias. The operation's rules are in tests/counts.test.ts
// and the route's in tests/conteo.test.ts.

test("an Admin counts the shelf without expected numbers, confirms, and reads the Diferencias", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  const ana = await signInAs("admin");
  const category = await addCategory("Conteo de la tarde");
  await addItem({ name: "Café de olla", price: 2500, category, stock: { units: 10, by: ana } });
  await addItem({ name: "Pan dulce", price: 1500, category, stock: { units: 4, by: ana } });
  await addItem({ name: "Refresco", price: 1800, category, stock: { units: 7, by: ana } });

  await page.goto("/inventario");
  await page.getByRole("link", { name: "Iniciar conteo" }).click();
  await expect(page.getByRole("heading", { name: "Conteo", level: 1 })).toBeVisible();

  // The entry step shows the Item names and nothing about the expected numbers.
  await expect(page.getByLabel("Café de olla", { exact: true })).toHaveValue("");
  await expect(page.getByText("Esperado")).toHaveCount(0);
  await expect(page.getByText(/Existencias: \d/)).toHaveCount(0);

  await page.getByLabel("Café de olla", { exact: true }).fill("7");
  await page.getByLabel("Pan dulce", { exact: true }).fill("6");
  await page.getByLabel("Refresco", { exact: true }).fill("7");
  await page.getByLabel("Nota (opcional)").fill("Conteo de prueba");
  await page.getByRole("button", { name: "Revisar conteo" }).click();

  await expect(page.getByRole("listitem", { name: "Café de olla" })).toContainText(
    "Esperado: 10 · Contado: 7 · Faltante: 3",
  );
  await expect(page.getByRole("listitem", { name: "Pan dulce" })).toContainText("Sobrante: 2");
  await expect(page.getByRole("listitem", { name: "Refresco" })).toContainText("Sin diferencia");

  await page.getByRole("button", { name: "Confirmar conteo" }).click();

  await expect(page).toHaveURL(/\/diferencias$/);
  await expect(page.getByRole("heading", { name: "Diferencias", level: 1 })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Café de olla" })).toContainText("Faltante: 3");
  await expect(page.getByRole("listitem", { name: "Pan dulce" })).toContainText("Sobrante: 2");
  await expect(page.getByRole("listitem", { name: "Refresco" })).toContainText("Sin diferencia");
  await expect(page.getByText("Conteo de prueba")).toBeVisible();

  // Stock takes the counted value.
  await page.goto("/inventario");
  await expect(page.getByRole("listitem", { name: "Café de olla", exact: true })).toContainText("Existencias: 7");
  await expect(page.getByRole("listitem", { name: "Pan dulce", exact: true })).toContainText("Existencias: 6");
  await expect(page.getByRole("listitem", { name: "Refresco", exact: true })).toContainText("Existencias: 7");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("reads the Stock expected at the moment of confirming, even when Stock moved since the review", async ({
  page,
  context,
  signInAs,
  addItem,
}) => {
  const ana = await signInAs("admin");
  await addItem({ name: "Agua embotellada", price: 1200, stock: { units: 10, by: ana } });

  await page.goto("/inventario/conteo");
  await page.getByLabel("Agua embotellada", { exact: true }).fill("8");
  await page.getByRole("button", { name: "Revisar conteo" }).click();
  await expect(page.getByRole("listitem", { name: "Agua embotellada" })).toContainText(
    "Esperado: 10 · Contado: 8 · Faltante: 2",
  );

  // A sale (an Entrada stands in for it) lands from another phone before confirming.
  const other = await context.newPage();
  await other.goto("/inventario");
  await other.getByRole("combobox", { name: "Producto" }).selectOption({ label: "Agua embotellada" });
  await other.getByRole("combobox", { name: "Motivo" }).selectOption({ label: "Entrada" });
  await other.getByLabel("Unidades").fill("5");
  await other.getByRole("button", { name: "Registrar ajuste" }).click();
  await expect(other.getByRole("listitem", { name: "Agua embotellada", exact: true })).toContainText(
    "Existencias: 15",
  );

  await page.getByRole("button", { name: "Confirmar conteo" }).click();

  await expect(page).toHaveURL(/\/diferencias$/);
  await expect(page.getByRole("listitem", { name: "Agua embotellada" })).toContainText(
    "Esperado: 15 · Contado: 8 · Faltante: 7",
  );
});

test("a Worker who opens Conteo or Diferencias gets nothing", async ({ page, signInAs, addUser, addItem }) => {
  const ana = await addUser("admin");
  await addItem({ name: "Producto reservado", stock: { units: 9, by: ana } });
  await signInAs("worker");

  const conteo = await page.goto("/inventario/conteo");
  expect(conteo?.status()).toBe(403);
  await expect(page.getByText("Producto reservado")).toHaveCount(0);
  await expect(page.getByText("Esperado")).toHaveCount(0);

  const diferencias = await page.goto("/diferencias");
  expect(diferencias?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "Diferencias" })).toHaveCount(0);
});
