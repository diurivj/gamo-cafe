import type { Page, Route } from "@playwright/test";

import { expect } from "../fixtures";

/**
 * Holds every form the page submits until the test lets it through, so a test
 * can look at the screen while the server has not answered yet:
 *
 *     const held = await holdSubmissions(page);
 *     await page.getByRole("button", { name: "Cobrar" }).click();
 *     await held.waitFor(1);            // sent, and not answered
 *     await held.release();             // now the server gets it
 *
 * A held request has not reached the Worker, so nothing is recorded until it
 * is released. With `{ loads: true }` the data a page loads after a tap is held
 * too, for a form that only reads. `release()` lets the oldest one through, `releaseAll()` every
 * one, and `stop()` ends the holding. A load the page gave up on while it was
 * held — a navigation that another one replaced — has nothing to let through.
 */
export async function holdSubmissions(page: Page, { loads = false }: { readonly loads?: boolean } = {}) {
  const waiting: Route[] = [];
  const hold = (route: Route) => {
    const request = route.request();
    // A page's data, as the router asks for it after a tap.
    const load = loads && request.method() === "GET" && new URL(request.url()).pathname.endsWith(".data");
    if (request.method() === "POST" || load) waiting.push(route);
    else void route.fallback();
  };
  await page.route("**/*", hold);

  return {
    /** Resolves once this many submissions are being held. */
    waitFor: (count: number) => expect.poll(() => waiting.length).toBe(count),
    release: async () => {
      const route = waiting.shift();
      if (route) await letThrough(route);
    },
    releaseAll: async () => {
      for (const route of waiting.splice(0)) await letThrough(route);
    },
    stop: async () => {
      await page.unroute("**/*", hold);
      for (const route of waiting.splice(0)) await letThrough(route);
    },
  };
}

/** Lets a held request on to the Worker, unless the page already gave it up and Playwright let go of it. */
async function letThrough(route: Route) {
  try {
    await route.continue();
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("Route is already handled"))) throw error;
  }
}
