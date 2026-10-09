import type { Locator } from "@playwright/test";

/**
 * Taps, and reports whether the page showed `text` when the browser painted
 * its next frame, and how many milliseconds that frame came after the tap:
 *
 *     const { seen, after } = await tapAndSeeNextFrame(page.getByRole("button", { name: "Cobrar" }), "Selección");
 *
 * The frame is the assertion; the milliseconds are only worth writing down.
 */
export async function tapAndSeeNextFrame(control: Locator, text: string): Promise<{ seen: boolean; after: number }> {
  type Seen = { seen?: { seen: boolean; after: number } };
  await control.evaluate((element, wanted) => {
    element.addEventListener(
      "click",
      () => {
        const tapped = performance.now();
        requestAnimationFrame(() => {
          (window as unknown as Seen).seen = {
            seen: document.body.innerText.includes(wanted),
            after: Math.round(performance.now() - tapped),
          };
        });
      },
      { once: true },
    );
  }, text);
  await control.click();
  const page = control.page();
  const seen = await page.waitForFunction(() => (window as unknown as Seen).seen !== undefined);
  await seen.dispose();
  return page.evaluate(() => {
    const result = (window as unknown as Seen).seen!;
    delete (window as unknown as Seen).seen;
    return result;
  });
}
