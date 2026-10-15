import { useEffect, useState } from "react";

import { newId } from "./id";

/**
 * What the screen in front of the User last heard the server confirm, for as
 * long as that result is on it (UI redesign §6.1). When the read the User
 * asks for next fails, the screen that stands in still knows what was
 * recorded and says it, instead of "it may have been saved":
 *
 *     useRecorded(title, details);        // in a confirmed result
 *     const recorded = lastRecorded();    // in what replaces it
 *
 * A result can also go with the User to the screen a navigation leads to,
 * which says it in its own place, once: a Payment that closes a Bill is said
 * on Inicio.
 *
 *     void navigate("/inicio", { replace: true, state: carry(result) });   // where it was confirmed
 *     const carried = useCarried(location);                                // where it lands
 *
 * Kept in the page's memory only, and only in a browser: nothing is stored,
 * and a reload starts with nothing.
 */
export interface Recorded {
  /** "Pago registrado". */
  readonly title: string;
  /** "$20.00 en efectivo. La cuenta todavía debe $30.00." */
  readonly details: string;
  /** The cash to hand back, when a Payment had any: "$30.00" (UI redesign §5.4). */
  readonly change?: string | null;
}

let last: Recorded | null = null;

/** The result on screen, if one is; read while rendering what takes its place. */
export const lastRecorded = (): Recorded | null => last;

/** Holds a result for as long as it is on screen; nothing while there is none. */
function useHeld(result: Recorded | null) {
  const title = result?.title;
  const details = result?.details;
  const change = result?.change ?? null;
  useEffect(() => {
    if (title === undefined || details === undefined) return;
    last = { title, details, change };
    return () => {
      last = null;
    };
  }, [title, details, change]);
}

/** Holds a confirmed result for as long as the component that shows it is on screen. */
export function useRecorded(title: string, details: string, change: string | null = null) {
  useHeld({ title, details, change });
}

/** The result on its way to the screen a navigation leads to, and the id the navigation's state names it by. */
let carried: { readonly id: string; readonly result: Recorded } | null = null;

/**
 * Hands a confirmed result to the screen the next navigation leads to: the
 * state that navigation carries. The state holds only an id; the result stays
 * in memory, so no other navigation, no other tab and no reload can say it.
 */
export function carry(result: Recorded): { readonly carried: string } {
  const id = newId();
  carried = { id, result };
  return { carried: id };
}

/**
 * The result a navigation carried to this history entry (`carry`), while the
 * User is on that entry, and held as any result on screen is. It is said
 * once: the page forgets it as it is shown, so neither a reload nor coming
 * back to the entry later says it again, and it is gone from the screen when
 * the User moves on to another entry.
 */
export function useCarried(at: { readonly key: string; readonly state: unknown }): Recorded | null {
  const [held, setHeld] = useState(() => {
    const id = (at.state as { readonly carried?: unknown } | null)?.carried;
    return { key: at.key, result: carried !== null && carried.id === id ? carried.result : null };
  });
  if (held.result !== null && held.key !== at.key) setHeld({ key: at.key, result: null });
  const result = held.key === at.key ? held.result : null;
  useEffect(() => {
    if (result !== null && carried?.result === result) carried = null;
  }, [result]);
  useHeld(result);
  return result;
}
