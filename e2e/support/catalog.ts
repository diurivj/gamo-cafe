import type { Page } from "@playwright/test";

import { expect } from "../fixtures";

/**
 * Productos as an Admin drives it (UI redesign §7): the catalog, the step
 * that adds an Item, the step of the Categories and the step of one of them.
 *
 *     await page.goto("/productos");
 *     await openNewItem(page);
 *     await typeItem(page, { name: "Agua mineral", price: "18.50", minimum: "6", stock: "24" });
 *     await page.getByRole("button", { name: "Agregar producto" }).click();
 *     await expect(said(page)).toContainText("Se agregó «Agua mineral».");
 *     await backTo(page, "Productos");
 *     await expect(catalogItem(page, "Agua mineral")).toContainText("$18.50");
 */

export const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { name, level: 1 });

/** What the last recorded form said. */
export const said = (page: Page) => page.getByRole("main").getByRole("status");

/** An Item's row of the catalog: the link to its page. */
export const catalogItem = (page: Page, name: string) =>
  page.getByRole("main").getByRole("link", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });

/** A Category of the catalog, with the Items it sells. */
export const catalogCategory = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

/** A Category's row of the step that orders them. */
export const categoryRow = (page: Page, name: string) =>
  page.getByRole("list", { name: "Categorías" }).getByRole("listitem", { name, exact: true });

/** The active Categories in their order, as the step that orders them lists them. */
export const categoryOrder = (page: Page) =>
  page
    .getByRole("list", { name: "Categorías" })
    .getByRole("listitem")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));

/** From the catalog to the step that adds an Item. */
export async function openNewItem(page: Page) {
  await page.getByRole("link", { name: "Agregar producto", exact: true }).click();
  await expect(title(page, "Agregar producto")).toBeVisible();
}

/** From the catalog to the step of the Categories. */
export async function openCategories(page: Page) {
  await page.getByRole("link", { name: "Categorías", exact: true }).click();
  await expect(title(page, "Categorías")).toBeVisible();
}

/** From the step of the Categories to the step of one, active or retired. */
export async function openCategory(page: Page, name: string) {
  const active = categoryRow(page, name).getByRole("link", { name: "Cambiar nombre o retirar" });
  const retired = page.getByRole("region", { name: "Categorías retiradas" }).getByRole("link", { name });
  await active.or(retired).click();
  await expect(title(page, name)).toBeVisible();
}

/** The way back a step or an Item's page shows, named after where it leads. */
export async function backTo(page: Page, name: "Productos" | "Categorías") {
  await page.getByRole("main").getByRole("link", { name, exact: true }).first().click();
  await expect(title(page, name)).toBeVisible();
}

export interface TypedItem {
  readonly name?: string;
  readonly price?: string;
  /** The Category's name; left as the form has it otherwise. */
  readonly category?: string;
  readonly tracked?: boolean;
  readonly minimum?: string;
  /** Starting Stock: only the step that adds an Item has the field. */
  readonly stock?: string;
}

/** Fills an Item's fields, new or existing, without sending them. */
export async function typeItem(page: Page, item: TypedItem) {
  if (item.name !== undefined) await page.getByLabel("Nombre", { exact: true }).fill(item.name);
  if (item.price !== undefined) await page.getByLabel("Precio", { exact: true }).fill(item.price);
  if (item.category) await page.getByLabel("Categoría", { exact: true }).selectOption({ label: item.category });
  if (item.tracked !== undefined) await page.getByLabel("Lleva inventario").setChecked(item.tracked);
  if (item.minimum !== undefined) await page.getByLabel("Mínimo (opcional)").fill(item.minimum);
  if (item.stock !== undefined) await page.getByLabel("Existencias iniciales (opcional)").fill(item.stock);
}

/** Adds an Item from the catalog and comes back to it. */
export async function addItemOnScreen(page: Page, item: TypedItem & { readonly name: string; readonly price: string }) {
  await openNewItem(page);
  await typeItem(page, item);
  await page.getByRole("button", { name: "Agregar producto" }).click();
  await expect(said(page)).toContainText(`Se agregó «${item.name}».`);
  await backTo(page, "Productos");
}
