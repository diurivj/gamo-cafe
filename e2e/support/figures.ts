import type { Locator, Page } from "@playwright/test";

import { expect } from "../fixtures";

/** The four amounts `FiguresPanel` shows, in the order it shows them. */
export interface ShownFigures {
  readonly cobrado: string;
  readonly efectivo: string;
  readonly transferencia: string;
  readonly vendido: string;
}

/**
 * Asserts each figure of a panel by what it is, not by an amount that is
 * somewhere on the page:
 *
 *     await expectFigures(page.getByRole("region", { name: "Resumen" }), {
 *       cobrado: "$49.00", efectivo: "$49.00", transferencia: "$0.00", vendido: "$49.00",
 *     });
 */
export async function expectFigures(scope: Locator | Page, figures: ShownFigures) {
  await expect(scope.locator('[data-figure="collected"]')).toHaveText(figures.cobrado);
  await expect(scope.locator('[data-figure="cash"]')).toHaveText(figures.efectivo);
  await expect(scope.locator('[data-figure="transfer"]')).toHaveText(figures.transferencia);
  await expect(scope.locator('[data-figure="sold"]')).toHaveText(figures.vendido);
  // Collected leads, and Sold comes after its split (UI redesign §7.1).
  await expect(scope.getByRole("term")).toHaveText(["Cobrado", "Efectivo", "Transferencia", "Vendido"]);
}
