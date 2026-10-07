import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useLocation } from "react-router";

import { hint } from "~/components/styles";
import { buttonClasses } from "~/components/ui/button";

// A paged list (spec §3.4): the first page comes from the route's loader, and
// **Cargar más** asks the same loader for the page after it and appends it.
// `usePagedList` holds the rows; `LoadMore` is the control. Every list that
// grows with time uses the two, so paging behaves the same on every screen.

/** One page as a loader answers it: its rows and the cursor of the next one. */
export interface Page<Row> {
  readonly rows: ReadonlyArray<Row>;
  /** The next page's cursor as the URL carries it; null on the last page. */
  readonly next: string | null;
}

/** The pages a list holds so far, as one run of rows. */
interface Loaded<Row> extends Page<Row> {
  readonly pages: number;
}

interface State<Row> {
  /** The loader data these rows started from; other data starts over. */
  readonly source: unknown;
  readonly shown: Loaded<Row>;
  /**
   * Set while a list restored from memory is fetched again: the fresh pages
   * so far, and how many the restored list had.
   */
  readonly refresh: { readonly got: Loaded<Row>; readonly target: number } | null;
}

/**
 * What each list had loaded, by history entry, so that coming back to a list
 * finds its rows already there and the scroll position can be restored. In
 * memory only: rows are about Bills and money, and are not written anywhere.
 */
const remembered = new Map<string, Loaded<unknown>>();
const REMEMBERED_LISTS = 30;

function remember(key: string, loaded: Loaded<unknown>) {
  remembered.delete(key);
  remembered.set(key, loaded);
  for (const oldest of remembered.keys()) {
    if (remembered.size <= REMEMBERED_LISTS) break;
    remembered.delete(oldest);
  }
}

const append = <Row,>(loaded: Loaded<Row>, page: Page<Row>): Loaded<Row> => ({
  rows: [...loaded.rows, ...page.rows],
  next: page.next,
  pages: loaded.pages + 1,
});

/** What `LoadMore` needs from the list it belongs to. */
export interface More {
  /** The next page's URL; null when nothing follows. */
  readonly href: string | null;
  readonly loading: boolean;
  /** True once a page was appended and nothing follows the last one. */
  readonly ended: boolean;
  load(): void;
}

/**
 * The rows of a paged list and its **Cargar más**.
 *
 * - `data` is the route's loader data and `pageOf` reads a page out of it —
 *   out of the loader's answer for the first page, and out of the fetcher's
 *   for every page after it.
 * - `hrefFor` is the route's URL for a cursor, the filters kept.
 * - `id` tells apart two lists of one screen.
 *
 * New loader data — another search, a revalidation — starts the list over
 * from its first page. Coming back to the list shows what it had loaded at
 * once, which is what lets the scroll position be restored, and fetches those
 * pages again behind it: what stays on screen is never older than that.
 */
export function usePagedList<Data, Row>(options: {
  readonly id: string;
  readonly data: Data;
  readonly pageOf: (data: Data) => Page<Row>;
  readonly hrefFor: (cursor: string) => string;
}): { readonly rows: ReadonlyArray<Row>; readonly more: More } {
  const { data, pageOf, hrefFor } = options;
  const key = `${useLocation().key}:${options.id}`;
  const fetcher = useFetcher<Data>();

  const start = (): State<Row> => {
    const first: Loaded<Row> = { ...pageOf(data), pages: 1 };
    const before = remembered.get(key) as Loaded<Row> | undefined;
    return before !== undefined && before.pages > 1 && first.next !== null
      ? { source: data, shown: before, refresh: { got: first, target: before.pages } }
      : { source: data, shown: first, refresh: null };
  };
  const [state, setState] = useState(start);
  if (state.source !== data) setState(start());

  /** The URL the fetcher was last sent to, until its answer is used. */
  const asked = useRef<string | null>(null);
  const used = useRef<unknown>(undefined);

  const load = (cursor: string) => {
    const href = hrefFor(cursor);
    asked.current = href;
    void fetcher.load(href);
  };

  // The answer to the page that was asked for: appended to what is shown, or
  // to the fresh copy that will replace it.
  useEffect(() => {
    if (fetcher.state !== "idle" || fetcher.data === undefined || fetcher.data === used.current) return;
    used.current = fetcher.data;
    const href = asked.current;
    asked.current = null;
    if (href === null) return;
    // An answer to a question the list no longer asks is dropped.
    const expected = (state.refresh?.got ?? state.shown).next;
    if (expected === null || hrefFor(expected) !== href) return;
    const page = pageOf(fetcher.data as Data);
    if (state.refresh === null) {
      setState({ ...state, shown: append(state.shown, page) });
      return;
    }
    const got = append(state.refresh.got, page);
    if (got.next === null || got.pages >= state.refresh.target) {
      setState({ ...state, shown: got, refresh: null });
    } else {
      // The restored list had more pages than this: on to the next one.
      setState({ ...state, refresh: { ...state.refresh, got } });
      load(got.next);
    }
  });

  // A restored list starts fetching itself again from its second page.
  useEffect(() => {
    const from = state.refresh?.got.next ?? null;
    if (from !== null && fetcher.state === "idle" && asked.current === null) load(from);
  });

  useEffect(() => {
    remember(key, state.shown);
  }, [key, state.shown]);

  const next = state.shown.next;
  const loading = fetcher.state !== "idle" || state.refresh !== null;
  return {
    rows: state.shown.rows,
    more: {
      href: next === null ? null : hrefFor(next),
      loading,
      ended: next === null && state.shown.pages > 1,
      load: () => {
        if (next !== null && !loading) load(next);
      },
    },
  };
}

/**
 * **Cargar más**: a link to the next page, which is all it is without
 * JavaScript. With it, the link appends the next page instead of leaving, and
 * does so by itself when it scrolls into view. What is happening is said in a
 * status region, so a screen reader hears it; when the last page arrives
 * after the User asked for it, focus moves to that message instead of being
 * lost with the link.
 */
export function LoadMore({ more, label = "Cargar más" }: { more: More; label?: string }) {
  const { href, loading, ended } = more;
  const control = useRef<HTMLAnchorElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const byHand = useRef(false);
  const load = useRef(more.load);
  load.current = more.load;

  useEffect(() => {
    const element = control.current;
    if (element === null || loading || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load.current();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [href, loading]);

  useEffect(() => {
    if (ended && byHand.current) {
      byHand.current = false;
      status.current?.focus();
    }
  }, [ended]);

  if (href === null && !ended) return null;

  return (
    <div className="mt-4 flex flex-col gap-2">
      {href === null ? null : (
        <Link
          ref={control}
          to={href}
          preventScrollReset
          aria-busy={loading}
          onClick={(event) => {
            // A click that opens the link elsewhere is left to the browser.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            byHand.current = true;
            more.load();
          }}
          className={`${buttonClasses({ size: "touch", variant: "outline" })} ${loading ? "opacity-60" : ""}`}
        >
          {label}
        </Link>
      )}
      <p ref={status} role="status" tabIndex={-1} className={`min-h-7 text-center outline-none ${hint}`}>
        {loading ? "Cargando…" : ended ? "No hay más." : ""}
      </p>
    </div>
  );
}
