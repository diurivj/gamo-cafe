import type { Page } from "@playwright/test";

import { dayOf, formatDay } from "../app/shared/day.ts";
import { expect, test } from "./fixtures";
import { payBill } from "./support/bill";
import { expectFigures } from "./support/figures";
import { cutOff } from "./support/layout";
import { goTo } from "./support/navigate";
import { leaveOpen, pay } from "./support/sell";

// Día (spec §6.2, §5.9, UI redesign §7.1, §10.1): an Admin sees Collected in
// cash and by transfer, then Sold, for a date or a from–to range that
// defaults to today; the same per User and the Items sold are each a tap
// away; what is owed is another screen. A Worker is refused. Both projects
// run a phone viewport (playwright.config.ts).

const summary = (page: Page) => page.getByRole("region", { name: formatDay(dayOf(Date.now())) });
const users = (page: Page) => page.getByRole("list", { name: "Por usuario" });
const items = (page: Page) => page.getByRole("list", { name: "Productos vendidos" });
const nothingSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("an Admin sees today's figures first, then each User's and the Items sold", async ({
  page,
  signInAs,
  addCategory,
  addItem,
}) => {
  const beto = await signInAs("worker", "Beto");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Agua mineral", price: 1850, category: bebidas, stock: { units: 3, by: beto } });
  await addItem({ name: "Pan dulce", price: 1200, category: bebidas, stock: { units: 3, by: beto } });

  // Beto: two waters and a sweet bread paid in cash, and a sweet bread left open.
  await page.goto("/");
  await pay(page, { items: [["Agua mineral", 2], "Pan dulce"] });
  await leaveOpen(page, { items: ["Pan dulce"] });

  // Ana: a water paid by transfer.
  await signInAs("admin", "Ana");
  await page.goto("/");
  await pay(page, { items: ["Agua mineral"], method: "Transferencia" });

  await goTo(page, "Día");
  await expect(page.getByRole("heading", { name: "Día", level: 1 })).toBeVisible();
  // The date is said in words, and both fields hold it.
  const today = dayOf(Date.now());
  await expect(page.getByRole("heading", { name: formatDay(today), level: 2 })).toBeVisible();
  await expect(page.getByLabel("Desde")).toHaveValue(today);
  await expect(page.getByLabel("Hasta")).toHaveValue(today);

  // What was received is not what was consumed: $12.00 is still owed.
  await expectFigures(summary(page), {
    cobrado: "$67.50",
    efectivo: "$49.00",
    transferencia: "$18.50",
    vendido: "$79.50",
  });
  await expect(summary(page)).toContainText("El dinero que se recibió.");
  await expect(summary(page)).toContainText("Lo que se consumió, pagado o no.");
  await expect(page.getByRole("main")).not.toContainText("Total");

  // Each User's figures wait behind their heading, which says how many there are.
  await expect(users(page)).toBeHidden();
  await page.getByRole("heading", { name: "Por usuario" }).click();
  const rows = users(page).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByRole("heading", { level: 3 })).toHaveText("Ana");
  await expectFigures(rows.nth(0), {
    cobrado: "$18.50",
    efectivo: "$0.00",
    transferencia: "$18.50",
    vendido: "$18.50",
  });
  await expect(rows.nth(1).getByRole("heading", { level: 3 })).toHaveText("Beto");
  await expectFigures(rows.nth(1), {
    cobrado: "$49.00",
    efectivo: "$49.00",
    transferencia: "$0.00",
    vendido: "$61.00",
  });

  // The Items sold, the most valuable first: 3 × $18.50, then 2 × $12.00.
  await expect(items(page)).toBeHidden();
  await page.getByRole("heading", { name: "Productos vendidos" }).click();
  await expect(items(page).getByRole("listitem")).toHaveText([
    /Agua mineral.*Cantidad: 3.*\$55\.50/s,
    /Pan dulce.*Cantidad: 2.*\$24\.00/s,
  ]);

  expect(await nothingSideways(page)).toBe(true);
});

