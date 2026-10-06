/**
 * Instants and Days (spec §5.9, §7.1). An instant is integer milliseconds
 * since the Unix epoch. A Day is the cafeteria's local calendar day as
 * `YYYY-MM-DD` text, computed once when a record is written and stored with
 * it. On the server "now" comes only from `~/backend/time`.
 *
 * Safe in the browser: no Effect import.
 */

/** Integer milliseconds since the Unix epoch. */
export type Instant = number;

/** A calendar day in the cafeteria's time zone, as `YYYY-MM-DD`. */
export type Day = string;

export const TIME_ZONE = "America/Mexico_City";

// en-CA writes dates as YYYY-MM-DD.
const dayParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Day on which an instant falls. */
export function dayOf(instant: Instant): Day {
  return dayParts.format(instant);
}

// A Day carries no time zone, so it is read and written as a UTC date.
const dayText = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", dateStyle: "full" });

/** `"2026-10-05"` → `"lunes, 5 de octubre de 2026"`. */
export function formatDay(day: Day): string {
  return dayText.format(Date.parse(`${day}T00:00:00Z`));
}

const timeText = new Intl.DateTimeFormat("es-MX", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The Mexico City time of day of an instant, as `"14:05"`. */
export function formatTime(instant: Instant): string {
  return timeText.format(instant);
}
