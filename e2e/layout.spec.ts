import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { openCafe } from "./support/cafe";
import { ADMIN_WALKS, adminStops, emptyStops, emptyWorkerStops, signedOutStops, type Stop, workerStops } from "./support/tour";

// UI redesign §8 and §10.2: the layout of every stop of `e2e/support/tour.ts`,
// measured in the shapes a User can put it in. A stop is opened once and then
// reshaped, so a step, a dialog or a result is measured as it stands.
//
// What is measured, in each shape:
// - nothing scrolls sideways (WCAG 1.4.10 at 320px), and no text is wider or
//   taller than the box that cuts it (1.4.4 at 200%, 1.4.12 with the spacing
//   a reader may set);
// - what takes the keyboard's focus is whole, in sight, and under neither the
//   bar nor anything that sticks (2.4.11, and §4.1's "must not hide");
// - every control a finger aims at is 48px both ways (§8). A link inside a
//   sentence is as tall as its line and is left out, as WCAG 2.5.8 leaves it.
//
// The shapes are a browser's, not a phone's: a real keyboard, a notch and a
// hand are in `.scratch/ui-redesign/verification.md` as what is still owed.

/** A reader's own spacing, as WCAG 1.4.12 words it. */
const TEXT_SPACING = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

interface Shape {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** CSS added for the shape: larger text, or wider spacing. */
  readonly style?: string;
}

const SHAPES: ReadonlyArray<Shape> = [
  { name: "320px phone", width: 320, height: 568 },
  { name: "320px phone, text twice as large", width: 320, height: 568, style: "html { font-size: 200% }" },
  { name: "320px phone, a reader's text spacing", width: 320, height: 568, style: TEXT_SPACING },
  // As short as a phone on its side, or one whose keyboard is up.
  { name: "phone on its side", width: 568, height: 320 },
  { name: "laptop", width: 1280, height: 800 },
];

/** What is wrong with the screen as it is now, one line per thing; empty when nothing is. */
const problems = (page: Page) =>
  page.evaluate(async () => {
    // The bar and what sticks above it say how tall they are once the new
    // shape is laid out, and the page then makes room for them: measure when
    // three frames in a row have left the page as it was.
    const laidOut = () =>
      [document.documentElement.scrollHeight, getComputedStyle(document.documentElement).scrollPaddingBottom].join();
    for (let same = 0, last = "", frames = 0; same < 3; frames++) {
      if (frames === 60) return [`never settles: ${last}`];
      await new Promise((painted) => requestAnimationFrame(painted));
      const now = laidOut();
      same = now === last ? same + 1 : 0;
      last = now;
    }
    const frames = async (count: number) => {
      for (let frame = 0; frame < count; frame++) await new Promise((painted) => requestAnimationFrame(painted));
    };
    const found: string[] = [];
    const say = (what: string, element: Element) =>
      found.push(`${what}: ${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}"`);
    const shown = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden";
    };
    /** Read only by a screen reader: clipped to a pixel on purpose. */
    const forReaderOnly = (element: Element) => element.closest(".sr-only") !== null;

    if (document.documentElement.scrollWidth > window.innerWidth) {
      const widest = [...document.querySelectorAll("body *")]
        .filter((element) => !forReaderOnly(element))
        .sort((one, other) => other.getBoundingClientRect().right - one.getBoundingClientRect().right)[0];
      say(`scrolls sideways (${document.documentElement.scrollWidth}px in ${window.innerWidth}px), widest`, widest ?? document.body);
    }

    // A dialog is the screen while it is open: what is under it is inert.
    const dialog = document.querySelector('[role="alertdialog"]');
    const scope = dialog ?? document.body;

    for (const element of scope.querySelectorAll("*")) {
      if (!shown(element) || forReaderOnly(element)) continue;
      // A field scrolls what is typed in it, as every field does.
      if (element.matches("input, textarea, select")) continue;
      const style = getComputedStyle(element);
      if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1 && style.overflowX !== "visible") {
        say(`cut sideways (${element.scrollWidth}px in ${element.clientWidth}px)`, element);
      }
      const clips = style.overflowY === "hidden" || style.overflowY === "clip";
      if (clips && element.scrollHeight > element.clientHeight + 1 && (element.textContent ?? "").trim() !== "") {
        say("cut below", element);
      }
    }

    const controls = [...scope.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary, [role=radio], [tabindex='0']")]
      // What a User can reach: not the native input a drawn radio keeps out of the way.
      .filter(
        (control) =>
          shown(control) &&
          !forReaderOnly(control) &&
          !control.matches("input[type=hidden], :disabled, [aria-hidden=true], [tabindex='-1']"),
      );

    // What a finger aims at: the control, or the label that is its target. A
    // link inside a sentence is as tall as its line (WCAG 2.5.8 leaves it out).
    const targetOf = (control: HTMLElement) => control.closest("label") ?? control;
    for (const control of controls) {
      const target = targetOf(control);
      if (getComputedStyle(target).display === "inline") continue;
      const box = target.getBoundingClientRect();
      if (Math.round(box.height) < 48 || Math.round(box.width) < 48) {
        say(`target ${Math.round(box.width)}×${Math.round(box.height)}px, under 48px`, target);
      }
    }

    // What sticks or is fixed, and so can cover what is under it.
    const covers = dialog
      ? []
      : [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
          const style = getComputedStyle(element);
          return (
            (style.position === "fixed" || style.position === "sticky") &&
            style.opacity !== "0" &&
            shown(element) &&
            !forReaderOnly(element)
          );
        });
    const nameOf = (cover: HTMLElement) =>
      cover.getAttribute("aria-label") ?? cover.querySelector("[aria-label]")?.getAttribute("aria-label") ?? cover.tagName.toLowerCase();
    /** What is wrong with where the control stands now that it has the focus. */
    const wrongWith = (control: HTMLElement): string | null => {
      const box = targetOf(control).getBoundingClientRect();
      const over = covers
        .filter((cover) => !cover.contains(control) && !control.contains(cover))
        .map((cover) => ({ cover, at: cover.getBoundingClientRect() }));
      // The room there is to show it in: down to the highest of the covers,
      // and to where the page itself stops scrolling a focused control.
      const floor = Math.min(
        window.innerHeight - Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom || "0"),
        ...over.filter(({ at }) => at.top > window.innerHeight / 3).map(({ at }) => at.top),
      );
      if (box.height > floor) {
        // Taller than the room there is: a part a finger could find is in
        // sight, and the rest is a scroll away.
        return Math.min(box.bottom, floor) - Math.max(box.top, 0) < 48 ? "focused out of sight" : null;
      }
      if (box.top < -1 || box.bottom > window.innerHeight + 1) return "focused out of sight";
      for (const { cover, at } of over) {
        const overlaps = box.left < at.right - 1 && box.right > at.left + 1 && box.top < at.bottom - 1 && box.bottom > at.top + 1;
        if (overlaps) return `focused under ${nameOf(cover)}`;
      }
      return null;
    };
    for (const control of controls) {
      control.focus();
      if (document.activeElement !== control) continue;
      // WebKit brings what took the focus into sight within the next frames,
      // not at once: only what still looks wrong is waited for.
      if (wrongWith(control) !== null) await frames(2);
      const wrong = wrongWith(control);
      if (wrong !== null) say(wrong, control);
    }
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    return found;
  });

