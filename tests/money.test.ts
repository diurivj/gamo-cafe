import { describe, expect, it } from "vitest";

import { changeFor, formatMoney, parsePesos } from "~/shared/money";

describe("formatMoney", () => {
  it("writes centavos as es-MX pesos", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(5)).toBe("$0.05");
    expect(formatMoney(1850)).toBe("$18.50");
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(100000000)).toBe("$1,000,000.00");
  });

  it("writes a negative amount with the sign before the peso sign", () => {
    expect(formatMoney(-1850)).toBe("-$18.50");
  });

  it("stays exact where dividing by 100 would not", () => {
    // 9007199254740991 / 100 is not representable as a float.
    expect(formatMoney(Number.MAX_SAFE_INTEGER)).toBe("$90,071,992,547,409.91");
  });

  it("refuses an amount that is not whole centavos", () => {
    expect(() => formatMoney(18.5)).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
  });

  it("agrees with the platform's own es-MX currency format", () => {
    const platform = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
    expect(formatMoney(123456)).toBe(platform.format(1234.56));
    expect(formatMoney(-1850)).toBe(platform.format(-18.5));
  });
});

describe("parsePesos", () => {
  it("reads a typed peso amount as centavos", () => {
    expect(parsePesos("18")).toBe(1800);
    expect(parsePesos("18.5")).toBe(1850);
    expect(parsePesos("18.50")).toBe(1850);
    expect(parsePesos("0.05")).toBe(5);
    expect(parsePesos(".5")).toBe(50);
    expect(parsePesos("18.")).toBe(1800);
    expect(parsePesos("0")).toBe(0);
  });

  it("ignores the peso sign, surrounding spaces and thousands commas", () => {
    expect(parsePesos(" $18.50 ")).toBe(1850);
    expect(parsePesos("1,234.56")).toBe(123456);
    expect(parsePesos("$1,000,000")).toBe(100000000);
  });

  it("reads amounts that floating-point multiplication gets wrong", () => {
    // 1.15 * 100 === 114.99999999999999 and 4.35 * 100 === 434.99999999999994
    expect(parsePesos("1.15")).toBe(115);
    expect(parsePesos("4.35")).toBe(435);
    expect(parsePesos("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("gives nothing for text that is not a peso amount", () => {
    for (const text of ["", " ", "$", ".", "abc", "18.505", "-5", "1e3", "12,50", "1,23", "1 000", "18.5.0", "90071992547409.92"]) {
      expect(parsePesos(text), text).toBeUndefined();
    }
  });
});

describe("changeFor", () => {
  it("is what was handed over minus what was paid, in whole centavos", () => {
    expect(changeFor(5000, 3700)).toBe(1300);
    expect(changeFor(100, 100)).toBe(0);
    expect(changeFor(100000, 1850)).toBe(98150);
  });

  it("refuses amounts that are not whole centavos", () => {
    expect(() => changeFor(50.5, 3700)).toThrow(RangeError);
    expect(() => changeFor(5000, Number.NaN)).toThrow(RangeError);
  });
});

describe("money as text", () => {
  it("round-trips centavos through es-MX text", () => {
    for (const amount of [0, 1, 9, 10, 99, 100, 101, 1850, 99999, 100000, 123456789, Number.MAX_SAFE_INTEGER]) {
      expect(parsePesos(formatMoney(amount)), String(amount)).toBe(amount);
    }
  });
});
