import type { Locator, Page } from "@playwright/test";

import { expect } from "../fixtures";

/**
 * Conteo as an Admin drives it (UI redesign §7): the fields that take what is
 * on the shelf, the review, and the recorded Count, which stays until the
 * Admin goes on.
 *
 *     await page.goto("/inventario/conteo");
 *     await typeCount(page, { "Agua mineral": "8", "Pan dulce": "0" }, "De la tarde");
 *     await reviewCount(page);                                   // ends on "Revisar conteo", read
 *     await expectLine(reviewed(page, "Agua mineral"), { expected: 10, found: 8, discrepancy: "Faltante: 2" });
 *     await recordCount(page);                                   // ends on "Conteo registrado"
 */

const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { name, level: 1 });

/** Where Conteo asks for a review and sends a Count. */
export const COUNT_RECORD = "**/inventario/conteo/registrar";

/** The field that takes what was found of an Item, named by the Item alone. */
export const countField = (page: Page, item: string) => page.getByLabel(item, { exact: true });

/** Types what was found, by Item name, and the note; sends nothing. */
export async function typeCount(page: Page, found: Readonly<Record<string, string>>, note?: string) {
  for (const [item, units] of Object.entries(found)) await countField(page, item).fill(units);
  if (note !== undefined) await page.getByLabel("Nota (opcional)").fill(note);
}

/** From the fields to the review, once what was expected has been read. */
export async function reviewCount(page: Page) {
  await page.getByRole("button", { name: "Revisar conteo" }).click();
  await expect(title(page, "Revisar conteo")).toBeVisible();
  await expect(page.getByRole("list", { name: "Revisión del conteo" })).toBeVisible();
}

/** An Item's line of the review. */
export const reviewed = (page: Page, item: string) =>
  page.getByRole("list", { name: "Revisión del conteo" }).getByRole("listitem", { name: item, exact: true });

/** An Item's line of the Count that was recorded. */
export const recorded = (page: Page, item: string) =>
  page.getByRole("list", { name: "Conteo registrado" }).getByRole("listitem", { name: item, exact: true });

/** What a line of a Count says: expected, found and the Discrepancy in words. */
export async function expectLine(
  line: Locator,
  says: { readonly expected: number; readonly found: number; readonly discrepancy: string },
) {
  await expect(line.locator('[data-figure="expected"]')).toHaveText(`Esperado: ${says.expected}`);
  await expect(line.locator('[data-figure="found"]')).toHaveText(`Contado: ${says.found}`);
  await expect(line.locator('[data-figure="discrepancy"]')).toHaveText(says.discrepancy);
}

/** The review's one action, and the recorded Count it ends on. */
export async function recordCount(page: Page) {
  await page.getByRole("button", { name: /^Registrar conteo de \d+ productos?$/ }).click();
  await expect(title(page, "Conteo registrado")).toBeVisible();
}
