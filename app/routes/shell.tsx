import { useEffect, useRef } from "react";
import { Link, Outlet, type ShouldRevalidateFunctionArgs, useLocation, useNavigation } from "react-router";

import { NavigationDrawing } from "~/components/icons";
import { destinationsFor } from "~/navigation.server";
import { requireUser } from "~/session.server";
import { type Destination, destinationAt } from "~/shared/navigation";
import { roleLabel } from "~/shared/role";
import { shellMiddleware } from "~/shell.server";

import type { Route } from "./+types/shell";

/**
 * The signed-in shell: who is signed in and the role's four destinations
 * (UI redesign §4.1). A bar that floats over the bottom of a phone, a column
 * at the side of a wider screen; the same links in both. Everything else, and the way out,
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

  return (
    <nav
      aria-label="Principal"
      className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-10 mx-auto max-w-sm rounded-[2rem] border-[2.5px] border-ink bg-raised/90 p-1.5 shadow-[4px_4px_0_#000] backdrop-blur-xl lg:static lg:mx-0 lg:max-w-none lg:rounded-none lg:border-0 lg:bg-transparent lg:p-3 lg:shadow-none lg:backdrop-blur-none"
    >
      <ul className="flex lg:flex-col lg:gap-1">
        {destinations.map((destination) => (
          <li key={destination.to} className="min-w-0 flex-1 lg:flex-none">
            <Link
              to={destination.to}
              // "page" on the destination's own screen, "true" on one under it.
              aria-current={pathname === destination.to ? "page" : destination === here ? "true" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[1.6rem] px-1 py-1 text-center text-sm leading-tight font-bold [overflow-wrap:anywhere] transition-colors active:scale-95 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-xl lg:px-4 lg:text-lg ${
                destination === marked ? "bg-ink text-white" : "text-ink hover:bg-ink/10"
              }`}
            >
              <NavigationDrawing icon={destination.icon} />
              {destination.label}
            </Link>
          </li>
        ))}
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

  return (
    <div className="min-h-dvh lg:pl-64">
      <a
        href="#contenido"
        className="sr-only rounded-lg bg-raised font-semibold focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-30 focus:px-4 focus:py-3"
      >
        Ir al contenido
      </a>

      <div className="lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col lg:border-r-[2.5px] lg:border-ink">
        {/* On a phone the screen starts with its content: who is signed in is
            said on Inicio and on Más, and here only to a screen reader. */}
        <header className="sr-only lg:not-sr-only lg:flex lg:flex-col lg:gap-1 lg:px-6 lg:pt-8 lg:pb-4">
          <p className="text-xl font-black">Gamo Cafe</p>
          <p className="wrap-break-word text-ink-soft">
            {user.name} · {roleLabel[user.role]}
          </p>
        </header>
        <Destinations destinations={destinations} />
      </div>

      <p
        aria-live="polite"
        className={`pointer-events-none fixed top-2 left-1/2 z-20 -translate-x-1/2 rounded-full bg-ink px-4 py-1 text-white ${
          busy ? "opacity-100" : "opacity-0"
        }`}
      >
        {busy ? "Cargando…" : ""}
      </p>

      {/* The room under it is the bar's, so the last control is never behind it. */}
      <main
        id="contenido"
        ref={main}
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl pt-[max(1.5rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-(--bar-room) pl-[max(1rem,env(safe-area-inset-left))] outline-none lg:px-8 lg:pb-12"
      >
        <Outlet />
      </main>
    </div>
  );
}
