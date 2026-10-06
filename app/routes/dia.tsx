import { Effect } from "effect";
import { Form } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { figuresForRange, itemsSoldForRange } from "~/backend/day";
import { run } from "~/backend/run.server";
import { today } from "~/backend/time";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
import { type Day, formatDay } from "~/shared/day";
import { formatMoney } from "~/shared/money";
import { SubmitButton } from "~/components/submit-button";

import type { Route } from "./+types/dia";

// Día (spec §6.2): for a date or a from–to range, Sold, Collected in cash and
// by transfer, the same per User, and Items sold with quantities and value.
// Defaults to today. Admin only: a Worker never sees the Day (spec §4.1).
// Every read is driven by the by-Day indexes, so the rows read follow the
// range asked for and never the rest of the history (spec §2.4, §7.4).

export const meta: Route.MetaFunction = () => [{ title: "Día · Gamo Cafe" }];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The Day a field asked for, or `fallback` when it is empty or unreadable. */
function dayField(typed: string | null, fallback: Day): Day {
  const trimmed = (typed ?? "").trim();
  if (!DAY.test(trimmed)) return fallback;
  const date = new Date(`${trimmed}T00:00:00Z`);
  // `Date` rolls an overflowed day over (`2026-02-31` becomes March 3), so a
  // Day is only a Day when its own parts come back.
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed ? fallback : trimmed;
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const url = new URL(request.url);

  const program = Effect.gen(function* () {
    const day = yield* today;
    const desde = dayField(url.searchParams.get("desde"), day);
    const hasta = dayField(url.searchParams.get("hasta"), day);
    if (hasta < desde) {
      return {
        desde,
        hasta,
        error: "La fecha final no puede ser anterior a la inicial.",
        figures: null,
        items: [],
      };
    }

    const range = { from: desde, to: hasta };
    const read = yield* Effect.all({ figures: figuresForRange(range), items: itemsSoldForRange(range) });
    return { desde, hasta, error: null, ...read };
  }).pipe(Effect.provideService(CurrentUser, admin));

  return run(context, program, refuseRead);
}

const row = "flex items-center justify-between gap-3 py-3";
const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3";

export default function Dia({ loaderData }: Route.ComponentProps) {
  const { desde, hasta, error, figures, items } = loaderData;

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

      <p className="text-stone-600">
        {desde === hasta ? formatDay(desde) : `${formatDay(desde)} al ${formatDay(hasta)}`}
      </p>

      {error === null ? null : (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}

      {figures === null ? null : (
        <>
          <section aria-labelledby="totales" className="rounded-2xl border border-stone-200 bg-white p-4">
            <h2 id="totales" className="text-xl font-semibold">
              Totales
            </h2>
            <dl className="mt-2 flex flex-col divide-y divide-stone-200 text-lg">
              <div className={row}>
                <dt className="font-medium">Vendido</dt>
                <dd className="font-semibold tabular-nums">{formatMoney(figures.total.sold)}</dd>
              </div>
              <div className={row}>
                <dt className="font-medium">Cobrado</dt>
                <dd className="font-semibold tabular-nums">{formatMoney(figures.total.collected)}</dd>
              </div>
              <div className={`${row} text-stone-600`}>
                <dt>Efectivo</dt>
                <dd className="tabular-nums">{formatMoney(figures.total.cash)}</dd>
              </div>
              <div className={`${row} text-stone-600`}>
                <dt>Transferencia</dt>
                <dd className="tabular-nums">{formatMoney(figures.total.transfer)}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="por-usuario">
            <h2 id="por-usuario" className="text-xl font-semibold">
              Por usuario
            </h2>
            {figures.byUser.length === 0 ? (
              <p className="mt-2 text-stone-600">Nadie registró nada en estas fechas.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-3">
                {figures.byUser.map((user) => (
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
            {items.length === 0 ? (
              <p className="mt-2 text-stone-600">No se vendió nada en estas fechas.</p>
            ) : (
              <ul
                aria-label="Productos vendidos"
                className="mt-2 flex flex-col divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white px-4"
              >
                {items.map((item) => (
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
