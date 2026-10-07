import { Outlet } from "react-router";

import { ErrorScreen } from "~/components/error-screen";

import type { Route } from "./+types/screen";

/**
 * The layout between the shell and its screens. It shows nothing of its own:
 * it is where a screen's failure stops, so the User stays inside their
 * navigation (UI redesign §7). A Worker who opens an Admin screen or a Bill
 * they may not see, a record that is not there, a form that failed on its
 * way: each is answered in the screen's place, with the shell around it.
 */
export default function Screen() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorScreen error={error} />;
}
