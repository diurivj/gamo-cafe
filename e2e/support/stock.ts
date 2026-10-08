import type { Page } from "@playwright/test";

import { expect } from "../fixtures";

/**
 * Inventario as an Admin drives it (UI redesign §7): the Stock of each Item,
 * the step that records an Adjustment, the recent Adjustments, the step that
 * cancels one, and each confirmed result, which stays until the Admin goes on.
 *
 *     await page.goto("/inventario");
 *     await adjust(page, { item: "Agua mineral", reason: "Merma", units: "2" });  // ends on "Merma registrada"
 *     await seeStock(page);                                                        // back on the list, read again
 *     await expectStock(page, "Agua mineral", 8);
 *     await openAdjustments(page);
 *     await cancelAdjustment(page, "Merma de 2 de Agua mineral", "Se contó mal"); // ends on "Ajuste cancelado"
 */

export type Reason = "Entrada" | "Merma" | "Consumo interno";

export interface TypedAdjustment {
  /** Chosen in the step; leave it out when the step was opened from the Item's row. */
  readonly item?: string;
  /** Defaults to what the step opened with: Entrada. */
  readonly reason?: Reason;
  readonly units: string;
  readonly note?: string;
}

const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { name, level: 1 });

/** Where Inventario sends a change of Stock. */
export const STOCK_CHANGE = "**/inventario/ajustar";

/** An Item's row of the list. */
export const stockRow = (page: Page, name: string) =>
  page.getByRole("list", { name: "Existencias" }).getByRole("listitem", { name, exact: true });

/** The Stock an Item's row shows. */
export const expectStock = (page: Page, name: string, units: number) =>
  expect(stockRow(page, name).locator('[data-figure="stock"]')).toHaveText(String(units));

/** The recent Adjustments, newest first. */
export const recentAdjustments = (page: Page) =>
  page.getByRole("list", { name: "Ajustes recientes" }).getByRole("listitem");

/** Fills the step that records an Adjustment, without sending it. */
export async function typeAdjustment(page: Page, adjustment: TypedAdjustment) {
  if (adjustment.item) await page.getByLabel("Producto", { exact: true }).selectOption({ label: adjustment.item });
  if (adjustment.reason) await page.getByRole("radio", { name: new RegExp(`^${adjustment.reason}`) }).check();
  await page.getByLabel("Unidades", { exact: true }).fill(adjustment.units);
  if (adjustment.note) await page.getByLabel("Nota (opcional)").fill(adjustment.note);
}

/** A whole Adjustment from the list on screen: Registrar entrada, the fields, and its action. */
export async function adjust(page: Page, adjustment: TypedAdjustment) {
  await page.getByRole("link", { name: "Registrar entrada", exact: true }).click();
  await expect(title(page, /^Registrar /)).toBeVisible();
  await typeAdjustment(page, adjustment);
  await page.getByRole("button", { name: /^Registrar .+ de \d+$/ }).click();
  await expect(title(page, /registrad[ao]$/)).toBeVisible();
}

/** From a confirmed result back to the list, read again. */
export async function seeStock(page: Page) {
  await page.getByRole("button", { name: "Volver a Inventario" }).click();
  await expect(title(page, "Inventario")).toBeVisible();
}

/** From the list to the recent Adjustments. */
export async function openAdjustments(page: Page) {
  await page.getByRole("link", { name: "Ajustes recientes", exact: true }).click();
  await expect(title(page, "Ajustes recientes")).toBeVisible();
}

/** From the recent Adjustments to the step that cancels one, named as its row is: "Merma de 2 de Agua mineral". */
export async function openCancel(page: Page, name: string) {
  await page
    .getByRole("list", { name: "Ajustes recientes" })
    .getByRole("listitem", { name, exact: true })
    .getByRole("link", { name: "Cancelar ajuste" })
    .first()
    .click();
  await expect(title(page, "Cancelar ajuste")).toBeVisible();
}

/** A whole cancellation from the recent Adjustments on screen. */
export async function cancelAdjustment(page: Page, name: string, why: string) {
  await openCancel(page, name);
  await page.getByLabel("Motivo de la cancelación").fill(why);
  await page.getByRole("button", { name: /^Cancelar .+ de \d+$/ }).click();
  await expect(title(page, "Ajuste cancelado")).toBeVisible();
}
