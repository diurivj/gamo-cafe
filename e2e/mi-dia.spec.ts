import type { Page } from "@playwright/test";

import { dayOf, formatDay } from "../app/shared/day.ts";
import { expect, test } from "./fixtures";
import { removeLine, voidBill } from "./support/bill";
import { expectFigures } from "./support/figures";
import { cutOff } from "./support/layout";
import { goTo } from "./support/navigate";
import { leaveOpen, pay } from "./support/sell";

// Mi día (spec §6.1, §5.9, UI redesign §7.1, §10.1): what the signed-in User
// collected and sold today, in cash and by transfer, with their Payments and
// Lines and nobody else's, and how a removed Line or a Voided Bill drops out
// of the figures. Both projects run a phone viewport (playwright.config.ts).

const summary = (page: Page) => page.getByRole("region", { name: "Resumen" });
const payments = (page: Page) => page.getByRole("region", { name: "Pagos que recibiste" });
const lines = (page: Page) => page.getByRole("region", { name: "Productos que vendiste" });

test("a Worker sees only what they collected and sold today, and whose figures they are", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  // Ana sells first: none of it is Beto's.
  const ana = await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 9, by: ana } });
  await addItem({ name: "Jugo de Ana", price: 9900, category: bebidas, stock: { units: 9, by: ana } });
  await page.goto("/");
  await pay(page, { items: ["Jugo de Ana"], method: "Transferencia" });

  // Beto: two waters paid in cash, and one left open.
  await signInAs("worker", "Beto");
  await page.goto("/");
  await pay(page, { items: [["Agua mineral", 2]] });
  await leaveOpen(page, { items: ["Agua mineral"] });

  await goTo(page, "Mi día");
  await expect(page).toHaveURL(/\/mi-dia$/);
  await expect(page.getByRole("heading", { name: "Mi día", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    `Solo lo que registró Beto hoy, ${formatDay(dayOf(Date.now()))}.`,
  );

  await expectFigures(summary(page), {
    cobrado: "$37.00",
    efectivo: "$37.00",
    transferencia: "$0.00",
    vendido: "$55.50",
  });

  await expect(payments(page).getByRole("listitem")).toHaveText([/^Efectivo · \d\d:\d\d\s*\$37\.00$/]);
  await expect(lines(page).getByRole("listitem")).toHaveText([
    /2 × Agua mineral.*\$18\.50 c\/u.*\$37\.00/s,
    /1 × Agua mineral.*\$18\.50 c\/u.*\$18\.50/s,
  ]);

  // Nothing of Ana's: not her Item, her money or her name.
  await expect(page.getByRole("main")).not.toContainText("Jugo de Ana");
  await expect(page.getByRole("main")).not.toContainText("$99.00");
  await expect(page.getByRole("main")).not.toContainText("Ana");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("an Admin's Mi día is their own Day, not everyone's", async ({ page, signInAs, addCategory, addItem }) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 9, by: beto } });
  await page.goto("/");
  await pay(page, { items: [["Agua mineral", 2]] });

  await signInAs("admin", "Ana");
  await page.goto("/");
  await pay(page, { items: ["Agua mineral"], method: "Transferencia" });

  await goTo(page, "Mi día");
  await expect(page.getByRole("main")).toContainText("Solo lo que registró Ana hoy");
  await expectFigures(summary(page), {
    cobrado: "$18.50",
    efectivo: "$0.00",
    transferencia: "$18.50",
    vendido: "$18.50",
  });
  await expect(payments(page).getByRole("listitem")).toHaveCount(1);
  await expect(lines(page).getByRole("listitem")).toHaveCount(1);
});

