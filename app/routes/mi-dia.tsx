import { Effect } from "effect";

import { CurrentUser } from "~/backend/current-user";
import { myDay } from "~/backend/day";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";
import { formatDay, formatTime } from "~/shared/day";
import { formatMoney } from "~/shared/money";
import { paymentMethodLabel } from "~/shared/payment";

import type { Route } from "./+types/mi-dia";

// Mi día (spec §6.1): what the signed-in User sold and collected today, in
// cash and by transfer, with their Lines and Payments. The User comes from the
// session and the read takes no argument, so there is no way to ask for
// another User's figures (spec §4.2). This is the only place a Worker sees
// their own Paid or Voided Bills, and only through the Lines and Payments
// their name carries (spec §4.1).

export const meta: Route.MetaFunction = () => [{ title: "Mi día · Gamo Cafe" }];

export async function loader({ context }: Route.LoaderArgs) {
  const user = requireUser(context);
  return run(context, myDay().pipe(Effect.provideService(CurrentUser, user)));
}

const row = "flex items-center justify-between gap-3 py-3";

export default function MiDia({ loaderData }: Route.ComponentProps) {
  const { day, figures, lines, payments } = loaderData;

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Mi día</h1>
      <p className="mt-1 text-stone-600">{formatDay(day)}</p>

      <section aria-labelledby="figuras" className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
        <h2 id="figuras" className="text-xl font-semibold">
          Hoy
        </h2>
        <dl className="mt-2 flex flex-col divide-y divide-stone-200 text-lg">
          <div className={row}>
            <dt className="font-medium">Vendido</dt>
            <dd className="font-semibold tabular-nums">{formatMoney(figures.sold)}</dd>
          </div>
          <div className={row}>
            <dt className="font-medium">Cobrado</dt>
            <dd className="font-semibold tabular-nums">{formatMoney(figures.collected)}</dd>
          </div>
          <div className={`${row} text-stone-600`}>
            <dt>Efectivo</dt>
            <dd className="tabular-nums">{formatMoney(figures.cash)}</dd>
          </div>
          <div className={`${row} text-stone-600`}>
            <dt>Transferencia</dt>
            <dd className="tabular-nums">{formatMoney(figures.transfer)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="vendido" className="mt-6">
        <h2 id="vendido" className="text-xl font-semibold">
          Vendido
        </h2>
        {lines.length === 0 ? (
          <p className="mt-2 text-stone-600">Todavía no has vendido nada hoy.</p>
        ) : (
          <ul
            aria-label="Líneas vendidas"
            className="mt-2 flex flex-col divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white px-4"
          >
            {lines.map((line) => (
              <li key={line.id} className={row}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{`${line.quantity} × ${line.itemName}`}</span>
                  <span className="block text-sm text-stone-600">
                    {`${formatTime(line.at)} · ${formatMoney(line.unitPrice)} c/u`}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatMoney(line.quantity * line.unitPrice)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cobrado" className="mt-6">
        <h2 id="cobrado" className="text-xl font-semibold">
          Cobrado
        </h2>
        {payments.length === 0 ? (
          <p className="mt-2 text-stone-600">Todavía no has cobrado nada hoy.</p>
        ) : (
          <ul
            aria-label="Pagos recibidos"
            className="mt-2 flex flex-col divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white px-4"
          >
            {payments.map((payment) => (
              <li key={payment.id} className={row}>
                <span className="font-medium">
                  {`${paymentMethodLabel[payment.method]} · ${formatTime(payment.at)}`}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{formatMoney(payment.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
