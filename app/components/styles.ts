/**
 * The shared patterns of the visual system (UI redesign §3.2, §8), as class
 * names over the tokens of `app/app.css`. A screen composes these instead of
 * inventing its own, so headings, fields, buttons and links look and behave
 * the same everywhere:
 *
 *     <h1 className={pageTitle}>Clientes</h1>
 *     <label htmlFor="name" className={fieldLabel}>Nombre</label>
 *     <input id="name" name="name" className={textField} />
 *     <SubmitButton className={primaryButton}>Agregar</SubmitButton>
 *
 * Body and form text is 18px, from `<body>`. Anything that stands alone to be
 * tapped is at least 48px tall and wide. One primary action per step; the
 * rest are `secondaryButton` or `textLink`.
 */

/** A screen's `<h1>`. */
export const pageTitle = "text-3xl font-bold tracking-tight text-balance";

/** The heading of a part of a screen. */
export const sectionTitle = "font-semibold text-ink-soft";

/** Supporting text: an explanation, a hint under a label. Still 4.5:1. */
export const hint = "text-ink-soft";

/** The visible label of a field. A placeholder is never one. */
export const fieldLabel = "font-semibold";

/** A one-line text field. */
export const textField =
  "min-h-14 w-full rounded-lg border border-edge bg-raised px-4 py-3 text-ink aria-invalid:border-2 aria-invalid:border-danger";

const button =
  "inline-flex min-h-14 items-center justify-center gap-2 rounded-lg px-5 py-3 text-center font-semibold disabled:opacity-60";

/** The one action a step is for. */
export const primaryButton = `${button} bg-ink text-white hover:bg-black`;

/** An action beside the primary one, or a link drawn as a button. */
export const secondaryButton = `${button} border border-edge bg-raised text-ink hover:bg-paper`;

/** A link inside text: told apart by its underline, not by a color. */
export const textLink = "font-semibold underline underline-offset-4";