test("money received today for an older Day's Bill is today's Cobrado and that Day's Vendido", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Café fiado", price: 2500, category: bebidas, stock: { units: 3, by: ana } });

  await page.goto("/");
  const billId = await leaveOpen(page, { items: [["Café fiado", 2]] });
  // The Bill and its Lines move two Days back; the Worker's clock cannot be
  // moved, and two Days back is always an earlier Day in the cafeteria's zone.
  const older = dayOf(Date.now() - 2 * 86_400_000);
  await query("UPDATE bills SET day = ? WHERE id = ?", [older, billId]);
  await query("UPDATE lines SET day = ? WHERE bill_id = ?", [older, billId]);

  // Today part of it is paid.
  await page.goto(`/cuentas/${billId}`);
  await payBill(page, { amount: "30" });

  await goTo(page, "Día");
  await expectFigures(summary(page), {
    cobrado: "$30.00",
    efectivo: "$30.00",
    transferencia: "$0.00",
    vendido: "$0.00",
  });
  await page.getByRole("heading", { name: "Productos vendidos" }).click();
  await expect(page.getByRole("main")).toContainText("No se vendió nada en estas fechas.");

  // The Day it was consumed keeps what was sold, and received nothing.
  await page.getByLabel("Desde").fill(older);
  await page.getByLabel("Hasta").fill(older);
  await page.getByRole("button", { name: "Ver" }).click();
  await expect(page.getByRole("heading", { name: formatDay(older), level: 2 })).toBeVisible();
  await expectFigures(page.getByRole("region", { name: formatDay(older) }), {
    cobrado: "$0.00",
    efectivo: "$0.00",
    transferencia: "$0.00",
    vendido: "$50.00",
  });

  // What is still owed is not a figure of either Day: it has a screen of its own.
  await expect(page.getByRole("main")).not.toContainText("$20.00");
  await page.getByRole("link", { name: /^Por cobrar/ }).click();
  await expect(page).toHaveURL(/\/por-cobrar$/);
  await expect(page.getByRole("main")).toContainText("$20.00");
});

test("an Admin asks for a Day or a from–to range, and a range that cannot be shows no figures", async ({
  page,
  signInAs,
}) => {
  await signInAs("admin", "Ana");
  await page.goto("/dia");

  // The fields default to today; ask for a range with nothing in it.
  await page.getByLabel("Desde").fill("2020-01-01");
  await page.getByLabel("Hasta").fill("2020-01-02");
  await page.getByRole("button", { name: "Ver" }).click();

  await expect(page).toHaveURL(/desde=2020-01-01&hasta=2020-01-02/);
  const range = "Del miércoles, 1 de enero de 2020 al jueves, 2 de enero de 2020";
  await expect(page.getByRole("heading", { name: range, level: 2 })).toBeVisible();
  await expectFigures(page.getByRole("region", { name: range }), {
    cobrado: "$0.00",
    efectivo: "$0.00",
    transferencia: "$0.00",
    vendido: "$0.00",
  });
  await page.getByRole("heading", { name: "Por usuario" }).click();
  await expect(page.getByRole("main")).toContainText("Nadie registró nada en estas fechas.");

  // Narrowing to one Day keeps the range's ends equal.
  await page.getByLabel("Hasta").fill("2020-01-01");
  await page.getByRole("button", { name: "Ver" }).click();
  await expect(
    page.getByRole("heading", { name: "miércoles, 1 de enero de 2020", level: 2, exact: true }),
  ).toBeVisible();

  // An end before its start: the reason, the fields as asked, and no date or figure.
  await page.getByLabel("Hasta").fill("2019-12-31");
  await page.getByRole("button", { name: "Ver" }).click();
  await expect(page.getByRole("alert")).toHaveText("La fecha final no puede ser anterior a la inicial.");
  await expect(page.getByLabel("Desde")).toHaveValue("2020-01-01");
  await expect(page.getByLabel("Hasta")).toHaveValue("2019-12-31");
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
  await expect(page.locator("[data-figure]")).toHaveCount(0);

  // One end alone in a link is that single Day, not a range up to today.
  await page.goto("/dia?desde=2020-01-01");
  await expect(page.getByRole("heading", { name: "miércoles, 1 de enero de 2020", level: 2 })).toBeVisible();
  await expect(page.getByLabel("Hasta")).toHaveValue("2020-01-01");

  // A date the calendar does not have is not read as today.
  const response = await page.goto("/dia?desde=2020-02-31");
  expect(response?.status()).toBe(400);
  await expect(page.getByRole("alert")).toHaveText("La fecha inicial no es una fecha válida.");
  await expect(page.locator("[data-figure]")).toHaveCount(0);
});

