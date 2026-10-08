import type { Page } from "@playwright/test";

import { dayOf, formatDay } from "../app/shared/day.ts";
import { expect, test } from "./fixtures";
import { payBill, summary } from "./support/bill";
import * as customerPage from "./support/customer";
import { expectFigures } from "./support/figures";
import { cutOff } from "./support/layout";
import { goTo } from "./support/navigate";
import { leaveOpen } from "./support/sell";

// Por cobrar (spec §6.2, §4.1, UI redesign §7.1, §10.1): what is owed now,
// whatever Day it is from. The overall Owed leads, then each Customer with
// what they owe and the Day of their oldest Open Bill, then the Open Bills
// with no Customer by their note, flagged when from an earlier Day. Each row
// leads to where the money is taken, and back. Both projects run a phone
// viewport (playwright.config.ts).

type Query = (sql: string, params?: Array<string | number | null>) => Promise<unknown>;

const owedNow = (page: Page) => page.locator('[data-figure="owed"]');
const customers = (page: Page) => page.getByRole("list", { name: "Clientes por cobrar" }).getByRole("listitem");
const loose = (page: Page) => page.getByRole("list", { name: "Cuentas sin cliente" }).getByRole("listitem");
const nothingSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** A Day this many Days before today, in the cafeteria's time zone. */
const daysAgo = (days: number) => dayOf(Date.now() - days * 86_400_000);

