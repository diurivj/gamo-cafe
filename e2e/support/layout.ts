import type { Locator } from "@playwright/test";

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
