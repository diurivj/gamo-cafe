import { expect, it } from "vitest";

import { normalizeName, tidyName } from "~/shared/name";

it("stores a name trimmed, with single spaces", () => {
  expect(tidyName("  Café   de  olla \n")).toBe("Café de olla");
});

it("compares names ignoring case, accents and spacing", () => {
  expect(normalizeName("  CAFÉ   de Olla ")).toBe("cafe de olla");
  expect(normalizeName("Piña")).toBe("pina");
  expect(normalizeName("Agüita")).toBe("aguita");
  // Composed and decomposed forms of the same letter.
  expect(normalizeName("café")).toBe(normalizeName("café"));
});
