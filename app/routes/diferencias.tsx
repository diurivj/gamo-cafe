import { Effect } from "effect";

import { listCounts } from "~/backend/counts";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
import { CountLineItem } from "~/components/count-line";
import { formatDay, formatTime } from "~/shared/day";

import type { Route } from "./+types/diferencias";

export const meta: Route.MetaFunction = () => [{ title: "Diferencias · Gamo Cafe" }];

export async function loader({ context }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const counts = await run(
    context,
    listCounts().pipe(Effect.provideService(CurrentUser, admin)),
    refuseRead,
  );
  return { counts };
}

export default function Diferencias({ loaderData }: Route.ComponentProps) {
  const { counts } = loaderData;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">Diferencias</h1>

      {counts.length === 0 ? (
        <p className="text-stone-600">Todavía no hay conteos.</p>
      ) : (
        counts.map((count) => (
          <section
            key={count.id}
            aria-label={`Conteo de ${formatDay(count.day)} a las ${formatTime(count.at)}`}
            className="rounded-2xl border border-stone-200 bg-white p-4"
          >
            <h2 className="text-xl font-semibold">{formatDay(count.day)}</h2>
            <p className="mt-1 text-stone-600">
              {`${formatTime(count.at)} · ${count.byName}${count.note ? ` · ${count.note}` : ""}`}
            </p>
            <ul className="mt-3 flex flex-col divide-y divide-stone-200">
              {count.lines.map((line) => (
                <CountLineItem key={line.itemId} line={line} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
