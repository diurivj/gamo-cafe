import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { openCafe } from "./support/cafe";
import { ADMIN_WALKS, adminStops, emptyStops, emptyWorkerStops, signedOutStops, type Stop, workerStops } from "./support/tour";

// UI redesign §8 and §10.2: the automated accessibility scan. axe-core reads
// every stop of `e2e/support/tour.ts` — each screen in each state a User
// meets it in, for both roles, signed out, and with nothing recorded yet —
// against the rules it has for WCAG 2.0, 2.1 and 2.2 at A and AA, and its
// best practices.
//
// What a scan can tell is a part of those criteria: names, roles, states,
// contrast of text, structure. It cannot tell whether a name is the right
// one, whether the order makes sense read aloud, or whether an announcement
// comes when it should. `.scratch/ui-redesign/verification.md` says what was
// checked by other means and what is still owed.

const RULES = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

// Base UI closes a dialog's focus trap with two empty spans. On Safari it
// gives them `role="button"` and no name, so that VoiceOver's cursor stops at
// them and the trap can send it back; elsewhere they are hidden from a screen
// reader. They are the library's own, and what VoiceOver says at a dialog's
// edge is on the list of what a person has to hear (verification.md).
const FOCUS_GUARDS = "[data-base-ui-focus-guard]";

/** What axe finds on the screen as it is now, one line per rule broken. */
async function violations(page: Page): Promise<string[]> {
  // A dialog that is still fading in has the contrast of neither end. What
  // turns for as long as something is on its way (a spinner) never ends, and
  // changes no color: it is not waited for.
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished),
    ),
  );
  const { violations } = await new AxeBuilder({ page }).withTags(RULES).exclude(FOCUS_GUARDS).analyze();
  return violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes
        .map((node) => node.target.join(" "))
        .join(" | ")}`,
  );
}

/** Opens each stop and scans it; what is found at one stop does not keep the next from being scanned. */
async function scan(page: Page, stops: ReadonlyArray<Stop>, tools: Parameters<Stop["open"]>[1]) {
  for (const stop of stops) {
    await test.step(stop.name, async () => {
      const leave = await stop.open(page, tools);
      expect.soft(await violations(page), stop.name).toEqual([]);
      await leave?.();
    });
  }
}

test.describe("axe finds nothing to fix", () => {
  test.setTimeout(120_000);

  test("signed out", async ({ page, query }) => {
    await scan(page, signedOutStops, { query });
  });

  for (const walk of ADMIN_WALKS) {
    test(`on an Admin's screens, in every state the cafe gives them: ${walk}`, async ({
      page,
      baseURL,
      addUser,
      signIn,
      addCategory,
      addItem,
      addCustomer,
      query,
    }) => {
      const cafe = await openCafe({ page, baseURL, addUser, signIn, addCategory, addItem, addCustomer, query });
      await scan(page, adminStops(cafe)[walk], { query });
    });
  }

  test("on a Worker's screens, and on what answers when they open more", async ({
    page,
    baseURL,
    addUser,
    signIn,
    addCategory,
    addItem,
    addCustomer,
    query,
  }) => {
    const cafe = await openCafe({ page, baseURL, addUser, signIn, addCategory, addItem, addCustomer, query });
    await signIn(cafe.beto);
    await scan(page, workerStops(cafe), { query });
  });

  test("in an app with nothing recorded yet", async ({ page, signInAs, query }) => {
    await signInAs("admin", "Ana");
    await scan(page, emptyStops, { query });
    await signInAs("worker", "Beto");
    await scan(page, emptyWorkerStops, { query });
  });
});
