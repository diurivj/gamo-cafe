/**
 * The few patterns shadcn/ui has no component for: a screen's headings and
 * its supporting text. Everything else is a component of `~/components/ui`
 * (see "The look and the navigation" in the README).
 */

/** A screen's `<h1>`. */
export const pageTitle = "font-heading text-3xl font-semibold tracking-tight text-balance wrap-break-word";

/** The heading of a part of a screen. */
export const sectionTitle = "font-heading font-medium text-muted-foreground";

/** What a figure is and then the figure, which goes under its label when the two do not fit side by side. */
export const figureRow = "flex flex-wrap items-baseline justify-between gap-x-3";

/** An amount of money: one too long for its line breaks where it must, and is never cut. */
export const amount = "max-w-full min-w-0 wrap-anywhere tabular-nums";

/** Supporting text: an explanation, a hint under a label. */
export const hint = "text-muted-foreground";
