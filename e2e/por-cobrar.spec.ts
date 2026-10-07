import type { Page } from "@playwright/test";

import { dayOf } from "../app/shared/day.ts";
import { expect, test } from "./fixtures";
import { goTo } from "./support/navigate";

// Por cobrar (spec §6.2, §4.1): each Customer with what they owe and the Day
// of their oldest Open Bill, then the Open Bills with no Customer, flagged
// when from an earlier Day, and the overall Owed at the top. Both projects run
// a phone viewport (playwright.config.ts).

const menu = (page: Page, category: string) => page.getByRole("region", { name: category });

/** Builds a selection on Vender and leaves the Bill open, as §8.2 does. */
async function leaveOpen(
  page: Page,
  sale: {
    readonly items: ReadonlyArray<string>;
    readonly customer?: string;
    readonly note?: string;
    /** What the recorded answer says, so the next step starts after this one. */
    readonly total: string;
    readonly category: string;
  },
) {
  for (const item of sale.items)
    await menu(page, sale.category).getByRole("button", { name: new RegExp(item) }).click();
  if (sale.customer) {
    await page.getByLabel("Cliente", { exact: true }).pressSequentially(sale.customer.slice(0, 4));
    await page.getByRole("list", { name: "Coincidencias" }).getByRole("button", { name: sale.customer }).click();
  }
  if (sale.note) await page.getByLabel("Nota (opcional)").fill(sale.note);
  await page.getByRole("button", { name: "Dejar abierta" }).click();
  // The answer for *this* sale: a previous one's message must not pass for it.
  await expect(page.getByRole("status")).toContainText(`por ${sale.total}.`);
}

test("an Admin sees what each Customer owes, then the Open Bills with no Customer, the ones from an earlier Day flagged", async ({
  page,
  signInAs,
  addCategory,
  addItem,
  addCustomer,
  query,
}) => {
  const ana = await signInAs("admin", "Ana");
  const bebidas = await addCategory("Bebidas por cobrar");
  await addItem({ name: "Agua por cobrar", price: 1850, category: bebidas, stock: { units: 10, by: ana } });
  await addItem({ name: "Café por cobrar", price: 2500, category: bebidas, stock: { units: 10, by: ana } });
  await addCustomer("Familia Deudora", { by: ana });

  await page.goto("/");
  await leaveOpen(page, {
    items: ["Agua por cobrar"],
    customer: "Familia Deudora",
    total: "$18.50",
    category: bebidas.name,
  });
  await leaveOpen(page, { items: ["Café por cobrar"], total: "$25.00", category: bebidas.name });
  await leaveOpen(page, { items: ["Café por cobrar"], note: "Se lo llevó Sofía", total: "$25.00", category: bebidas.name });

  // The loose Bill without a note moves two Days back; the Worker's clock
  // cannot be moved, and two Days back is always an earlier Day in the
  // cafeteria's time zone.
  const loose = (await query("SELECT id, note FROM bills WHERE customer_id IS NULL ORDER BY opened_at")) as Array<{
    id: string;
    note: string | null;
  }>;
  const [older] = loose.filter((bill) => bill.note === null);
  await query("UPDATE bills SET day = ? WHERE id = ?", [dayOf(Date.now() - 2 * 86_400_000), older!.id]);

  // The navigation entry leads there.
  await goTo(page, "Por cobrar");

  await expect(page.getByRole("heading", { name: "Por cobrar", level: 1 })).toBeVisible();
  await expect(page.getByText("Total por cobrar")).toContainText("$68.50");

  // The Customer row: what they owe and the Day of their oldest Open Bill.
  const customerRows = page.getByRole("list", { name: "Clientes por cobrar" }).getByRole("listitem");
  await expect(customerRows).toHaveCount(1);
  const customerRow = customerRows.getByRole("link", { name: /Familia Deudora/ });
  await expect(customerRow).toContainText("$18.50");
  await expect(customerRow).toContainText("Cuenta más antigua:");

  // The loose Bills, oldest first: only the one from an earlier Day is flagged.
  const looseRows = page.getByRole("list", { name: "Cuentas sin cliente" }).getByRole("listitem");
  await expect(looseRows).toHaveCount(2);
  await expect(looseRows.nth(0)).toContainText("De un día anterior");
  await expect(looseRows.nth(1)).not.toContainText("De un día anterior");
  await expect(page.getByText("De un día anterior")).toHaveCount(1);

  // A Customer row opens the Customer page.
  await customerRow.click();
  await expect(page).toHaveURL(/\/clientes\//);
  await expect(page.getByRole("heading", { name: "Familia Deudora", level: 1 })).toBeVisible();

  // A loose row opens its Cuenta.
  await page.goto("/por-cobrar");
  await looseRows.nth(1).getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Cuenta", level: 1 })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a Worker who opens Por cobrar by its address gets nothing", async ({ page, signInAs, addCategory, addItem }) => {
  const ana = await signInAs("admin", "Ana");
  const bebidas = await addCategory("Reservado por cobrar");
  await addItem({ name: "Producto reservado por cobrar", category: bebidas, stock: { units: 1, by: ana } });
  await signInAs("worker", "Beto");

  const response = await page.goto("/por-cobrar");

  expect(response?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "Por cobrar" })).toHaveCount(0);
  await expect(page.getByText("Total por cobrar")).toHaveCount(0);
});
