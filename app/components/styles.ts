/**
 * The shared patterns of the visual system (UI redesign §3.2, §8), as class
 * names over the tokens of `app/app.css`. A screen composes these instead of
 * inventing its own, so headings, cards, fields, buttons and links look and
 * behave the same everywhere:
 *
 *     <h1 className={pageTitle}>Clientes</h1>
 *     <label htmlFor="name" className={fieldLabel}>Nombre</label>
 *     <input id="name" name="name" className={textField} />
 *     <SubmitButton className={primaryButton}>Agregar</SubmitButton>
 *     <Link to="/dia" className={`${outlined} ${press} bg-sun p-4`}>…</Link>
 *
 * Body and form text is 18px, from `<body>`. Anything that stands alone to be
 * tapped is at least 48px tall and wide. One primary action per step; the
 * rest are `secondaryButton` or `textLink`.
 */

/**
 * A raised surface without its fill: a thick outline and the hard shadow it
 * stands on. Give it one of the tints (`bg-sun`, `bg-mint`, `bg-lilac`,
 * `bg-peach`) or `bg-action`; a white one is `card`.
 */
export const outlined = "rounded-2xl border-[2.5px] border-ink shadow-hard";

/** A white raised surface. */
export const card = `${outlined} bg-raised`;

/** What a card or button that can be tapped does: it goes down into its shadow. */
export const press =
  "transition duration-100 active:translate-x-[5px] active:translate-y-[5px] active:shadow-none";

/** A screen's `<h1>`. */
export const pageTitle = "text-3xl font-black tracking-tight text-balance";

/** The heading of a part of a screen. */
export const sectionTitle = "font-bold text-ink-soft";

/** Supporting text: an explanation, a hint under a label. */
export const hint = "text-ink-soft";

/** The visible label of a field. A placeholder is never one. */
export const fieldLabel = "font-bold";

/** A one-line text field. */
export const textField =
  "min-h-14 w-full rounded-xl border-[2.5px] border-ink bg-raised px-4 py-3 text-ink aria-invalid:border-danger";

const button = `inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border-[2.5px] border-ink px-5 py-3 text-center font-bold text-ink shadow-hard disabled:opacity-60 ${press}`;

/** The one action a step is for. */
export const primaryButton = `${button} bg-action`;

/** An action beside the primary one, or a link drawn as a button. */
export const secondaryButton = `${button} bg-raised`;

/** A link inside text: told apart by its underline, not by a color. */
export const textLink = "font-bold underline underline-offset-4";
