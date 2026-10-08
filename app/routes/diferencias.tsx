import { Effect } from "effect";
import { Link } from "react-router";

import { listCounts } from "~/backend/counts";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
import { CountLineItem } from "~/components/count-line";
import { ChevronDrawing } from "~/components/icons";
import { LoadMore, usePagedList } from "~/components/paged-list";
import { hint, pageTitle } from "~/components/styles";
import { buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { COUNT_PATH, countSummary } from "~/shared/count";
import { CURSOR_PARAM, cursorOf, nextText } from "~/shared/cursor";
import { formatDay, formatTime } from "~/shared/day";
import { STOCK_PATH } from "~/shared/stock-change";

import type { Route } from "./+types/diferencias";

export const meta: Route.MetaFunction = () => [{ title: "Diferencias · Gamo Cafe" }];

// Diferencias (spec §6.2; UI redesign §7): per Count, who recorded it and
// when, and each Item's expected, found and difference in words, newest Count
// first, a few Counts per page. A Count with no Discrepancy is listed like any
// other. Admin only.

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
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className={`${pageTitle} wrap-break-word`}>Diferencias</h1>
        <p className={hint}>Cada conteo, del más reciente al más antiguo, con lo que se esperaba y lo que se contó.</p>
        <Link
          to={STOCK_PATH}
          className="inline-flex min-h-12 items-center gap-1 self-start font-medium underline underline-offset-4"
        >
          Ver Inventario
          <ChevronDrawing className="size-5" />
        </Link>
      </div>

      {counts.length === 0 ? (
        <>
          <p>Todavía no hay conteos.</p>
          <Link to={COUNT_PATH} className={buttonClasses({ size: "touch" })}>
            Contar existencias
          </Link>
        </>
      ) : (
        <ul aria-label="Conteos" className="flex flex-col gap-3">
          {counts.map((count) => {
            const when = `${formatDay(count.day)} a las ${formatTime(count.at)}`;
            return (
              <li key={count.id} data-count-id={count.id} aria-label={`Conteo del ${when}`}>
                <Card size="sm">
                  <CardContent className="flex flex-col gap-1">
                    <h2 className="text-xl font-semibold wrap-break-word">{`Conteo del ${when}`}</h2>
                    <p className={`${hint} wrap-break-word`}>{`Registrado por ${count.byName}`}</p>
                    {count.note ? <p className="wrap-break-word">{`Nota: ${count.note}`}</p> : null}
                    <p className="font-medium wrap-break-word">{`${countSummary(count.lines)}.`}</p>
                    <ul aria-label={`Productos del conteo del ${when}`} className="mt-1 flex flex-col divide-y border-t">
                      {count.lines.map((line) => (
                        <CountLineItem key={line.itemId} line={line} />
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <LoadMore more={more} />
    </div>
  );
}
