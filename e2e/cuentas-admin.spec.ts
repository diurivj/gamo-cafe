import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { cutOff } from "./support/layout";
import { goTo } from "./support/navigate";
import * as sell from "./support/sell";

// Cuentas (spec §6.2, UI redesign §7, §10.1) and a Customer's past Bills
// (§6.1): every Bill with its state in words, filtered by Day, state or
// Customer, 50 per page, each leading to its Cuenta and back; the Admin-only
// pages a Worker is refused. Both projects run a phone viewport
// (playwright.config.ts).

type Query = (sql: string, params?: Array<string | number | null>) => Promise<unknown>;

interface SeededBill {
  readonly id: string;
  readonly by: string;
  readonly day?: string;
  /** Later is newer, and so nearer the top. */
  readonly at: number;
  readonly customerId?: string;
  readonly note?: string;
  readonly total: number;
  readonly paid?: number;
  readonly state: "open" | "partial" | "paid" | "voided";
}

/** A Bill as its projections say it, for a list that only reads them. */
const addBill = (query: Query, bill: SeededBill) =>
  query(
    `INSERT INTO bills (id, day, opened_by, opened_at, customer_id, note, total, paid, state, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      bill.id,
      bill.day ?? "2026-10-01",
      bill.by,
      bill.at,
      bill.customerId ?? null,
      bill.note ?? null,
      bill.total,
      bill.paid ?? 0,
      bill.state,
    ],
  );

const rows = (page: Page) => page.getByRole("list", { name: "Cuentas", exact: true }).getByRole("listitem");
const filter = (page: Page) => page.getByRole("button", { name: "Filtrar" }).click();
const nothingSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Leaves only the User's own taps and keys to load a page. */
const withoutScrollLoading = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", { value: undefined });
  });

test("Cuentas says it holds every Bill, names each one's state in words and filters by state, Day and Customer", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const ruiz = await addCustomer("Familia Ruiz", { by: ana });
  const paz = await addCustomer("Familia Paz", { by: ana });
  await addBill(query, { id: "abierta", by: ana.id, at: 4000, note: "Mesa del fondo", total: 2500, state: "open" });
  await addBill(query, {
    id: "parcial",
    by: ana.id,
    at: 3000,
    customerId: paz.id,
    note: "Paga el viernes",
    total: 5000,
    paid: 2000,
    state: "partial",
    day: "2026-09-30",
  });
  await addBill(query, { id: "pagada", by: ana.id, at: 2000, customerId: ruiz.id, total: 2500, paid: 2500, state: "paid" });
  await addBill(query, { id: "cancelada", by: ana.id, at: 1000, total: 7000, paid: 1000, state: "voided" });

  await page.goto("/inicio");
  await goTo(page, "Cuentas");

  // It is the list of every Bill, not Cuentas abiertas.
  await expect(page.getByRole("heading", { name: "Cuentas", level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Todas las cuentas, también las pagadas y las canceladas.");

  // Newest first, each with whose it is, its Day, its state and its amounts.
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).nth(0)).toContainText("Mesa del fondo");
  await expect(rows(page).nth(0)).toContainText("Abierta");
  await expect(rows(page).nth(0)).toContainText("jueves, 1 de octubre de 2026");
  await expect(rows(page).nth(0)).toContainText("Debe $25.00");
  await expect(rows(page).nth(1)).toContainText("Familia Paz");
  await expect(rows(page).nth(1)).toContainText("Paga el viernes");
  await expect(rows(page).nth(1)).toContainText("Pago parcial");
  await expect(rows(page).nth(1)).toContainText("Debe $30.00");
  await expect(rows(page).nth(1)).toContainText("Total $50.00 · Pagado $20.00");
  await expect(rows(page).nth(2)).toContainText("Familia Ruiz");
  await expect(rows(page).nth(2)).toContainText("Pagada");
  await expect(rows(page).nth(2)).toContainText("Total $25.00 · Pagado $25.00");
  await expect(rows(page).nth(3)).toContainText("Sin cliente");
  await expect(rows(page).nth(3)).toContainText("Cancelada");
  await expect(rows(page).nth(3)).toContainText("Total $70.00 · Pagado $10.00");
  // Only a Bill that is still Open owes.
  await expect(rows(page).nth(2)).not.toContainText("Debe");
  await expect(rows(page).nth(3)).not.toContainText("Debe");

  // Each state alone.
  for (const [label, value, id] of [
    ["Abierta", "open", "abierta"],
    ["Pago parcial", "partial", "parcial"],
    ["Pagada", "paid", "pagada"],
    ["Cancelada", "voided", "cancelada"],
  ] as const) {
    await page.getByLabel("Estado").selectOption({ label });
    await filter(page);
    await expect(page).toHaveURL(new RegExp(`estado=${value}`));
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute("data-bill-id", id);
    await expect(page.getByLabel("Estado")).toHaveValue(value);
  }

  // Taking the filters off shows every Bill again, and the field says so.
  await page.getByRole("link", { name: "Quitar filtros" }).click();
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByLabel("Estado")).toHaveValue("");
  await expect(page.getByRole("link", { name: "Quitar filtros" })).toHaveCount(0);

  // A Day.
  await page.getByLabel("Día", { exact: true }).fill("2026-09-30");
  await filter(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Familia Paz");

  // A Customer, chosen from the picker, with the Day still on: nothing of theirs that Day.
  await page.getByLabel("Cliente", { exact: true }).pressSequentially("Familia R");
  await page.getByRole("list", { name: "Coincidencias" }).getByRole("button", { name: "Familia Ruiz" }).click();
  await filter(page);
  await expect(page).toHaveURL(new RegExp(`dia=2026-09-30.*cliente=${ruiz.id}`));
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("No hay cuentas con esos filtros.");

  // Taking the filters off empties the picker too.
  await page.getByRole("link", { name: "Quitar filtros" }).click();
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByLabel("Día", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Cliente", { exact: true })).toHaveValue("");

  // The Customer alone.
  await page.getByLabel("Cliente", { exact: true }).pressSequentially("Familia R");
  await page.getByRole("list", { name: "Coincidencias" }).getByRole("button", { name: "Familia Ruiz" }).click();
  await filter(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Pagada");
  // The filter that is on stays said: the Customer is still the one chosen.
  await expect(page.getByRole("group", { name: "Cliente" })).toContainText("Familia Ruiz");

  expect(await nothingSideways(page)).toBe(true);
});

test("a Bill opened from Cuentas leads back to the list as it was: its filters, its pages and its place", async ({
  page,
  signInAs,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  await query(
    `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 55)
     INSERT INTO bills (id, day, opened_by, opened_at, customer_id, note, total, paid, state, revision)
     SELECT 'e2e-pagina-' || x, '2026-09-30', ?, ? + x, NULL, 'Nota ' || x, 100, 100, 'paid', 1 FROM n`,
    [ana.id, 1000],
  );
  // Of another Day: the filter keeps it out of every page.
  await addBill(query, { id: "de-otro-dia", by: ana.id, at: 9000, total: 100, state: "open" });
  await withoutScrollLoading(page);

  await page.goto("/cuentas");
  await page.getByLabel("Día", { exact: true }).fill("2026-09-30");
  await page.getByLabel("Estado").selectOption({ label: "Pagada" });
  await filter(page);
  await expect(rows(page)).toHaveCount(50);

  // The rest come with the keyboard, and the filters are kept.
  await page.getByRole("link", { name: "Cargar más" }).focus();
  await page.keyboard.press("Enter");
  await expect(rows(page)).toHaveCount(55);
  await expect(page.getByRole("link", { name: "Cargar más" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("status")).toHaveText("No hay más.");
  await expect(page).toHaveURL(/dia=2026-09-30&estado=paid/);
  await expect(rows(page).filter({ hasText: "Sin cliente" })).toHaveCount(0);

  // A Bill of the second page: Nota 3 is the 53rd row.
  const bill = rows(page).filter({ has: page.getByText("Nota 3", { exact: true }) }).getByRole("link");
  await bill.click();
  await expect(page).toHaveURL(/\/cuentas\/e2e-pagina-3$/);
  await expect(page.getByRole("heading", { name: "Cuenta", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Pagada");

  // Cuenta's own way back is named after this list, and goes back to it.
  await page.getByRole("main").getByRole("link", { name: "Cuentas", exact: true }).click();
  await expect(page).toHaveURL(/\/cuentas\?dia=2026-09-30&estado=paid/);
  await expect(page.getByLabel("Día", { exact: true })).toHaveValue("2026-09-30");
  await expect(page.getByLabel("Estado")).toHaveValue("paid");
  await expect(rows(page)).toHaveCount(55);
  await expect(bill).toBeInViewport();

  // The browser's Back does the same.
  await bill.click();
  await expect(page).toHaveURL(/\/cuentas\/e2e-pagina-3$/);
  await page.goBack();
  await expect(rows(page)).toHaveCount(55);
  await expect(bill).toBeInViewport();
});

test("while other filters are read, the Bills on screen are said to be the ones before", async ({
  page,
  signInAs,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  await addBill(query, { id: "abierta", by: ana.id, at: 2000, note: "La abierta", total: 2500, state: "open" });
  await addBill(query, { id: "pagada", by: ana.id, at: 1000, note: "La pagada", total: 2500, paid: 2500, state: "paid" });
  await page.goto("/cuentas");
  await expect(rows(page)).toHaveCount(2);

  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/cuentas.data*", async (route) => {
    await held;
    await route.continue();
  });

  await page.getByLabel("Estado").selectOption({ label: "Pagada" });
  await filter(page);

  await expect(page.getByText("Buscando las cuentas que pediste…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Filtrando…" })).toBeDisabled();
  // Still both Bills, and marked as on their way out.
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator("[aria-busy=true]").filter({ has: page.getByRole("list", { name: "Cuentas" }) })).toHaveCount(1);

  release();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("La pagada");
  await expect(page.getByText("Buscando las cuentas que pediste…")).toHaveCount(0);
});

test("a read that fails is said inside the navigation, and the list can be asked for again", async ({
  page,
  signInAs,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  await addBill(query, { id: "abierta", by: ana.id, at: 1000, note: "La abierta", total: 2500, state: "open" });
  await page.goto("/cuentas");
  await expect(rows(page)).toHaveCount(1);

  await page.route("**/cuentas.data*", (route) => route.fulfill({ status: 500, body: "" }));
  await page.getByLabel("Estado").selectOption({ label: "Pagada" });
  await filter(page);

  // No Bill is shown as the answer to filters that were never read.
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).not.toHaveText("Cuentas");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();

  await page.unroute("**/cuentas.data*");
  await page.goto("/cuentas");
  await expect(rows(page)).toHaveCount(1);
});

test("with no Bill at all Cuentas says so, and how one comes to be there", async ({ page, signInAs }) => {
  await signInAs("admin", "Ana");
  await page.goto("/cuentas");

  await expect(page.getByRole("main")).toContainText("No hay cuentas todavía. Cada venta que se registra aparece aquí.");
  await expect(page.getByRole("link", { name: "Quitar filtros" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Cargar más" })).toHaveCount(0);
});

test("long names and large amounts stay whole on a 320px phone with text twice as large, and the keyboard filters and opens a Bill", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const ana = await signInAs("admin", "Ana");
  const largo = await addCustomer("María Guadalupe Hernández de la Torre y Villaseñor Montesdeoca", { by: ana });
  await addBill(query, {
    id: "grande",
    by: ana.id,
    at: 2000,
    customerId: largo.id,
    note: "Supercalifragilisticoexpialidoso-sin-espacios-para-partir-la-nota-en-dos",
    total: 1234567890,
    paid: 234567890,
    state: "partial",
  });
  await addBill(query, { id: "cancelada", by: ana.id, at: 1000, total: 1234567890, paid: 1234567890, state: "voided" });

  await page.goto("/cuentas");
  await page.addStyleTag({ content: "html { font-size: 200% }" });

  await expect(rows(page).nth(0)).toContainText("María Guadalupe Hernández de la Torre y Villaseñor Montesdeoca");
  await expect(rows(page).nth(0)).toContainText("Debe $10,000,000.00");
  await expect(rows(page).nth(0)).toContainText("Total $12,345,678.90 · Pagado $2,345,678.90");
  expect(await cutOff(page.getByRole("main"))).toEqual([]);
  expect(await nothingSideways(page)).toBe(true);

  // With the keyboard alone: a state is chosen and asked for, and a Bill is opened.
  await page.getByLabel("Estado").focus();
  await page.getByLabel("Estado").selectOption({ label: "Cancelada" });
  await page.getByRole("button", { name: "Filtrar" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/estado=voided/);
  await expect(rows(page)).toHaveCount(1);
  // The keyboard is still where it was: on the button that asked.
  await expect(page.getByRole("button", { name: "Filtrar" })).toBeFocused();
  await page.addStyleTag({ content: "html { font-size: 200% }" });
  expect(await cutOff(page.getByRole("main"))).toEqual([]);
  expect(await nothingSideways(page)).toBe(true);

  await rows(page).first().getByRole("link").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/cuentas\/cancelada$/);
  await expect(page.getByRole("heading", { name: "Cuenta", exact: true, level: 1 })).toBeVisible();
});

test("a Worker is refused Cuentas and sees no past Bills; an Admin sees Pagadas and Canceladas", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Pan dulce", price: 1000, category: bebidas });
  const ruiz = await addCustomer("Familia Ruiz", { by: ana });

  await page.goto("/");
  await sell.leaveOpen(page, { items: ["Pan dulce"], customer: "Familia Ruiz" });
  const [{ id: pagada }] = (await query("SELECT id FROM bills")) as Array<{ id: string }>;
  await query("UPDATE bills SET paid = total, state = 'paid' WHERE id = ?", [pagada]);
  // The Bill before it is no longer Open, so this starts a new one.
  await sell.leaveOpen(page, { items: ["Pan dulce", "Pan dulce"], customer: "Familia Ruiz" });
  const [{ id: cancelada }] = (await query("SELECT id FROM bills WHERE state = 'open'")) as Array<{ id: string }>;
  await query("UPDATE bills SET state = 'voided' WHERE id = ?", [cancelada]);
  await sell.leaveOpen(page, { items: ["Pan dulce", "Pan dulce", "Pan dulce"], customer: "Familia Ruiz" });

  // A Worker: no Cuentas at all, by its link, its address or its data, and no
  // past Bills on the Customer's page.
  await signInAs("worker", "Beto");
  await page.goto("/mas");
  await expect(page.getByRole("main").getByRole("link", { name: "Cuentas", exact: true })).toHaveCount(0);
  const refused = await page.goto("/cuentas");

  expect(refused?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "No tienes acceso a esta página" })).toBeVisible();
  await expect(page.locator("[data-bill-id]")).toHaveCount(0);
  expect((await page.request.get("/cuentas.data")).status()).toBe(403);
  expect(await nothingSideways(page)).toBe(true);

  await page.goto(`/clientes/${ruiz.id}`);

  await expect(page.getByRole("heading", { name: "Familia Ruiz", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cuentas abiertas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cuentas pasadas" })).toHaveCount(0);

  // An Admin sees both past Bills on the Customer's page, newest first.
  await signInAs("admin", "Ana");
  await page.goto(`/clientes/${ruiz.id}`);

  await expect(page.getByRole("heading", { name: "Cuentas pasadas" })).toBeVisible();
  const past = page.getByRole("list", { name: "Cuentas pasadas" }).getByRole("listitem");
  await expect(past).toHaveCount(2);
  await expect(past.nth(0)).toContainText("Cancelada");
  await expect(past.nth(1)).toContainText("Pagada");
  // The Open Bill stays where it was.
  await expect(page.getByRole("list", { name: "Cuentas abiertas" }).getByRole("listitem")).toHaveCount(1);

  // A past Bill opens its Cuenta.
  await past.nth(1).getByRole("link").click();

  await expect(page.getByRole("heading", { name: "Cuenta", level: 1 })).toBeVisible();
  await expect(page.locator("main")).toContainText("Pagada");
});
