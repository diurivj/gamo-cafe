import { Effect } from "effect";

import { listCounts } from "~/backend/counts";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
import { CountLineItem } from "~/components/count-line";
import { LoadMore, usePagedList } from "~/components/paged-list";
import { CURSOR_PARAM, cursorOf, nextText } from "~/shared/cursor";
import { formatDay, formatTime } from "~/shared/day";

import type { Route } from "./+types/diferencias";

export const meta: Route.MetaFunction = () => [{ title: "Diferencias · Gamo Cafe" }];

// Diferencias (spec §6.2): per Count, each Item's expected, found and
// difference, newest Count first, a few Counts per page. Admin only.

export async function loader({ context, request }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const page = await run(
    context,
    listCounts(cursorOf(request.url)).pipe(Effect.provideService(CurrentUser, admin)),
    refuseRead,
  );
  return { counts: page.counts, next: nextText(page.next) };
}

type Data = Route.ComponentProps["loaderData"];
const pageOf = (data: Data) => ({ rows: data.counts, next: data.next });
const hrefFor = (cursor: string) => `/diferencias?${CURSOR_PARAM}=${encodeURIComponent(cursor)}`;

export default function Diferencias({ loaderData }: Route.ComponentProps) {
  const { rows: counts, more } = usePagedList({ id: "diferencias", data: loaderData, pageOf, hrefFor });

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">Diferencias</h1>

      {counts.length === 0 ? (
        <p className="text-stone-600">Todavía no hay conteos.</p>
      ) : (
        counts.map((count) => (
          <section
            key={count.id}
            data-count-id={count.id}
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

      <LoadMore more={more} />
    </div>
  );
}
