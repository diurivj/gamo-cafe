import { checkHealth } from "~/backend/health";
import { run } from "~/backend/run.server";

import type { Route } from "./+types/healthz";

// The reference loader: stay thin. Parse input, run one program, turn the
// result into a response.
export async function loader({ context }: Route.LoaderArgs) {
  const health = await run(context, checkHealth);
  return Response.json(health, { status: health.ok ? 200 : 503 });
}
