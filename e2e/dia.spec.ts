import { expect, test } from "./fixtures";
import { pay } from "./support/sell";

// Día (spec §6.2, §5.9, §10.6): an Admin sees Sold, Collected in cash and by
// transfer, the same per User, and Items sold with quantities and value, for a
// date or a from–to range, defaulting to today. A Worker is refused. Both
// projects run a phone viewport (playwright.config.ts).

test("an Admin sees the Day's figures, per User, and the Items sold", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 3, by: beto } });
  await addItem({ name: "Pan dulce", price: 1200, category: bebidas, stock: { units: 1, by: beto } });

  // A walk-up sale: two waters and a sweet bread, paid in cash.
  await page.goto("/");
  await pay(page, { items: [["Agua mineral", 2], "Pan dulce"] });
  await expect(page.getByRole("status")).toHaveText("$49.00 en efectivo. Cuenta pagada.");

  await signInAs("admin", "Ana");
  await page.goto("/dia");
  await expect(page.getByRole("heading", { name: "Día" })).toBeVisible();

  const totales = page.getByRole("region", { name: "Totales" });
  await expect(totales).toContainText("Vendido");
  await expect(totales).toContainText("$49.00");
  await expect(totales).toContainText("Cobrado");
  await expect(totales).toContainText("Efectivo");
  await expect(totales).toContainText("Transferencia");
  await expect(totales).toContainText("$0.00");

  const usuarios = page.getByRole("region", { name: "Por usuario" });
  await expect(usuarios).toContainText("Beto");
  await expect(usuarios).toContainText("Vendido $49.00 · Cobrado $49.00");
  await expect(usuarios).toContainText("Efectivo $49.00 · Transferencia $0.00");

  const productos = page.getByRole("list", { name: "Productos vendidos" });
  await expect(productos.getByRole("listitem")).toHaveCount(2);
  const filas = await productos.getByRole("listitem").allInnerTexts();
  // The most valuable Item first: 2 × $18.50, then 1 × $12.00.
  expect(filas[0]).toContain("Agua mineral");
  expect(filas[0]).toContain("Cantidad: 2");
  expect(filas[0]).toContain("$37.00");
  expect(filas[1]).toContain("Pan dulce");
  expect(filas[1]).toContain("Cantidad: 1");
  expect(filas[1]).toContain("$12.00");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("an Admin asks for a Day or a from–to range", async ({ page, signInAs }) => {
  await signInAs("admin", "Ana");
  await page.goto("/dia");

  // The fields default to today; ask for a range with nothing in it.
  await page.getByLabel("Desde").fill("2020-01-01");
  await page.getByLabel("Hasta").fill("2020-01-02");
  await page.getByRole("button", { name: "Ver" }).click();

  await expect(page).toHaveURL(/desde=2020-01-01&hasta=2020-01-02/);
  await expect(page.getByText("miércoles, 1 de enero de 2020 al jueves, 2 de enero de 2020")).toBeVisible();
  await expect(page.getByText("No se vendió nada en estas fechas.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Totales" })).toContainText("$0.00");

  // Narrowing to one Day keeps the range's ends equal.
  await page.getByLabel("Hasta").fill("2020-01-01");
  await page.getByRole("button", { name: "Ver" }).click();
  await expect(page.getByText("miércoles, 1 de enero de 2020", { exact: true })).toBeVisible();
});

test("a Worker is offered no Día and is refused its page", async ({ page, signInAs }) => {
  await signInAs("worker", "Beto");

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Día", exact: true })).toHaveCount(0);

  const response = await page.goto("/dia");
  expect(response?.status()).toBe(403);
  await expect(page.locator("body")).toContainText("No tienes acceso a esta página");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
