import { useEffect } from "react";

/**
 * Where a list was last seen, so that a screen reached from it can lead back
 * to the same search when the list is no longer the history entry behind it
 * (UI redesign §4.1): Cuenta after **Agregar productos**, say.
 *
 *     useListReturn("/cuentas-abiertas", location.search);   // the list
 *     <Link to={listReturn("/cuentas-abiertas")}>…</Link>      // the way back
 *
 * In this tab's memory only: it is gone with a reload, and nothing is written
 * anywhere. Going back in history, where that is possible, is still better:
 * it also restores the pages that were loaded and the place in them.
 *
 * Safe in the browser: no Effect import.
 */
const seen = new Map<string, string>();

/** Remembers the list's search for as long as the tab lives. Only the browser runs it. */
export function useListReturn(path: string, search: string) {
  useEffect(() => {
    seen.set(path, search);
  }, [path, search]);
}

/** The list's address as it was last seen, or its plain one. */
export const listReturn = (path: string) => `${path}${seen.get(path) ?? ""}`;
