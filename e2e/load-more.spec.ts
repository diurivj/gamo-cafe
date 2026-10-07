import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// **Cargar más** (spec §3.4), on Cuentas abiertas: every paged list uses the
// same component (`~/components/paged-list`), so what is true here is true of
// Cuentas, a Customer's past Bills, Historial, Diferencias and Por cobrar.
// Both projects run a phone viewport (playwright.config.ts).

type Query = (sql: string, params?: Array<string | number | null>) => Promise<unknown>;

/** `count` Open Bills, one millisecond apart, so `prefix + count` is the newest. */
const openBills = (query: Query, by: string, prefix: string, count: number, customerId: string | null = null) =>
  query(
    `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ?)
     INSERT INTO bills (id, day, opened_by, opened_at, customer_id, note, total, paid, state, revision)
     SELECT ? || x, '2026-09-30', ?, ? + x, ?, 'Nota ' || x, 100, 0, 'open', 0 FROM n`,
    [count, prefix, by, customerId === null ? Date.now() : 1000, customerId],
  );

const rows = (page: Page) => page.getByRole("list", { name: "Cuentas abiertas" }).getByRole("listitem");
const more = (page: Page) => page.getByRole("link", { name: "Cargar más" });
const status = (page: Page) => page.getByRole("main").getByRole("status");

/** Leaves only the User's own taps and keys to load a page. */
const withoutScrollLoading = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", { value: undefined });
  });

test("the first load shows one page; Cargar más appends the next from the keyboard, says so, and stops at the end", async ({
  page,
  signInAs,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  await openBills(query, beto.id, "e2e-abierta-", 120);
  await withoutScrollLoading(page);
  // Slow enough to see what the screen says while a page is on its way.
  await page.route(/cuentas-abiertas\.data/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });

  await page.goto("/cuentas-abiertas");

  await expect(rows(page)).toHaveCount(50);
  await expect(rows(page).first()).toContainText("Nota 120");

  await more(page).focus();
  await page.keyboard.press("Enter");

  await expect(status(page)).toHaveText("Cargando…");
  await expect(more(page)).toHaveAttribute("aria-busy", "true");
  await expect(rows(page)).toHaveCount(100);
  await expect(status(page)).toHaveText("");
  // Appended in place: the URL is still the list's, and focus stays on the control.
  await expect(page).toHaveURL(/\/cuentas-abiertas$/);
  await expect(more(page)).toBeFocused();

  await page.keyboard.press("Enter");

  await expect(rows(page)).toHaveCount(120);
  await expect(rows(page).last()).toContainText("Nota 1");
  // Nothing follows: the control is gone, and focus is on what says so.
  await expect(more(page)).toHaveCount(0);
  await expect(status(page)).toHaveText("No hay más.");
  await expect(status(page)).toBeFocused();
  // No row twice.
  const ids = await rows(page).evaluateAll((items) => items.map((item) => item.getAttribute("data-bill-id")));
  expect(new Set(ids).size).toBe(120);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the next page loads by itself when the control scrolls into view", async ({ page, signInAs, query }) => {
  const beto = await signInAs("worker", "Beto");
  await openBills(query, beto.id, "e2e-scroll-", 120);

  await page.goto("/cuentas-abiertas");
  await expect(rows(page)).toHaveCount(50);

  await more(page).scrollIntoViewIfNeeded();
  await expect(rows(page)).toHaveCount(100);

  await more(page).scrollIntoViewIfNeeded();
  await expect(rows(page)).toHaveCount(120);
  await expect(more(page)).toHaveCount(0);
});

