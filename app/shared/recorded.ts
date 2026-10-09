import { useEffect } from "react";

/**
 * What the screen in front of the User last heard the server confirm, for as
 * long as that result is on it (UI redesign §6.1). When the read the User
 * asks for next fails, the screen that stands in still knows what was
 * recorded and says it, instead of "it may have been saved":
 *
 *     useRecorded(title, details);        // in a confirmed result
 *     const recorded = lastRecorded();    // in what replaces it
 *
 * Kept in the page's memory only, and only in a browser: nothing is stored,
 * and a reload starts with nothing.
 */
export interface Recorded {
  /** "Pago registrado". */
  readonly title: string;
  /** "$20.00 en efectivo. La cuenta todavía debe $30.00." */
  readonly details: string;
}

let last: Recorded | null = null;

/** The result on screen, if one is; read while rendering what takes its place. */
export const lastRecorded = (): Recorded | null => last;

/** Holds a confirmed result for as long as the component that shows it is on screen. */
export function useRecorded(title: string, details: string) {
  useEffect(() => {
    last = { title, details };
    return () => {
      last = null;
    };
  }, [title, details]);
}
