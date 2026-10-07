import type { Page } from "@playwright/test";

import { expect } from "../fixtures";

/** The role's four destinations: the bar at the bottom of a phone, the column at the side of a laptop. */
export const destinations = (page: Page) => page.getByRole("navigation", { name: "Principal" });

/**
 * Opens a screen by its name the way a User does: from the four destinations,
 * or from Más when it is not one of them.
 *
 *     await goTo(page, "Productos");   // Más, then Productos
 *     await goTo(page, "Vender");      // one tap
 */
export async function goTo(page: Page, name: string) {
  const bar = destinations(page);
  await expect(bar).toBeVisible();
  const direct = bar.getByRole("link", { name, exact: true });
  if ((await direct.count()) > 0) return direct.click();

  await bar.getByRole("link", { name: "Más", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Más", level: 1 })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name, exact: true }).click();
}
