import { describe, expect, it } from "vitest";

import {
  formatSignInCode,
  hashSecret,
  newSessionToken,
  newSignInCode,
  normalizeSignInCode,
} from "~/shared/secret";

describe("sign-in codes", () => {
  it("have 8 characters, none of which can be mistaken for another", () => {
    for (let i = 0; i < 200; i++) {
      // No I, L, O, 0 or 1.
      expect(newSignInCode()).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    }
  });

  it("differ from one another", () => {
    const codes = new Set(Array.from({ length: 200 }, newSignInCode));
    expect(codes.size).toBe(200);
  });

  it("are shown as two groups of four", () => {
    expect(formatSignInCode("ABCD2345")).toBe("ABCD 2345");
  });

  it("are read however they were typed", () => {
    expect(normalizeSignInCode("  abcd 2345 ")).toBe("ABCD2345");
    expect(normalizeSignInCode("abcd-2345")).toBe("ABCD2345");
  });
});

describe("session tokens", () => {
  it("are long, URL-safe and differ from one another", () => {
    const token = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(token);
  });
});

describe("hashSecret", () => {
  it("is the SHA-256 of the text, in hex", async () => {
    // The well-known digest of "abc".
    expect(await hashSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
