import { Effect } from "effect";
import { data, Form } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { everyonesDay } from "~/backend/day";
import { run } from "~/backend/run.server";
import { requireAdminUser } from "~/catalog-forms.server";
import { Notice } from "~/components/notice";
import { SubmitButton } from "~/components/submit-button";
import { formatDay } from "~/shared/day";
import { formatMoney } from "~/shared/money";

import type { Route } from "./+types/dia";

// Día (spec §6.2): for a date or a from–to range, Sold, Collected in cash and
// by transfer, the same per User, and Items sold with quantities and value.
// Defaults to today. Admin only: a Worker never sees the Day (spec §4.1).
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

const row = "flex items-center justify-between gap-3 py-3";
const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3";

export default function Dia({ loaderData }: Route.ComponentProps) {
  const { desde, hasta, error, day } = loaderData;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Día</h1>

      <Form method="get" className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1">
            <span className="font-medium">Desde</span>
            <input type="date" name="desde" defaultValue={desde} className={field} />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="font-medium">Hasta</span>
            <input type="date" name="hasta" defaultValue={hasta} className={field} />
          </label>
        </div>
        <SubmitButton pendingLabel="Viendo…" className="mt-4 rounded-xl bg-stone-900 px-4 py-3 font-semibold text-white disabled:opacity-60">
          Ver
        </SubmitButton>
      </Form>

      {error === null ? null : <Notice tone="error">{error}</Notice>}

      {day === null ? null : (
        <>
          <p className="text-stone-600">
            {desde === hasta ? formatDay(desde) : `${formatDay(desde)} al ${formatDay(hasta)}`}
          </p>

          <section aria-labelledby="totales" className="rounded-2xl border border-stone-200 bg-white p-4">
            <h2 id="totales" className="text-xl font-semibold">
              Totales
            </h2>
            <dl className="mt-2 flex flex-col divide-y divide-stone-200 text-lg">
              <div className={row}>
                <dt className="font-medium">Vendido</dt>
                <dd className="font-semibold tabular-nums">{formatMoney(day.total.sold)}</dd>
              </div>
              <div className={row}>
                <dt className="font-medium">Cobrado</dt>
                <dd className="font-semibold tabular-nums">{formatMoney(day.total.collected)}</dd>
              </div>
              <div className={`${row} text-stone-600`}>
                <dt>Efectivo</dt>
                <dd className="tabular-nums">{formatMoney(day.total.cash)}</dd>
              </div>
              <div className={`${row} text-stone-600`}>
                <dt>Transferencia</dt>
                <dd className="tabular-nums">{formatMoney(day.total.transfer)}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="por-usuario">
            <h2 id="por-usuario" className="text-xl font-semibold">
              Por usuario
            </h2>
            {day.byUser.length === 0 ? (
              <p className="mt-2 text-stone-600">Nadie registró nada en estas fechas.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-3">
                {day.byUser.map((user) => (
                  <li key={user.userId} className="rounded-2xl border border-stone-200 bg-white p-4">
                    <p className="font-medium">{user.userName}</p>
                    <p className="mt-1 text-stone-600">
                      {`Vendido ${formatMoney(user.sold)} · Cobrado ${formatMoney(user.collected)}`}
                    </p>
                    <p className="text-stone-600">
                      {`Efectivo ${formatMoney(user.cash)} · Transferencia ${formatMoney(user.transfer)}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="productos-vendidos">
            <h2 id="productos-vendidos" className="text-xl font-semibold">
              Productos vendidos
            </h2>
            {day.items.length === 0 ? (
              <p className="mt-2 text-stone-600">No se vendió nada en estas fechas.</p>
            ) : (
              <ul
                aria-label="Productos vendidos"
                className="mt-2 flex flex-col divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white px-4"
              >
                {day.items.map((item) => (
                  <li key={item.itemId} className={row}>
                    <span className="min-w-0">
                      <span className="block break-words font-medium">{item.itemName}</span>
                      <span className="block text-sm text-stone-600">{`Cantidad: ${item.quantity}`}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatMoney(item.sold)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