/** An Open Bill as its projections say it, for a list that only reads them. */
const addOpenBill = (
  query: Query,
  bill: { id: string; by: string; day: string; at: number; customerId?: string; note?: string; total: number; paid?: number },
) =>
  query(
    `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, note, total, paid, state, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      bill.id,
      bill.day,
      bill.by,
      bill.at,
      bill.customerId ?? null,
      bill.note ?? null,
      bill.total,
      bill.paid ?? 0,
      (bill.paid ?? 0) > 0 ? "partial" : "open",
    ],
  );

test("an Admin sees what is owed now, each Customer's share and the Bills with no Customer, and it is not a figure of the Day", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 10, by: ana } });
  await addItem({ name: "Café de olla", price: 2500, category: bebidas, stock: { units: 10, by: ana } });
  const deudora = await addCustomer("Familia Deudora", { by: ana });

  await page.goto("/");
  await leaveOpen(page, { items: ["Agua mineral"], customer: "Familia Deudora" });
  await leaveOpen(page, { items: ["Café de olla"] });
  await leaveOpen(page, { items: ["Café de olla"], note: "Se lo llevó Sofía" });
  // Debt of an earlier Day: a Bill of the Customer from a month ago, partly
  // paid then, and the Bill without a note moved two Days back. The Worker's
  // clock cannot be moved.
  await addOpenBill(query, {
    id: "vieja",
    by: ana.id,
    day: "2026-09-01",
    at: 1000,
    customerId: deudora.id,
    total: 10000,
    paid: 4000,
  });
  await query("UPDATE bills SET day = ? WHERE customer_id IS NULL AND note IS NULL", [daysAgo(2)]);

  // Today's figures say what was consumed and received today: nothing of the older debt.
  await goTo(page, "Día");
  await expectFigures(page.getByRole("region", { name: formatDay(dayOf(Date.now())) }), {
    cobrado: "$0.00",
    efectivo: "$0.00",
    transferencia: "$0.00",
    vendido: "$68.50",
  });

  await goTo(page, "Por cobrar");

  await expect(page.getByRole("heading", { name: "Por cobrar", level: 1 })).toBeVisible();
  // What is owed now is every Open Bill's remainder, the month-old one too:
  // $18.50 + $60.00 + $25.00 + $25.00. It is not today's Vendido less Cobrado.
  await expect(owedNow(page)).toHaveText("$128.50");
  await expect(page.getByRole("main")).toContainText("Se debe ahora");
  await expect(page.getByRole("main")).toContainText(
    "Lo que falta por pagar de las cuentas abiertas, de cualquier fecha.",
  );
  // It has no date to choose, and calls nothing Vendido, Cobrado or a total.
  await expect(page.locator('main input[type="date"]')).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText(/Vendido|Cobrado|Total por cobrar/);

  // The Customer: what they owe over both Bills and the Day of the oldest.
  await expect(customers(page)).toHaveCount(1);
  const customerRow = customers(page).getByRole("link", { name: /Familia Deudora/ });
  await expect(customerRow).toContainText("Debe $78.50");
  await expect(customerRow).toContainText("Cuenta más antigua: martes, 1 de septiembre de 2026");

  // The Bills with no Customer, oldest first, told apart by their note and
  // their Day; only the one from an earlier Day is flagged, in words.
  await expect(loose(page)).toHaveCount(2);
  await expect(loose(page).nth(0)).toContainText("Sin nota");
  await expect(loose(page).nth(0)).toContainText(formatDay(daysAgo(2)));
  await expect(loose(page).nth(0)).toContainText("De un día anterior");
  await expect(loose(page).nth(0)).toContainText("Debe $25.00");
  await expect(loose(page).nth(1)).toContainText("Se lo llevó Sofía");
  await expect(loose(page).nth(1)).toContainText(formatDay(dayOf(Date.now())));
  await expect(loose(page).nth(1)).not.toContainText("De un día anterior");

  expect(await nothingSideways(page)).toBe(true);
});

test("a Customer's row leads to their page and a Bill's to its Cuenta, where the money is taken, and each leads back", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  addCustomer,
}) => {
  const ana = await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 10, by: ana } });
  await addCustomer("Familia Deudora", { by: ana });

  await page.goto("/");
  await leaveOpen(page, { items: ["Agua mineral"], customer: "Familia Deudora" });
  const looseBill = await leaveOpen(page, { items: [["Agua mineral", 2]], note: "El de la gorra" });

  await goTo(page, "Por cobrar");
  await expect(owedNow(page)).toHaveText("$55.50");

  // The Customer's page offers Abonar, and its way back is this screen.
  await customers(page).getByRole("link", { name: /Familia Deudora/ }).click();
  await expect(page).toHaveURL(/\/clientes\//);
  await expect(page.getByRole("heading", { name: "Familia Deudora", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Abonar", exact: true })).toBeVisible();
  await customerPage.abonar(page);
  await customerPage.seeCustomer(page, "Familia Deudora");
  await page.getByRole("main").getByRole("link", { name: "Por cobrar", exact: true }).click();
  await expect(page).toHaveURL(/\/por-cobrar$/);

  // Read again: the Customer owes nothing now, and the Bill with no Customer is still there.
  await expect(owedNow(page)).toHaveText("$37.00");
  await expect(page.getByRole("main")).toContainText("Ningún cliente debe nada.");
  await expect(loose(page)).toHaveCount(1);

  // The Bill is collected as it is: no Customer has to be put on it.
  await loose(page).getByRole("link", { name: /El de la gorra/ }).click();
  await expect(page).toHaveURL(new RegExp(`/cuentas/${looseBill}$`));
  await expect(summary(page)).toContainText("$37.00");
  await payBill(page, { amount: "17.00" });
  await page.getByRole("button", { name: "Ver cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Cuenta", exact: true, level: 1 })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Por cobrar", exact: true }).click();

  await expect(page).toHaveURL(/\/por-cobrar$/);
  await expect(owedNow(page)).toHaveText("$20.00");
  await expect(loose(page).first()).toContainText("Total $37.00 · Pagado $17.00");
});

test("the Bills with no Customer come a page at a time, and one opened from the second page leads back to its place", async ({
  page,
  signInAs,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  await query(
    `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 55)
     INSERT INTO bills (id, day, opened_by, opened_at, customer_id, note, total, paid, state, revision)
     SELECT 'e2e-suelta-' || x, '2026-09-30', ?, 1000 + x, NULL, 'Nota ' || x, 100, 0, 'open', 0 FROM n`,
    [ana.id],
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", { value: undefined });
  });

  await page.goto("/por-cobrar");
  // The whole Owed is on the first page, though only 50 Bills are.
  await expect(owedNow(page)).toHaveText("$55.00");
  await expect(loose(page)).toHaveCount(50);
  await expect(loose(page).first()).toContainText("Nota 1");

  await page.getByRole("link", { name: "Cargar más" }).focus();
  await page.keyboard.press("Enter");
  await expect(loose(page)).toHaveCount(55);
  await expect(page.getByRole("link", { name: "Cargar más" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("status")).toHaveText("No hay más.");
  await expect(page).toHaveURL(/\/por-cobrar$/);

  const bill = loose(page).filter({ has: page.getByText("Nota 53", { exact: true }) }).getByRole("link");
  await bill.click();
  await expect(page).toHaveURL(/\/cuentas\/e2e-suelta-53$/);
  await page.getByRole("main").getByRole("link", { name: "Por cobrar", exact: true }).click();

  await expect(page).toHaveURL(/\/por-cobrar$/);
  await expect(loose(page)).toHaveCount(55);
  await expect(bill).toBeInViewport();
});

test("with nothing owed Por cobrar says so in each of its parts", async ({ page, signInAs }) => {
  await signInAs("admin", "Ana");
  await page.goto("/por-cobrar");

  await expect(owedNow(page)).toHaveText("$0.00");
  await expect(page.getByRole("region", { name: "Clientes" })).toContainText("Ningún cliente debe nada.");
  await expect(page.getByRole("region", { name: "Cuentas sin cliente" })).toContainText(
    "No hay cuentas abiertas sin cliente.",
  );
});

test("long names and large amounts stay whole on a 320px phone with text twice as large, and the keyboard opens a row", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const ana = await signInAs("admin", "Ana");
  const largo = await addCustomer("María Guadalupe Hernández de la Torre y Villaseñor Montesdeoca", { by: ana });
  await addOpenBill(query, { id: "de-cliente", by: ana.id, day: "2026-09-01", at: 1000, customerId: largo.id, total: 1234567890 });
  await addOpenBill(query, {
    id: "suelta",
    by: ana.id,
    day: "2026-09-02",
    at: 2000,
    note: "Supercalifragilisticoexpialidoso-sin-espacios-para-partir-la-nota-en-dos",
    total: 1234567890,
    paid: 234567890,
  });

  await page.goto("/por-cobrar");
  await page.addStyleTag({ content: "html { font-size: 200% }" });

  await expect(owedNow(page)).toHaveText("$22,345,678.90");
  await expect(customers(page).first()).toContainText("María Guadalupe Hernández de la Torre y Villaseñor Montesdeoca");
  await expect(customers(page).first()).toContainText("$12,345,678.90");
  await expect(loose(page).first()).toContainText("De un día anterior");
  await expect(loose(page).first()).toContainText("Total $12,345,678.90 · Pagado $2,345,678.90");
  expect(await cutOff(page.getByRole("main"))).toEqual([]);
  expect(await nothingSideways(page)).toBe(true);

  // The headings say the parts, in order.
  await expect(page.getByRole("main").getByRole("heading")).toHaveText(["Por cobrar", "Clientes", "Cuentas sin cliente"]);

  // With the keyboard alone: a row is a link, and Enter opens it.
  await loose(page).first().getByRole("link").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/cuentas\/suelta$/);
  await expect(page.getByRole("heading", { name: "Cuenta", exact: true, level: 1 })).toBeVisible();
});

test("a Worker is offered no Por cobrar and is refused its page and its data", async ({ page, signInAs, query }) => {
  const ana = await signInAs("admin", "Ana");
  await addOpenBill(query, { id: "reservada", by: ana.id, day: "2026-09-01", at: 1000, note: "Nota reservada", total: 4321 });
  await signInAs("worker", "Beto");

  await page.goto("/mas");
  await expect(page.getByRole("main").getByRole("link", { name: "Por cobrar" })).toHaveCount(0);

  const response = await page.goto("/por-cobrar");

  expect(response?.status()).toBe(403);
  await expect(page.locator("body")).toContainText("No tienes acceso a esta página");
  await expect(page.getByRole("heading", { name: "Por cobrar" })).toHaveCount(0);
  await expect(owedNow(page)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Nota reservada");
  expect((await page.request.get("/por-cobrar.data")).status()).toBe(403);
  expect(await nothingSideways(page)).toBe(true);
});
