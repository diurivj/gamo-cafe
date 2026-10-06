import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// Cuentas (spec §6.2) and a Customer's past Bills (§6.1): every Bill with its
// state, filtered by Day, state or Customer, 50 per page; the Admin-only pages
// a Worker is refused. Both projects run a phone viewport (playwright.config.ts).

const menu = (page: Page, category = "Bebidas") => page.getByRole("region", { name: category });

/** Builds a selection on Vender and leaves the Bill open, as §8.2 does. */
async function leaveOpen(
  page: Page,
  sale: {
    readonly items: ReadonlyArray<string>;
    readonly customer?: string;
    readonly note?: string;
    /** What the recorded answer says, so the next step starts after this one. */
    readonly total: string;
    readonly category?: string;
  },
) {
  for (const item of sale.items)
    await menu(page, sale.category).getByRole("button", { name: new RegExp(item) }).click();
  if (sale.customer) {
    await page.getByLabel("Cliente", { exact: true }).pressSequentially(sale.customer.slice(0, 8));
    await page.getByRole("list", { name: "Coincidencias" }).getByRole("button", { name: sale.customer }).click();
  }
  if (sale.note) await page.getByLabel("Nota (opcional)").fill(sale.note);
  await page.getByRole("button", { name: "Dejar abierta" }).click();
  // The answer for *this* sale: a previous one's message must not pass for it.
  await expect(page.getByRole("status")).toContainText(`por ${sale.total}.`);
}

test("Cuentas lists every Bill with its state and filters by Day, state and Customer", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas");
  await addItem({ name: "Café de olla", price: 2500, category: bebidas, stock: { units: 10, by: ana } });
  const ruiz = await addCustomer("Familia Ruiz", { by: ana });
  const pena = await addCustomer("Familia Paz", { by: ana });

  await page.goto("/");
  await leaveOpen(page, { items: ["Café de olla"], customer: "Familia Ruiz", total: "$25.00" });
  await leaveOpen(page, { items: ["Café de olla", "Café de olla"], customer: "Familia Paz", total: "$50.00" });
  await leaveOpen(page, { items: ["Café de olla"], note: "Sin cliente", total: "$25.00" });

  const bills = (await query("SELECT id, customer_id, note, state FROM bills")) as Array<{
    id: string;
    customer_id: string | null;
    note: string | null;
    state: string;
  }>;
  const deRuiz = bills.find((bill) => bill.customer_id === ruiz.id)!;
  const dePena = bills.find((bill) => bill.customer_id === pena.id)!;
  const sinCliente = bills.find((bill) => bill.customer_id === null)!;
  // The projections a Payment, a Void and another Day's Bill write (tickets 08,
  // 11); this test is about the list, not about recording them.
  await query("UPDATE bills SET paid = total, state = 'paid' WHERE id = ?", [deRuiz.id]);
  await query("UPDATE bills SET state = 'voided' WHERE id = ?", [dePena.id]);
  await query("UPDATE bills SET day = '2026-09-30' WHERE id = ?", [sinCliente.id]);

  await page.goto("/cuentas");

  await expect(page.getByRole("heading", { name: "Cuentas", level: 1 })).toBeVisible();
  const rows = page.getByRole("list", { name: "Cuentas" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  // Newest first: the note-only Bill, then Cancelada, then Pagada.
  await expect(rows.nth(0)).toContainText("Sin cliente");
  await expect(rows.nth(0)).toContainText("Abierta");
  await expect(rows.nth(1)).toContainText("Familia Paz");
  await expect(rows.nth(1)).toContainText("Cancelada");
  await expect(rows.nth(1)).toContainText("Total $50.00");
  await expect(rows.nth(2)).toContainText("Familia Ruiz");
  await expect(rows.nth(2)).toContainText("Pagada");
  await expect(rows.nth(2)).toContainText("Total $25.00 · Pagado $25.00 · Debe $0.00");

  // Filter by state.
  await page.getByLabel("Estado").selectOption("paid");
  await page.getByRole("button", { name: "Filtrar" }).click();

  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Familia Ruiz");

  // Filter by Day.
  await page.goto("/cuentas");
  await page.getByLabel("Día", { exact: true }).fill("2026-09-30");
  await page.getByRole("button", { name: "Filtrar" }).click();

  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Sin cliente");

  // Filter by Customer, choosing one from the picker.
  await page.goto("/cuentas");
  await page.getByLabel("Cliente", { exact: true }).pressSequentially("Familia P");
  await page.getByRole("list", { name: "Coincidencias" }).getByRole("button", { name: "Familia Paz" }).click();
  await page.getByRole("button", { name: "Filtrar" }).click();

  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Familia Paz");

  // Each row opens Cuenta.
  await rows.first().getByRole("link").click();

  await expect(page.getByRole("heading", { name: "Cuenta", level: 1 })).toBeVisible();
  await expect(page.locator("main")).toContainText("Cancelada");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Cuentas holds 50 Bills per page and pages through the rest", async ({ page, signInAs, query }) => {
  const ana = await signInAs("admin", "Ana");
  await query(
    `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 55)
     INSERT INTO bills (id, day, opened_by, opened_at, customer_id, total, paid, state, revision)
     SELECT 'e2e-pagina-' || x, '2026-09-30', ?, ? + x, NULL, 100, 0, 'open', 0 FROM n`,
    [ana.id, Date.now()],
  );

  await page.goto("/cuentas");
  await page.getByLabel("Día", { exact: true }).fill("2026-09-30");
  await page.getByRole("button", { name: "Filtrar" }).click();

  const rows = page.getByRole("list", { name: "Cuentas" }).getByRole("listitem");
  await expect(rows).toHaveCount(50);
  await expect(page.getByText("Página 1")).toBeVisible();
  await expect(page.getByRole("link", { name: "Anterior" })).toHaveCount(0);

  await page.getByRole("link", { name: "Siguiente" }).click();

  await expect(rows).toHaveCount(5);
  await expect(page.getByText("Página 2")).toBeVisible();
  await expect(page.getByRole("link", { name: "Siguiente" })).toHaveCount(0);
  // The filters survive the page change.
  await expect(page).toHaveURL(/dia=2026-09-30/);

  await page.getByRole("link", { name: "Anterior" }).click();

  await expect(rows).toHaveCount(50);
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
  await leaveOpen(page, { items: ["Pan dulce"], customer: "Familia Ruiz", total: "$10.00" });
  const [{ id: pagada }] = (await query("SELECT id FROM bills")) as Array<{ id: string }>;
  await query("UPDATE bills SET paid = total, state = 'paid' WHERE id = ?", [pagada]);
  // The Bill before it is no longer Open, so this starts a new one.
  await leaveOpen(page, { items: ["Pan dulce", "Pan dulce"], customer: "Familia Ruiz", total: "$20.00" });
  const [{ id: cancelada }] = (await query("SELECT id FROM bills WHERE state = 'open'")) as Array<{ id: string }>;
  await query("UPDATE bills SET state = 'voided' WHERE id = ?", [cancelada]);
  await leaveOpen(page, {
    items: ["Pan dulce", "Pan dulce", "Pan dulce"],
    customer: "Familia Ruiz",
    total: "$30.00",
  });

  // A Worker: no Cuentas at all, and no past Bills on the Customer's page.
  await signInAs("worker", "Beto");
  const refused = await page.goto("/cuentas");

  expect(refused?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "No tienes acceso a esta página" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

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
