import { describe, expect, it } from "vitest";

import { normalizeName } from "~/shared/normalize-name";

describe("normalizeName", () => {
  it("ignores case", () => {
    expect(normalizeName("FAMILIA Ruiz")).toBe("familia ruiz");
  });

  it("ignores accents, the dieresis and the tilde of the ñ", () => {
    expect(normalizeName("José Ángel Núñez Güemes")).toBe("jose angel nunez guemes");
  });

  it("gives the same text for a letter typed as one character or as letter plus accent", () => {
    expect(normalizeName("José")).toBe(normalizeName("José"));
  });

  it("ignores space around the name and extra space inside it", () => {
    expect(normalizeName("  Ana   María \t")).toBe("ana maria");
  });

  it("gives a text that normalizes to itself", () => {
    // İ lowercases to an i followed by a combining dot.
    for (const name of ["İbrahim Ñandú", "ǅ Ünal", "José Ángel"]) {
      const once = normalizeName(name);
      expect(normalizeName(once), name).toBe(once);
    }
    expect(normalizeName("İbrahim")).toBe("ibrahim");
  });

  it("is empty for a name with nothing in it", () => {
    expect(normalizeName("   ")).toBe("");
  });
});
