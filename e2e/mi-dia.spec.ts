import { expect, test } from "./fixtures";
import { goTo } from "./support/navigate";
import { leaveOpen, pay } from "./support/sell";

// Mi día (spec §6.1, §5.9, §10.6): what the signed-in User sold and collected
// today, in cash and by transfer, with their Lines and Payments, and how a
// removed Line or a Voided Bill drops out of the figures. Both projects run a
// phone viewport (playwright.config.ts).

test("a Worker sees what they sold and collected today", async ({ page, signInAs, addCategory, addItem }) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 6, by: beto } });

  // A walk-up sale: two units, paid in cash.
  await page.goto("/");
  await pay(page, { items: [["Agua mineral", 2]] });
  await expect(page.getByRole("status")).toHaveText("$37.00 en efectivo. Cuenta pagada.");

  await goTo(page, "Mi día");
  await expect(page).toHaveURL(/\/mi-dia$/);

  const figures = page.getByRole("region", { name: "Hoy" });
  await expect(figures).toContainText("Vendido");
  await expect(figures).toContainText("$37.00");
  await expect(figures).toContainText("Cobrado");
  await expect(figures).toContainText("Efectivo");
  await expect(figures).toContainText("Transferencia");

  const sold = page.getByRole("region", { name: "Vendido" });
  await expect(sold).toContainText("2 × Agua mineral");
  await expect(sold).toContainText("$37.00");

  const collected = page.getByRole("region", { name: "Cobrado" });
  await expect(collected).toContainText("Efectivo");
  await expect(collected).toContainText("$37.00");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a removed Line drops out of Mi día", async ({ page, signInAs, addCategory, addItem }) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Café de olla", price: 2500, category: bebidas, stock: { units: 4, by: beto } });

  await page.goto("/");
  const billId = await leaveOpen(page, { items: ["Café de olla"] });

  await goTo(page, "Mi día");
  await expect(page.getByRole("region", { name: "Vendido" })).toContainText("1 × Café de olla");

  // The Worker removes the Line from the Open Bill; the Bill is Paid with a
  // zero total, so they land on Cuentas abiertas.
  await page.goto(`/cuentas/${billId}`);
  await page.getByRole("button", { name: "Quitar 1 × Café de olla" }).click();
  await expect(page).toHaveURL(/cuentas-abiertas/);

  await goTo(page, "Mi día");
  await expect(page.getByRole("region", { name: "Vendido" })).toContainText("Todavía no has vendido nada hoy.");
  await expect(page.getByRole("region", { name: "Hoy" })).toContainText("$0.00");
});

test("a Voided Bill drops out of Mi día", async ({ page, signInAs, addCategory, addItem }) => {
  const ana = await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Pan dulce", price: 1200, category: bebidas, stock: { units: 3, by: ana } });

  await page.goto("/");
  const billId = await leaveOpen(page, { items: ["Pan dulce"] });

  await goTo(page, "Mi día");
  await expect(page.getByRole("region", { name: "Vendido" })).toContainText("1 × Pan dulce");

  // The Admin voids the Bill, with a reason (spec §5.7).
  await page.goto(`/cuentas/${billId}`);
  const cancelar = page.getByRole("region", { name: "Cancelar cuenta" });
  await cancelar.getByLabel("Motivo").fill("La cuenta era una prueba");
  await cancelar.getByRole("button", { name: "Cancelar cuenta" }).click();
  await expect(page.getByRole("status")).toContainText("Cuenta cancelada.");

  await goTo(page, "Mi día");
  await expect(page.getByRole("region", { name: "Vendido" })).toContainText("Todavía no has vendido nada hoy.");
  await expect(page.getByRole("region", { name: "Hoy" })).toContainText("$0.00");
});