test("a removed Line drops out of Mi día", async ({ page, signInAs, addCategory, addItem }) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Café de olla", price: 2500, category: bebidas, stock: { units: 4, by: beto } });

  await page.goto("/");
  const billId = await leaveOpen(page, { items: ["Café de olla"] });

  await goTo(page, "Mi día");
  await expect(lines(page)).toContainText("1 × Café de olla");
  await expect(payments(page)).toContainText("Todavía no has cobrado nada hoy.");

  // The Worker removes the Line from the Open Bill; the Bill is Paid with a
  // zero total, which a Worker may not open: the result is all they see of it.
  await page.goto(`/cuentas/${billId}`);
  await removeLine(page, "1 × Café de olla");
  await expect(page.getByRole("button", { name: "Ver cuenta" })).toHaveCount(0);

  await goTo(page, "Mi día");
  await expect(lines(page)).toContainText("Todavía no has vendido nada hoy.");
  await expectFigures(summary(page), { cobrado: "$0.00", efectivo: "$0.00", transferencia: "$0.00", vendido: "$0.00" });
});

test("a Voided Bill drops out of Mi día", async ({ page, signInAs, addCategory, addItem }) => {
  const ana = await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Pan dulce", price: 1200, category: bebidas, stock: { units: 3, by: ana } });

  await page.goto("/");
  const billId = await pay(page, { items: ["Pan dulce"] });

  await goTo(page, "Mi día");
  await expect(lines(page)).toContainText("1 × Pan dulce");
  await expectFigures(summary(page), {
    cobrado: "$12.00",
    efectivo: "$12.00",
    transferencia: "$0.00",
    vendido: "$12.00",
  });

  // The Admin voids the Bill, with a reason (spec §5.7).
  await page.goto(`/cuentas/${billId}`);
  await voidBill(page, "La cuenta era una prueba");

  await goTo(page, "Mi día");
  await expect(lines(page)).toContainText("Todavía no has vendido nada hoy.");
  await expect(payments(page)).toContainText("Todavía no has cobrado nada hoy.");
  await expectFigures(summary(page), { cobrado: "$0.00", efectivo: "$0.00", transferencia: "$0.00", vendido: "$0.00" });
});

test("long names and large amounts stay whole on a 320px phone with text twice as large", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const name = "María Guadalupe Hernández de la Torre y Villaseñor";
  const beto = await signInAs("worker", name);
  const item = await addItem({ name: "Chocolate caliente con malvaviscos y canela extra grande", stockTracked: false });
  const at = Date.now();
  const today = dayOf(at);
  await query(
    `INSERT INTO bills (id, day, opened_by, opened_at, total, paid, state, revision)
     VALUES ('grande', ?, ?, ?, 1234567890, 1234567890, 'paid', 1)`,
    [today, beto.id, at],
  );
  await query(
    `INSERT INTO lines (id, bill_id, item_id, quantity, unit_price, moved_stock, added_by, added_at, day)
     VALUES ('l1', 'grande', ?, 10, 123456789, 0, ?, ?, ?)`,
    [item.id, beto.id, at, today],
  );
  await query(
    `INSERT INTO payments (id, bill_id, amount, method, handover_reference, received_by, received_at, day)
     VALUES ('p1', 'grande', 1234567890, 'transfer', NULL, ?, ?, ?)`,
    [beto.id, at, today],
  );

  await page.goto("/mi-dia");
  await page.addStyleTag({ content: "html { font-size: 200% }" });

  await expect(page.getByRole("main")).toContainText(`Solo lo que registró ${name} hoy`);
  await expectFigures(summary(page), {
    cobrado: "$12,345,678.90",
    efectivo: "$0.00",
    transferencia: "$12,345,678.90",
    vendido: "$12,345,678.90",
  });
  await expect(lines(page).getByRole("listitem")).toContainText(
    "10 × Chocolate caliente con malvaviscos y canela extra grande",
  );
  await expect(lines(page).getByRole("listitem")).toContainText("$1,234,567.89 c/u");
  await expect(payments(page).getByRole("listitem")).toContainText("$12,345,678.90");

  // The headings say what each part is, in order.
  await expect(page.getByRole("main").getByRole("heading")).toHaveText([
    "Mi día",
    "Resumen",
    "Pagos que recibiste",
    "Productos que vendiste",
  ]);

  expect(await cutOff(page.getByRole("main"))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
