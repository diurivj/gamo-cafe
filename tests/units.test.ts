import { expect, it } from "vitest";

import { parseUnits } from "~/shared/units";

it("reads a typed whole number of units", () => {
  expect(parseUnits("24")).toBe(24);
  expect(parseUnits(" 007 ")).toBe(7);
  expect(parseUnits("0")).toBe(0);
});

it.for(["", " ", "-4", "+4", "2.5", "2,5", "1e3", "doce", "99999999999999999999"])("does not read %j", (typed) => {
  expect(parseUnits(typed)).toBeUndefined();
});
