import type { Locator } from "@playwright/test";

import { expect } from "../fixtures";
import { destinations } from "./navigate";

/**
 * What inside `scope` is wider than the room it has: text that is cut, or
 * that sticks out of its box. Empty when everything fits. A single pixel is
 * the browser rounding a width, not something cut.
 *
 *     expect(await cutOff(page.getByRole("main"))).toEqual([]);
 */
export const cutOff = (scope: Locator) =>
  scope.evaluate((root) =>
    [root, ...root.querySelectorAll("*")]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
      .map((element) => `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}"`),
  );

/**
 * The control that has the focus is whole on screen and above the bar at the
 * bottom. The page brings it there by the frame after it took the focus, or
 * after the bar grew (`routes/shell.tsx`), so this waits for that frame.
 *
 *     await field.focus();
 *     await inSight(field);
 */
export const inSight = (control: Locator) =>
  expect(async () => {
    const box = (await control.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual((await destinations(control.page()).boundingBox())!.y);
  }).toPass({ timeout: 5_000 });