/** Opens each stop, puts it in each shape and measures it; what is found at one stop does not keep the next from being measured. */
async function measure(page: Page, stops: ReadonlyArray<Stop>, tools: Parameters<Stop["open"]>[1]) {
  const start = page.viewportSize()!;
  for (const stop of stops) {
    await test.step(stop.name, async () => {
      await page.setViewportSize(start);
      const leave = await stop.open(page, tools);
      for (const shape of SHAPES) {
        await page.setViewportSize({ width: shape.width, height: shape.height });
        const style = shape.style ? await page.addStyleTag({ content: shape.style }) : null;
        expect.soft(await problems(page), `${stop.name}, ${shape.name}`).toEqual([]);
        await style?.evaluate((element) => (element as Element).remove());
      }
      await page.setViewportSize(start);
      await leave?.();
    });
  }
}

test.describe("every screen keeps its words, its actions and its focus in sight", () => {
  test.setTimeout(180_000);

  test("signed out", async ({ page, query }) => {
    await measure(page, signedOutStops, { query });
  });

  for (const walk of ADMIN_WALKS) {
    test(`on an Admin's screens: ${walk}`, async ({ page, baseURL, addUser, signIn, addCategory, addItem, addCustomer, query }) => {
      const cafe = await openCafe({ page, baseURL, addUser, signIn, addCategory, addItem, addCustomer, query });
      await measure(page, adminStops(cafe)[walk], { query });
    });
  }

  test("on a Worker's screens", async ({ page, baseURL, addUser, signIn, addCategory, addItem, addCustomer, query }) => {
    const cafe = await openCafe({ page, baseURL, addUser, signIn, addCategory, addItem, addCustomer, query });
    await signIn(cafe.beto);
    await measure(page, workerStops(cafe), { query });
  });

  test("in an app with nothing recorded yet", async ({ page, signInAs, query }) => {
    await signInAs("admin", "Ana");
    await measure(page, emptyStops, { query });
    await signInAs("worker", "Beto");
    await measure(page, emptyWorkerStops, { query });
  });
});
