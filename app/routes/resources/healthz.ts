import { checkHealth } from "~/backend/health";
import { run } from "~/backend/run.server";

import type { Route } from "./+types/healthz";

// The reference loader: stay thin. Parse input, run one program, turn the
// result into a response.
//
// This is the one loader besides Entrar that answers without a session, so
// that a deploy can be checked from the command line. It therefore says only
// whether the app is up, and nothing that it holds.
export async function loader({ context }: Route.LoaderArgs) {
  const health = await run(context, checkHealth);
  return Response.json({ ok: health.ok }, { status: health.ok ? 200 : 503 });
}
