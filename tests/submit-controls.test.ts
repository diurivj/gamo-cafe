import { expect, it } from "vitest";

// Spec §3.4: every tap is acknowledged at once. A submit control gets its
// pending state from `SubmitButton` (~/components/submit-button), so a submit
// button written by hand is one that a tap may leave looking untouched.
// e2e/pending-ui.spec.ts checks the component's behaviour in a browser; this
// keeps every form of the app on it.

const sources: Record<string, string> = import.meta.glob("../app/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * The two submit buttons of Vender are the exception: a sale is acknowledged
 * by emptying the selection and listing it as being recorded, and the buttons
 * stay free for the next one (e2e/vender-pending.spec.ts).
 */
const BY_HAND: Readonly<Record<string, number>> = {
  "../app/components/submit-button.tsx": 1,
  "../app/routes/home.tsx": 2,
};

it("every submit control of the app is a SubmitButton", () => {
  expect(Object.keys(sources).length).toBeGreaterThan(10);

  const offences: string[] = [];
  let submitButtons = 0;
  for (const [file, text] of Object.entries(sources)) {
    submitButtons += text.match(/<SubmitButton\b/g)?.length ?? 0;
    // A `<button>` submits its form unless it says `type="button"`.
    const byHand = [...text.matchAll(/<button\b[^>]*>/g)].filter(
      ([tag]) => !/\btype="button"/.test(tag),
    ).length;
    if (byHand !== (BY_HAND[file] ?? 0)) offences.push(`${file}: ${byHand} submit buttons written by hand`);
    if (/<input\b[^>]*\btype="(submit|image)"/.test(text)) offences.push(`${file}: an <input> that submits`);
  }
  expect(offences).toEqual([]);
  // Known uses, so that a change in how the component is written fails loudly.
  expect(submitButtons).toBeGreaterThan(20);
});
