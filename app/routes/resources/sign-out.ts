import { redirect } from "react-router";

import { run } from "~/backend/run.server";
import { signOut } from "~/backend/sign-in";
import { clearedSessionCookie, requireUser, sessionToken, SIGN_IN_PATH } from "~/session.server";

import type { Route } from "./+types/sign-out";

// Signing out is a POST; a visit to the address goes home.
export function loader({ context }: Route.LoaderArgs) {
  requireUser(context);
  throw redirect("/");
}

/** Ends the session of this phone only. */
export async function action({ context, request }: Route.ActionArgs) {
  requireUser(context);
  const token = sessionToken(request);
  if (token) await run(context, signOut(token));
  throw redirect(SIGN_IN_PATH, { headers: { "Set-Cookie": clearedSessionCookie } });
}
