import { Effect } from "effect";
import { data, Form, Link, useNavigation } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { everyonesDay } from "~/backend/day";
import { run } from "~/backend/run.server";
import { requireAdminUser } from "~/catalog-forms.server";
import { FiguresPanel } from "~/components/figures";
import { ChevronDrawing } from "~/components/icons";
import { Notice } from "~/components/notice";
import { hint, pageTitle, rowCard } from "~/components/styles";
import { SubmitButton } from "~/components/submit-button";
import { buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatDay } from "~/shared/day";
import { formatMoney } from "~/shared/money";

import type { Route } from "./+types/dia";

// Día (spec §6.2, UI redesign §7.1): for a date or a from–to range, Collected
// in cash and by transfer, then Sold; the same per User and the Items sold,
// each a tap away so the summary stays short. Defaults to today. Admin only:
// a Worker never sees the Day (spec §4.1). Owed is not a figure of a Day: the
// screen links to Por cobrar and shows no amount of it.
// `everyonesDay` decides the range from what the URL asked and reads it, so
// the range this screen names is the one its figures are about; a range it
// refuses is answered 400 with the reason and no figures.

export const meta: Route.MetaFunction = () => [{ title: "Día · Gamo Cafe" }];

const unreadable = {
  from: "La fecha inicial no es una fecha válida.",
  to: "La fecha final no es una fecha válida.",
} as const;

export async function loader({ context, request }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const params = new URL(request.url).searchParams;

  const program = everyonesDay({ from: params.get("desde"), to: params.get("hasta") }).pipe(
    Effect.map((day) => ({ desde: day.range.from, hasta: day.range.to, error: null, day })),
    Effect.provideService(CurrentUser, admin),
  );

  return run(context, program, (error) => {
    switch (error._tag) {
      case "AdminOnly":
        throw new Response(null, { status: 403 });
      // Each field shows the end that was read, and nothing for one that was not.
      case "DayUnreadable":
        return refused(unreadable[error.field], error.from ?? "", error.to ?? "");
      case "RangeEndsBeforeItStarts":
        return refused("La fecha final no puede ser anterior a la inicial.", error.from, error.to);
    }
  });
}

const refused = (error: string, desde: string, hasta: string) =>
  data({ desde, hasta, error, day: null }, { status: 400 });

// A part of the screen that opens at a tap: its name, how many it holds, and
// which way it points. The count goes under the name when both do not fit.
const disclosure =
  "flex min-h-14 list-none cursor-pointer flex-wrap items-center justify-between gap-x-3 rounded-2xl px-(--card-spacing) py-2 text-lg font-medium";

export default function Dia({ loaderData }: Route.ComponentProps) {
  const { desde, hasta, error, day } = loaderData;
  // Another range is a round trip away. Until it is here the figures below
  // are still the ones of the range named above them: say so, and never let
  // them pass for the dates just asked.
  const navigation = useNavigation();
  const reading = navigation.state === "loading" && navigation.location.pathname === "/dia";

  return (
    <div className="flex flex-col gap-5">
      <h1 className={pageTitle}>Día</h1>

      <Form method="get" className="flex flex-col gap-3">
        <div className="@container">
          <div className="flex flex-col gap-3 @[30rem]:flex-row">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="desde">Desde</Label>
              <Input key={desde} id="desde" type="date" name="desde" defaultValue={desde} />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="hasta">Hasta</Label>
              <Input key={hasta} id="hasta" type="date" name="hasta" defaultValue={hasta} />
            </div>
          </div>
        </div>
        <SubmitButton pendingLabel="Viendo…" className={buttonClasses({ variant: "outline", size: "touch" })}>
          Ver
        </SubmitButton>
        {/* Its room is kept, so the figures do not move when it speaks. */}
        <p aria-live="polite" className={`min-h-7 ${hint}`}>
          {reading ? "Leyendo las fechas que pediste…" : ""}
        </p>
      </Form>

      {error === null ? null : <Notice tone="error">{error}</Notice>}

      {day === null ? null : (
        <div className={`flex flex-col gap-5 ${reading ? "opacity-60" : ""}`} aria-busy={reading}>
          <section aria-labelledby="resumen" className="flex flex-col gap-3">
            <h2 id="resumen" className="text-xl font-semibold wrap-break-word">
              {desde === hasta ? formatDay(desde) : `Del ${formatDay(desde)} al ${formatDay(hasta)}`}
            </h2>
            <Card size="sm">
              <CardContent>
                <FiguresPanel figures={day.total} />
              </CardContent>
            </Card>
          </section>

          {/* What is still owed is not a figure of these dates: it has a screen of its own. */}
          <Link to="/por-cobrar" className="block rounded-2xl">
            <Card size="sm" className={rowCard}>
              <CardContent className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-lg font-medium">Por cobrar</span>
                  <span className={`block ${hint}`}>Lo que se debe hoy, de cualquier fecha.</span>
                </span>
                <ChevronDrawing className="size-6 shrink-0" />
              </CardContent>
            </Card>
          </Link>

          <Card size="sm" className="py-0">
            <details className="group">
              <summary className={disclosure}>
                <h2 className="max-w-full min-w-0 wrap-break-word">Por usuario</h2>
                <span className={`flex shrink-0 items-center gap-2 tabular-nums ${hint}`}>
                  {day.byUser.length}
                  {/* Points down once the part is open. */}
                  <ChevronDrawing className="size-6 group-open:rotate-90" />
                </span>
              </summary>
              <div className="px-(--card-spacing) pb-(--card-spacing)">
                {day.byUser.length === 0 ? (
                  <p className={hint}>Nadie registró nada en estas fechas.</p>
                ) : (
                  <ul aria-label="Por usuario" className="flex flex-col">
                    {day.byUser.map((user) => (
                      <li key={user.userId} className="flex flex-col gap-2 border-t py-4 last:pb-0">
                        <h3 className="text-lg font-semibold wrap-break-word">{user.userName}</h3>
                        <FiguresPanel figures={user} compact />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </Card>

          <Card size="sm" className="py-0">
            <details className="group">
              <summary className={disclosure}>
                <h2 className="max-w-full min-w-0 wrap-break-word">Productos vendidos</h2>
                <span className={`flex shrink-0 items-center gap-2 tabular-nums ${hint}`}>
                  {day.items.length}
                  {/* Points down once the part is open. */}
                  <ChevronDrawing className="size-6 group-open:rotate-90" />
                </span>
              </summary>
              <div className="px-(--card-spacing) pb-(--card-spacing)">
                {day.items.length === 0 ? (
                  <p className={hint}>No se vendió nada en estas fechas.</p>
                ) : (
                  <ul aria-label="Productos vendidos" className="flex flex-col">
                    {day.items.map((item) => (
                      <li
                        key={item.itemId}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 border-t py-3 last:pb-0"
                      >
                        <span className="max-w-full min-w-0">
                          <span className="block font-medium wrap-anywhere">{item.itemName}</span>
                          <span className={`block ${hint}`}>{`Cantidad: ${item.quantity}`}</span>
                        </span>
                        <span className="max-w-full min-w-0 font-semibold wrap-anywhere tabular-nums">{formatMoney(item.sold)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </Card>
        </div>
      )}
    </div>
  );
}
