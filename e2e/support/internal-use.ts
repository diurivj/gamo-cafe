import type { Page } from "@playwright/test";

import { expect } from "../fixtures";

/**
 * Consumo interno as any User drives it (spec §4.1): one step that takes the
 * Item, the units and a note, then its confirmed result, which stays until
 * the User goes on. No Stock is shown anywhere on it.
 *
 *     await page.goto("/consumo-interno");
 *     await recordInternalUse(page, { item: "Agua mineral", units: "2" });   // ends on "Consumo interno registrado"
 *     await anotherInternalUse(page);                                       // the step again, empty
 */

export interface TypedInternalUse {
  readonly item?: string;
  readonly units: string;
  readonly note?: string;
}

const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { name, level: 1 });

/** Where Consumo interno sends an Internal use. */
export const INTERNAL_USE = "**/consumo-interno/registrar";

/** Fills the step, without sending it. */
export async function typeInternalUse(page: Page, use: TypedInternalUse) {
  if (use.item) await page.getByLabel("Producto", { exact: true }).selectOption({ label: use.item });
  await page.getByLabel("Unidades", { exact: true }).fill(use.units);
  if (use.note) await page.getByLabel("Nota (opcional)").fill(use.note);
}

/** A whole Internal use from the step on screen: the fields and its action, to its result. */
export async function recordInternalUse(page: Page, use: TypedInternalUse) {
  await typeInternalUse(page, use);
  await page.getByRole("button", { name: `Registrar consumo interno de ${use.units.trim()}` }).click();
  await expect(title(page, "Consumo interno registrado")).toBeVisible();
}

/** From a confirmed result to the step again, empty. */
export async function anotherInternalUse(page: Page) {
  await page.getByRole("button", { name: "Registrar otro consumo" }).click();
  await expect(title(page, "Consumo interno")).toBeVisible();
}