test("while another range is read, the figures on screen keep the date they are about", async ({
  page,
  signInAs,
}) => {
  await signInAs("admin", "Ana");
  await page.goto("/dia?desde=2020-01-01&hasta=2020-01-01");
  const shown = page.getByRole("heading", { name: "miércoles, 1 de enero de 2020", level: 2 });
  await expect(shown).toBeVisible();

  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/dia.data*", async (route) => {
    await held;
    await route.continue();
  });

  await page.getByLabel("Desde").fill("2020-01-05");
  await page.getByLabel("Hasta").fill("2020-01-05");
  await page.getByRole("button", { name: "Ver" }).click();

  // Still the first Day's figures, under the first Day's name, and said to be on their way.
  await expect(page.getByText("Leyendo las fechas que pediste…")).toBeVisible();
  await expect(shown).toBeVisible();
  await expect(page.getByRole("heading", { name: "domingo, 5 de enero de 2020" })).toHaveCount(0);
  await expect(page.locator("[aria-busy=true]").filter({ has: shown })).toHaveCount(1);

  release();
  await expect(page.getByRole("heading", { name: "domingo, 5 de enero de 2020", level: 2 })).toBeVisible();
  await expect(page.getByText("Leyendo las fechas que pediste…")).toHaveCount(0);
});

test("long names and large amounts stay whole on a 320px phone with text twice as large, and the keyboard opens each part", async ({
  page,
  signInAs,
  addItem,
  query,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const ana = await signInAs("admin", "María Guadalupe Hernández de la Torre y Villaseñor");
  const item = await addItem({ name: "Chocolate caliente con malvaviscos y canela extra grande", stockTracked: false });
  await query(
    `INSERT INTO bills (id, day, opened_by, opened_at, total, paid, state, revision)
     VALUES ('grande', '2026-09-29', ?, 1000, 1234567890, 1234567890, 'paid', 1)`,
    [ana.id],
  );
  await query(
    `INSERT INTO lines (id, bill_id, item_id, quantity, unit_price, moved_stock, added_by, added_at, day)
     VALUES ('l1', 'grande', ?, 10, 123456789, 0, ?, 1000, '2026-09-29')`,
    [item.id, ana.id],
  );
  await query(
    `INSERT INTO payments (id, bill_id, amount, method, handover_reference, received_by, received_at, day)
     VALUES ('p1', 'grande', 1234567890, 'transfer', NULL, ?, 1000, '2026-09-29')`,
    [ana.id],
  );

  await page.goto("/dia?desde=2026-09-29&hasta=2026-09-30");
  await page.addStyleTag({ content: "html { font-size: 200% }" });

  const range = "Del martes, 29 de septiembre de 2026 al miércoles, 30 de septiembre de 2026";
  const figures = page.getByRole("region", { name: range });
  await expectFigures(figures, {
    cobrado: "$12,345,678.90",
    efectivo: "$0.00",
    transferencia: "$12,345,678.90",
    vendido: "$12,345,678.90",
  });

  // With the keyboard: the dates are asked for, and each part is opened, without a tap.
  await page.getByRole("button", { name: "Ver" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/desde=2026-09-29&hasta=2026-09-30/);
  await page.addStyleTag({ content: "html { font-size: 200% }" });
  await page.locator("summary", { hasText: "Por usuario" }).focus();
  await page.keyboard.press("Enter");
  await expect(users(page)).toBeVisible();
  await page.locator("summary", { hasText: "Productos vendidos" }).focus();
  await page.keyboard.press("Enter");
  await expect(items(page)).toBeVisible();

  await expect(users(page).getByRole("heading", { level: 3 })).toHaveText(
    "María Guadalupe Hernández de la Torre y Villaseñor",
  );
  await expect(items(page).getByRole("listitem")).toContainText(
    "Chocolate caliente con malvaviscos y canela extra grande",
  );
  await expect(items(page).getByRole("listitem")).toContainText("$12,345,678.90");

  // Nothing is cut and nothing scrolls sideways.
  expect(await cutOff(page.getByRole("main"))).toEqual([]);
  expect(await nothingSideways(page)).toBe(true);
});

test("a Worker is offered no Día and is refused its page", async ({ page, signInAs }) => {
  await signInAs("worker", "Beto");

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Día", exact: true })).toHaveCount(0);

  const response = await page.goto("/dia");
  expect(response?.status()).toBe(403);
  await expect(page.locator("body")).toContainText("No tienes acceso a esta página");
  await expect(page.locator("[data-figure]")).toHaveCount(0);
  expect(await nothingSideways(page)).toBe(true);
});
