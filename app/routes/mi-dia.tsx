import { Effect } from "effect";

import { CurrentUser } from "~/backend/current-user";
import { myDay } from "~/backend/day";
import { run } from "~/backend/run.server";
import { FiguresPanel } from "~/components/figures";
import { hint, pageTitle } from "~/components/styles";
import { Card, CardContent } from "~/components/ui/card";
import { requireUser } from "~/session.server";
import { formatDay, formatTime } from "~/shared/day";
import { formatMoney } from "~/shared/money";
import { paymentMethodLabel } from "~/shared/payment";

import type { Route } from "./+types/mi-dia";

// Mi día (spec §6.1, UI redesign §7.1): what the signed-in User collected and
// sold today, with their Payments and Lines. The User comes from the session
// and the read takes no argument, so there is no way to ask for another
// User's figures (spec §4.2); the screen says whose they are. This is the
// only place a Worker sees their own Paid or Voided Bills, and only through
// the Lines and Payments their name carries (spec §4.1).

export const meta: Route.MetaFunction = () => [{ title: "Mi día · Gamo Cafe" }];

export async function loader({ context }: Route.LoaderArgs) {
  const user = requireUser(context);
  const mine = await run(context, myDay().pipe(Effect.provideService(CurrentUser, user)));
  return { name: user.name, ...mine };
}

const row = "flex flex-wrap items-baseline justify-between gap-x-3 border-t py-3 first:border-t-0 first:pt-0 last:pb-0";

export default function MiDia({ loaderData }: Route.ComponentProps) {
  const { name, day, figures, lines, payments } = loaderData;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className={pageTitle}>Mi día</h1>
        <p className="wrap-break-word">
          Solo lo que registró <strong className="font-semibold">{name}</strong> hoy, {formatDay(day)}.
        </p>
      </div>

      <section aria-labelledby="resumen" className="flex flex-col gap-3">
        <h2 id="resumen" className="text-xl font-semibold">
          Resumen
        </h2>
        <Card size="sm">
          <CardContent>
            <FiguresPanel figures={figures} />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="pagos" className="flex flex-col gap-3">
        <h2 id="pagos" className="text-xl font-semibold">
          Pagos que recibiste
        </h2>
        {payments.length === 0 ? (
          <p className={hint}>Todavía no has cobrado nada hoy.</p>
        ) : (
          <Card size="sm">
            <CardContent>
              <ul aria-label="Pagos que recibiste" className="flex flex-col">
                {payments.map((payment) => (
                  <li key={payment.id} className={row}>
                    <span className="max-w-full min-w-0 font-medium wrap-anywhere">
                      {`${paymentMethodLabel[payment.method]} · ${formatTime(payment.at)}`}
                    </span>
                    <span className="max-w-full min-w-0 font-semibold wrap-anywhere tabular-nums">{formatMoney(payment.amount)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="productos" className="flex flex-col gap-3">
        <h2 id="productos" className="text-xl font-semibold">
          Productos que vendiste
        </h2>
        {lines.length === 0 ? (
          <p className={hint}>Todavía no has vendido nada hoy.</p>
        ) : (
          <Card size="sm">
            <CardContent>
              <ul aria-label="Productos que vendiste" className="flex flex-col">
                {lines.map((line) => (
                  <li key={line.id} className={row}>
                    <span className="max-w-full min-w-0">
                      <span className="block font-medium wrap-anywhere">{`${line.quantity} × ${line.itemName}`}</span>
                      <span className={`block wrap-anywhere ${hint}`}>
                        {`${formatTime(line.at)} · ${formatMoney(line.unitPrice)} c/u`}
                      </span>
                    </span>
                    <span className="max-w-full min-w-0 font-semibold wrap-anywhere tabular-nums">{formatMoney(line.quantity * line.unitPrice)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
