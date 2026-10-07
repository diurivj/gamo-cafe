import type { Page } from "@playwright/test";

import { expect } from "../fixtures";

/**
 * Vender as a User drives it (UI redesign §5): step 1 chooses the Items, step
 * 2 reviews them and records a Payment or leaves the Bill Open, and the
 * confirmed result stays until **Nueva venta**.
 *
 *     await page.goto("/");
 *     const billId = await leaveOpen(page, { items: ["Agua mineral"], customer: "Familia Ruiz" });
 *     await pay(page, { items: [["Café de olla", 2]], handed: "100" });
 *
 * Each of the whole-sale helpers starts a new sale first when the last one's
 * result is still on screen, and ends on its own confirmed result.
 */

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An Item on step 1: the button that adds one unit of it. Its name is the Item's and its price. */
export const itemButton = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${escaped(name)}\\s*\\$`) });

/** The total that sticks to the bottom of step 1, with the way forward. */
export const totalBar = (page: Page) => page.getByRole("region", { name: "Total" });

/** The selection as step 2, a sale on its way and a confirmed one show it. */
export const selection = (page: Page) => page.getByRole("region", { name: "Selección" });

/** The confirmed result of the last sale; it carries the Bill's id. */
export const confirmed = (page: Page) => page.locator("[data-bill-id]");

export type SaleItems = ReadonlyArray<string | readonly [name: string, units: number]>;

/** Adds units of Items on step 1, one tap each. */
export async function select(page: Page, items: SaleItems) {
  for (const item of items) {
    const [name, units] = typeof item === "string" ? [item, 1] : item;
    for (let unit = 0; unit < units; unit++) await itemButton(page, name).click();
  }
}

/** Step 1 to step 2. */
export async function review(page: Page) {
  await totalBar(page).getByRole("button").click();
  await expect(selection(page)).toBeVisible();
}

/** Chooses a Customer in step 2's picker by typing the start of the name. */
export async function chooseCustomer(page: Page, name: string) {
  await page.getByLabel("Cliente", { exact: true }).pressSequentially(name.slice(0, 8));
  await page.getByRole("list", { name: "Coincidencias" }).getByRole("button", { name }).click();
  await expect(page.getByRole("group", { name: "Cliente" })).toContainText(name);
}

export async function newSale(page: Page) {
  await page.getByRole("button", { name: "Nueva venta" }).click();
  await expect(page.getByRole("heading", { name: "Vender", level: 1 })).toBeVisible();
}

export interface Sale {
  readonly items: SaleItems;
  readonly customer?: string;
  readonly note?: string;
}

async function toReview(page: Page, sale: Sale) {
  if (await page.getByRole("button", { name: "Nueva venta" }).isVisible()) await newSale(page);
  await select(page, sale.items);
  await review(page);
  if (sale.customer) await chooseCustomer(page, sale.customer);
  if (sale.note) await page.getByLabel("Nota (opcional)").fill(sale.note);
}

/** The Bill the confirmed result on screen is about. */
async function recordedAs(page: Page, title: string): Promise<string> {
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  return (await confirmed(page).getAttribute("data-bill-id"))!;
}

/** A whole sale left Open, from step 1. Answers the Bill's id. */
export async function leaveOpen(page: Page, sale: Sale): Promise<string> {
  await toReview(page, sale);
  await page.getByRole("button", { name: "Dejar abierta" }).click();
  return recordedAs(page, "Cuenta abierta");
}

/**
 * A whole sale with its Payment, from step 1: everything in cash unless told
 * otherwise. `amount` pays only a part; `handed` is the cash handed over.
 */
export async function pay(
  page: Page,
  sale: Sale & { readonly method?: "Efectivo" | "Transferencia"; readonly amount?: string; readonly handed?: string },
): Promise<string> {
  await toReview(page, sale);
  if (sale.method) await page.getByRole("radio", { name: sale.method }).check();
  if (sale.amount) {
    await page.getByRole("button", { name: "Cobrar solo una parte" }).click();
    await page.getByLabel("Monto a cobrar").fill(sale.amount);
  }
  if (sale.handed) await page.getByLabel("Efectivo que te entregan (opcional)").fill(sale.handed);
  await page.getByRole("button", { name: /^Registrar pago de / }).click();
  return recordedAs(page, "Pago registrado");
}

/** Items added, with no Payment, to the Open Bill that Cuenta's **Agregar productos** opened Vender for. */
export async function addToBill(page: Page, items: SaleItems): Promise<string> {
  await select(page, items);
  await review(page);
  await page.getByRole("button", { name: "Agregar a la cuenta" }).click();
  return recordedAs(page, "Productos agregados");
}
