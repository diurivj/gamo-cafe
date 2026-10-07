import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { ErrorPage } from "./components/error-screen";
import { noticeMiddleware } from "./notice.server";
import { sessionMiddleware } from "./session.server";

// Runs before every loader and action of every route: nothing but the public
// paths answers without a valid session (spec §10.1). Then the notice a
// recorded form left for the page is read from its cookie (spec §3.4).
export const middleware: Route.MiddlewareFunction[] = [sessionMiddleware, noticeMiddleware];

export const meta: Route.MetaFunction = () => [{ title: "Gamo Cafe" }];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#ffffff" />
        <meta name="robots" content="noindex" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh text-lg antialiased">
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
  // What no screen inside the shell could answer: a path the app does not
  // have, or a failure before the shell had its User. `routes/screen.tsx`
  // answers everything else inside the navigation.
  return <ErrorPage error={error} />;
}
