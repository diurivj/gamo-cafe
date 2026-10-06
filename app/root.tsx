import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { sessionMiddleware } from "./session.server";

// Runs before every loader and action of every route: nothing but the public
// paths answers without a valid session (spec §10.1).
export const middleware: Route.MiddlewareFunction[] = [sessionMiddleware];

export const meta: Route.MetaFunction = () => [{ title: "Gamo Cafe" }];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#1c1917" />
        <meta name="robots" content="noindex" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh bg-stone-50 text-stone-900 antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // The status stays what the route threw; only the words change. A Worker who
  // opens an Admin screen or a Bill they may not see gets this page (ticket 20,
  // from the note left by ticket 03).
  let message = "Algo salió mal";
  let details = "Intenta de nuevo en un momento.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error) && error.status === 403) {
    message = "No tienes acceso a esta página";
    details = "Tu usuario no puede verla. Pídele a un administrador si necesitas entrar.";
  } else if (isRouteErrorResponse(error) && error.status === 404) {
    message = "No encontramos esta página";
    details = "";
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">{message}</h1>
      {details ? <p className="mt-2 text-stone-600">{details}</p> : null}
      {stack ? (
        <pre className="mt-4 w-full overflow-x-auto rounded-lg bg-stone-100 p-4 text-left text-xs">
          <code>{stack}</code>
        </pre>
      ) : null}
    </main>
  );
}
