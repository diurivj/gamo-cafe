import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { now, today } from "~/backend/time";
import { dayOf, formatDay, formatTime, parseDay } from "~/shared/day";

import { advanceClock, runTest, setClock } from "./support/effect";

describe("today", () => {
  it("changes at midnight in America/Mexico_City, not at midnight UTC", () =>
    runTest(
      Effect.gen(function* () {
        // 23:59:59.999 in Mexico City is already 05:59 on the 6th in UTC.
        yield* setClock("2026-10-05T23:59:59.999");
        expect(yield* today).toBe("2026-10-05");

        yield* advanceClock("1 milli");
        expect(yield* today).toBe("2026-10-06");
        expect(yield* now).toBe(Date.UTC(2026, 9, 6, 6, 0, 0, 0));
      }),
    ));

  it("still belongs to the previous Day when UTC has moved on", () =>
    runTest(
      Effect.gen(function* () {
        yield* setClock("2026-12-31T18:00:00");
        expect(yield* now).toBe(Date.UTC(2027, 0, 1, 0, 0, 0, 0));
        expect(yield* today).toBe("2026-12-31");
      }),
    ));
});

describe("dayOf", () => {
  it("gives the Mexico City calendar day of an instant", () => {
    expect(dayOf(Date.UTC(2026, 0, 1, 5, 59, 59))).toBe("2025-12-31");
    expect(dayOf(Date.UTC(2026, 0, 1, 6, 0, 0))).toBe("2026-01-01");
    // Mexico City stopped observing daylight time in 2022: UTC-6 in July too.
    expect(dayOf(Date.UTC(2026, 6, 15, 5, 30, 0))).toBe("2026-07-14");
  });
});

describe("parseDay", () => {
  it("reads a Day from its text", () => {
    expect(parseDay("2026-10-05")).toBe("2026-10-05");
    expect(parseDay("2028-02-29")).toBe("2028-02-29");
  });

  it("reads nothing from text that is not a Day", () => {
    for (const text of ["", "ayer", "2026-10-5", "05/10/2026", " 2026-10-05", "2026-10-05T10:00:00"]) {
      expect(parseDay(text), text).toBeNull();
    }
  });

  it("reads nothing from a date the calendar does not have", () => {
    // `Date` would roll each of these over into the next month.
    for (const text of ["2026-02-31", "2026-13-01", "2027-02-29", "2026-04-31", "2026-00-10"]) {
      expect(parseDay(text), text).toBeNull();
    }
  });
});

describe("es-MX text", () => {
  it("writes a Day in words", () => {
    expect(formatDay("2026-10-05")).toBe("lunes, 5 de octubre de 2026");
  });

  it("writes the Mexico City time of an instant", () => {
    expect(formatTime(Date.UTC(2026, 9, 5, 20, 5, 0))).toBe("14:05");
    expect(formatTime(Date.UTC(2026, 9, 5, 6, 0, 0))).toBe("00:00");
  });
});
