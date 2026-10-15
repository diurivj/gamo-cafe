/**
 * The cafe's sign: "Gamo" in the display serif and "Cafe" in small spaced
 * capitals beside it. Its words are the app's name as a screen reader says
 * it, "Gamo Cafe"; the capitals are the font's, so nothing reads them as
 * letters to spell out.
 *
 *     <Monogram />
 *     <Wordmark />
 */
export function Wordmark({ className = "" }: { readonly className?: string }) {
  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 leading-none ${className}`}>
      <span className="font-display text-[2rem] tracking-[-0.01em]">Gamo</span>{" "}
      <span className="text-base font-semibold tracking-[0.2em] text-brand [font-variant-caps:all-small-caps]">Cafe</span>
    </p>
  );
}

/** The sign's initial on espresso: the cafe's mark, where there is room for one. Only a drawing. */
export function Monogram({ className = "size-11 text-[1.75rem]" }: { readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-[30%] bg-primary pt-[0.06em] font-display leading-none text-primary-foreground shadow-press ${className}`}
    >
      G
    </span>
  );
}
