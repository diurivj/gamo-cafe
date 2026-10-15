import { useEffect, useRef } from "react";
import { Link, Outlet, type ShouldRevalidateFunctionArgs, useLocation, useNavigation } from "react-router";

import { Monogram, Wordmark } from "~/components/brand";
import { NavigationDrawing } from "~/components/icons";
import { keepFocusClear } from "~/components/sticky-bar";
import { destinationsFor } from "~/navigation.server";
import { requireUser } from "~/session.server";
import { type Destination, destinationAt } from "~/shared/navigation";
import { roleLabel } from "~/shared/role";
import { shellMiddleware } from "~/shell.server";

import type { Route } from "./+types/shell";

/**
 * The signed-in shell: who is signed in and the role's four destinations
 * (UI redesign §4.1). A bar at the bottom of a phone, a column at the side of
 * a wider screen; the same links in both. Everything else, and the way out,
 * is on Más (`routes/mas.tsx`). What each role gets is in
 * `~/navigation.server`. A screen that cannot be shown is answered inside it,
 * by `routes/screen.tsx`.
 */

export function loader({ context }: Route.LoaderArgs) {
  const user = requireUser(context);
  return {
    user: { name: user.name, role: user.role },
    destinations: destinationsFor(user.role),
  };
}

// The loader's answer changes only with the User, so the browser keeps it
// (spec §3.4). Signing in or out leaves the shell and comes back to it, which
// loads it; a form on Usuarios may have changed this very User; and when an
// Admin changes them from another phone, `shellMiddleware` reloads the page.
export const middleware: Route.MiddlewareFunction[] = [shellMiddleware];

export function shouldRevalidate({ formAction }: ShouldRevalidateFunctionArgs) {
  return formAction?.split("?")[0] === "/usuarios";
}

