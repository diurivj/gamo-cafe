/**
 * The few patterns shadcn/ui has no component for: a screen's headings and
 * its supporting text. Everything else is a component of `~/components/ui`
 * (see "The look and the navigation" in the README).
 */

/** A screen's `<h1>`: the cafe's display serif, large and set close. */
export const pageTitle =
  "font-display text-[2.625rem] leading-[1.02] font-normal tracking-[-0.012em] text-balance wrap-break-word";

/**
 * The small label over a screen's title, or over a figure: the date, the step
 * of a task, what an amount is. Caramel, uppercase and spaced; never the only
 * place something essential is said.
 */
export const eyebrow = "eyebrow text-brand";

/** The heading of a part of a screen: a label in small capitals over what it groups. */
export const sectionTitle = "eyebrow text-muted-foreground";

/** What a figure is and then the figure, which goes under its label when the two do not fit side by side. */
export const figureRow = "flex flex-wrap items-baseline justify-between gap-x-3";

/** An amount of money: one too long for its line breaks where it must, and is never cut. */
export const amount = "max-w-full min-w-0 wrap-anywhere figures";

/** A figure that leads a card or a screen: large, set close, its digits in line. */
export const bigFigure = "font-heading text-[2.25rem] leading-none font-semibold tracking-[-0.02em] figures";

/** Supporting text: an explanation, a hint under a label. */
export const hint = "text-muted-foreground";

/** A row of a list that is a link: a card that answers the finger. */
export const rowCard =
  "transition-[background-color,box-shadow,scale] duration-150 ease-out hover:bg-[color-mix(in_oklch,var(--card),var(--muted)_70%)] hover:shadow-raised active:scale-[0.99] active:bg-muted";
