import { useEffect, useRef, useState } from "react";

/**
 * What a recorded form leaves for the screen that sent it (spec §3.4): what
 * that screen must say, in Spanish, and what it needs to start a form over.
 * `~/notice.server` builds a notice and carries it; this module holds its
 * shape, and the one way a screen keeps the last one it was given.
 */

/** What an action says about what it recorded. Every field is optional. */
export interface Notice {
  /** What the screen says, in Spanish. */
  readonly message?: string;
  /** Which form of the page was recorded, for a page with several. */
  readonly form?: string;
  /** The Bill a selection was recorded on, for Vender. */
  readonly billId?: string;
  /** A one-time sign-in code to read out, for Usuarios. */
  readonly code?: { readonly name: string; readonly code: string };
}

/** A notice as a screen gets it. */
export interface TakenNotice extends Notice {
  /** New for every recorded form: a page keys a form on it to start it over. */
  readonly id: string;
}

/**
 * The last notice the screen said. `fromLoader` is the notice a document POST
 * left for the loader; `answers` are the notices in the router's own data —
 * the action data of the forms the screen sent, or a fetcher's. Each answer
 * is said once, when it first appears, and replaces the last one. A loader
 * revalidation that brings no notice does not take the words away.
 *
 *     const [said, say] = useSaidNotice(loaderNotice, answeredNotice);
 *     // a row with its own fetcher reports up with `say`
 */
export function useSaidNotice(
  fromLoader: TakenNotice | null,
  ...answers: ReadonlyArray<TakenNotice | null | undefined>
): readonly [TakenNotice | null, (notice: TakenNotice) => void] {
  const [said, setSaid] = useState<TakenNotice | null>(fromLoader);
  if (fromLoader && fromLoader.id !== said?.id) setSaid(fromLoader);
  const saidIds = useRef(new Set<string>());
  useEffect(() => {
    for (const notice of answers) {
      if (notice && !saidIds.current.has(notice.id)) {
        saidIds.current.add(notice.id);
        setSaid(notice);
      }
    }
  });
  return [said, setSaid];
}