test("coming back to the list restores what was loaded and where it was scrolled to", async ({
  page,
  signInAs,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  await openBills(query, beto.id, "e2e-volver-", 120);
  await withoutScrollLoading(page);

  await page.goto("/cuentas-abiertas");
  await more(page).click();
  await expect(rows(page)).toHaveCount(100);

  // A Bill of the second page: Nota 40 is the 81st row.
  const bill = rows(page).filter({ has: page.getByText("Nota 40", { exact: true }) }).getByRole("link");
  await bill.click();
  await expect(page).toHaveURL(/\/cuentas\/e2e-volver-40$/);
  await expect(page.getByRole("heading", { name: "Cuenta", exact: true, level: 1 })).toBeVisible();

  // Paid meanwhile on another phone: the list that comes back must not show it.
  await query("UPDATE bills SET paid = total, state = 'paid' WHERE id = 'e2e-volver-41'");

  await page.goBack();

  await expect(bill).toBeInViewport();
  // The loaded pages are fetched again behind what was restored.
  await expect(rows(page).filter({ has: page.getByText("Nota 41", { exact: true }) })).toHaveCount(0);
  await expect(rows(page)).toHaveCount(100);
  await expect(bill).toBeInViewport();
});

test("Cuenta's own way back to the list restores it as the browser's Back does, search included", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const ruiz = await addCustomer("Familia Lejana", { by: beto });
  await openBills(query, beto.id, "e2e-regreso-", 120, ruiz.id);
  await openBills(query, beto.id, "e2e-de-otros-", 5);
  await withoutScrollLoading(page);

  await page.goto("/cuentas-abiertas");
  await page.getByLabel("Buscar por cliente").fill("familia le");
  await expect(rows(page)).toHaveCount(50);
  await more(page).click();
  await expect(rows(page)).toHaveCount(100);

  const bill = rows(page).filter({ has: page.getByText("Nota 40", { exact: true }) }).getByRole("link");
  await bill.click();
  await expect(page).toHaveURL(/\/cuentas\/e2e-regreso-40$/);

  // Through the Cobrar step and back, and then the screen's own link to the list.
  await page.getByRole("link", { name: "Cobrar", exact: true }).click();
  await page.getByRole("button", { name: "Volver a la cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Cuenta", exact: true, level: 1 })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Cuentas abiertas" }).click();

  await expect(page).toHaveURL(/\/cuentas-abiertas\?q=familia\+le$/);
  await expect(page.getByLabel("Buscar por cliente")).toHaveValue("familia le");
  await expect(rows(page)).toHaveCount(100);
  await expect(bill).toBeInViewport();

  // Opened by its address there is no list behind it: the link leads to a new one.
  await page.goto("/cuentas/e2e-regreso-40");
  await page.getByRole("main").getByRole("link", { name: "Cuentas abiertas" }).click();
  await expect(page).toHaveURL(/\/cuentas-abiertas$/);
  await expect(rows(page)).toHaveCount(50);
});

test("the Customer search finds a Bill that is not on the first page", async ({
  page,
  signInAs,
  addCustomer,
  query,
}) => {
  const beto = await signInAs("worker", "Beto");
  const ruiz = await addCustomer("Familia Lejana", { by: beto });
  await openBills(query, beto.id, "e2e-de-ruiz-", 1, ruiz.id);
  await openBills(query, beto.id, "e2e-de-nadie-", 60);
  await withoutScrollLoading(page);

  await page.goto("/cuentas-abiertas");
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByText("Familia Lejana")).toHaveCount(0);

  await page.getByLabel("Buscar por cliente").fill("familia le");

  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Familia Lejana");
  await expect(more(page)).toHaveCount(0);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("Cargar más is a link to the next page", async ({ page, signInAs, query }) => {
    const beto = await signInAs("worker", "Beto");
    await openBills(query, beto.id, "e2e-sin-js-", 70);

    await page.goto("/cuentas-abiertas");
    await expect(rows(page)).toHaveCount(50);
    await expect(rows(page).last()).toContainText("Nota 21");

    await more(page).click();

    await expect(page).toHaveURL(/desde=/);
    await expect(rows(page)).toHaveCount(20);
    await expect(rows(page).first()).toContainText("Nota 20");
    await expect(more(page)).toHaveCount(0);
  });
});