function Destinations({ destinations }: { readonly destinations: ReadonlyArray<Destination> }) {
  const { pathname } = useLocation();
  const going = useNavigation().location?.pathname;
  const here = destinationAt(destinations, pathname);
  // A tapped destination is marked from the tap, before its screen arrives.
  const marked = going === undefined ? here : destinationAt(destinations, going);

  // The bar says how tall it stands, so the screen leaves it that room and
  // nothing rests or takes the focus under it (`--bar-height` in `app.css`):
  // text twice as large makes it taller than any fixed number. At the side of
  // a wider screen it takes no room from below.
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const page = document.documentElement;
    const tell = () => {
      if (getComputedStyle(element).position === "fixed") page.style.setProperty("--bar-height", `${element.offsetHeight}px`);
      else page.style.removeProperty("--bar-height");
      keepFocusClear();
    };
    tell();
    const observer = new ResizeObserver(tell);
    observer.observe(element);
    return () => {
      observer.disconnect();
      page.style.removeProperty("--bar-height");
    };
  }, []);

  return (
    <nav
      ref={bar}
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-10 border-t bg-card pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] shadow-[0_-10px_30px_-22px_rgb(31_26_23/0.45)] lg:static lg:border-0 lg:bg-transparent lg:p-3 lg:shadow-none"
    >
      <ul className="mx-auto flex max-w-xl gap-1 px-1.5 pt-1.5 pb-1 lg:flex-col lg:gap-0.5 lg:p-0">
        {destinations.map((destination) => {
          const on = destination === marked;
          return (
            <li key={destination.to} className="min-w-0 flex-1 lg:flex-none">
              <Link
                to={destination.to}
                // "page" on the destination's own screen, "true" on one under it.
                aria-current={pathname === destination.to ? "page" : destination === here ? "true" : undefined}
                className={`group flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1 text-center text-sm leading-tight [overflow-wrap:anywhere] transition-colors duration-150 lg:min-h-13 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-lg ${
                  on
                    ? "font-semibold text-foreground lg:bg-sidebar-accent"
                    : "font-medium text-muted-foreground hover:text-foreground lg:hover:bg-sidebar-accent/60"
                }`}
              >
                {/* Where the User is: the drawing on espresso, and the word in bold. */}
                <span
                  // Never wider than its link: with text twice as large the bar has no room to spare.
                  className={`grid h-8 w-full max-w-14 shrink-0 place-items-center rounded-full transition-[background-color,color,scale] duration-200 ease-out group-active:scale-95 lg:size-9 ${
                    on ? "bg-primary text-primary-foreground shadow-press" : "group-hover:bg-muted"
                  }`}
                >
                  <NavigationDrawing icon={destination.icon} className="size-[1.375rem]" />
                </span>
                {destination.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function Shell({ loaderData }: Route.ComponentProps) {
  const { user, destinations } = loaderData;
  const { pathname } = useLocation();
  // Every tap that starts a round trip says so at once (spec §3.4); the words
  // float, so nothing on the page moves.
  const busy = useNavigation().state !== "idle";

  // A new screen takes the keyboard and the screen reader with it, unless
  // something on it already asked for the focus. A list that only changes its
  // filters or its page stays where the User is.
  const main = useRef<HTMLElement>(null);
  const shown = useRef(pathname);
  useEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    if (main.current && !main.current.contains(document.activeElement)) {
      main.current.focus({ preventScroll: true });
    }
  }, [pathname]);

  // A field that takes the focus is brought clear of the bar and of what
  // sticks above it. Browsers do that by themselves for a button or a link
  // (`scroll-padding-bottom`); WebKit shows a field's caret wherever it is,
  // the bar over it or not. A choice drawn inside the card that is its label
  // (Efectivo, Transferencia) brings the whole card: the browser brings only
  // the mark, and the words under it would stay under the bar. Where the
  // browser already did, this moves nothing.
  useEffect(() => {
    const reveal = (event: FocusEvent) => {
      const control = event.target;
      if (!(control instanceof HTMLElement)) return;
      const shown = control.matches("input, textarea, select") ? control : control.closest("label");
      if (!shown) return;
      requestAnimationFrame(() => {
        if (document.activeElement === control) shown.scrollIntoView({ block: "nearest" });
      });
    };
    document.addEventListener("focusin", reveal);
    return () => document.removeEventListener("focusin", reveal);
  }, []);

  return (
    <div className="min-h-dvh lg:pl-64">
      <a
        href="#contenido"
        className="sr-only rounded-lg bg-background font-semibold focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-30 focus:px-4 focus:py-3"
      >
        Ir al contenido
      </a>

      <div className="lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-sidebar-border lg:bg-sidebar">
        {/* On a phone the screen starts with its content: who is signed in is
            said on Inicio and on Más, and here only to a screen reader. */}
        <header className="sr-only lg:not-sr-only lg:flex lg:flex-col lg:gap-5 lg:px-6 lg:pt-8 lg:pb-5">
          <div className="lg:flex lg:items-center lg:gap-3">
            <Monogram className="size-10 text-[1.625rem] max-lg:hidden" />
            <Wordmark />
          </div>
          <p className="wrap-break-word text-muted-foreground">
            {user.name} · {roleLabel[user.role]}
          </p>
        </header>
        <Destinations destinations={destinations} />
      </div>

      {/* A thin line that runs along the top while a screen is on its way:
          only a drawing, and only then, since it never ends by itself. */}
      {busy ? (
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-20 h-0.5 overflow-hidden">
          <div className="h-full w-2/5 animate-progress rounded-full bg-brand" />
        </div>
      ) : null}
      <p
        aria-live="polite"
        className={`pointer-events-none fixed top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-card py-1.5 pr-4 pl-3 text-base font-medium text-foreground shadow-float ring-1 ring-border transition-opacity duration-200 ${
          busy ? "opacity-100" : "opacity-0"
        }`}
      >
        {busy ? (
          <>
            <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-muted border-t-brand" />
            Cargando…
          </>
        ) : (
          ""
        )}
      </p>

      {/* The room under it is the bar's, so the last control is never behind it. */}
      <main
        id="contenido"
        ref={main}
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl pt-[max(1.75rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-(--bar-room) pl-[max(1rem,env(safe-area-inset-left))] outline-none lg:px-10 lg:pt-12 lg:pb-16"
      >
        <Outlet />
      </main>
    </div>
  );
}
