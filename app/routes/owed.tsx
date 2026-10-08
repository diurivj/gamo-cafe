import { Effect } from "effect";
import { Link } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { listOwed } from "~/backend/owed";
import { run } from "~/backend/run.server";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
import { ChevronDrawing } from "~/components/icons";
import { LoadMore, usePagedList } from "~/components/paged-list";
import { hint, pageTitle } from "~/components/styles";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { CURSOR_PARAM, cursorOf, nextText } from "~/shared/cursor";
import { formatDay } from "~/shared/day";
import { formatMoney } from "~/shared/money";

import type { Route } from "./+types/owed";

// Por cobrar (spec §6.2, UI redesign §7.1): what is owed now, whatever Day
// it was consumed on. The overall Owed leads; then each Customer with what
// they owe and the Day of their oldest Open Bill; then the Open Bills with no
// Customer, by their note, flagged when from an earlier Day. It has no date
// to choose: it is not a figure of a Day. Admin only (spec §4.1). The
// Customers are bounded by who buys on credit; the loose Bills come a page at
// a time. A row leads to the Customer or the Bill, where the money is taken.

export const meta: Route.MetaFunction = () => [{ title: "Por cobrar · Gamo Cafe" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const owed = await run(
    context,
    listOwed(cursorOf(request.url)).pipe(Effect.provideService(CurrentUser, admin)),
    refuseRead,
  );
  return { owed: { ...owed, next: nextText(owed.next) } };
}

type Data = Route.ComponentProps["loaderData"];
const pageOf = (data: Data) => ({ rows: data.owed.bills, next: data.owed.next });
const hrefFor = (cursor: string) => `/por-cobrar?${CURSOR_PARAM}=${encodeURIComponent(cursor)}`;

// A label and its amount side by side, or the amount under it when both do not fit.
const figureRow = "flex flex-wrap items-baseline justify-between gap-x-3";
// An amount too long for its line breaks where it must: it is never cut.
const amountClasses = "max-w-full min-w-0 font-heading font-semibold wrap-anywhere tabular-nums";
const rowCard = "transition-colors hover:bg-muted/60 active:bg-muted";
const leadsOn = "inline-flex items-center gap-1 font-medium";

export default function Owed({ loaderData }: Route.ComponentProps) {
  const { total, customers } = loaderData.owed;
  const { rows: bills, more } = usePagedList({ id: "sin-cliente", data: loaderData, pageOf, hrefFor });

  return (
    <div className="flex flex-col gap-6">
      <h1 className={pageTitle}>Por cobrar</h1>

      <Card size="sm">
        <CardContent>
          <dl className={figureRow}>
            <dt className="text-xl font-medium">Se debe ahora</dt>
            <dd data-figure="owed" className={`${amountClasses} text-4xl`}>
              {formatMoney(total)}
            </dd>
            <dd className={`basis-full ${hint}`}>Lo que falta por pagar de las cuentas abiertas, de cualquier fecha.</dd>
          </dl>
        </CardContent>
      </Card>

      <section aria-labelledby="clientes-por-cobrar" className="flex flex-col gap-3">
        <h2 id="clientes-por-cobrar" className="text-xl font-semibold">
          Clientes
        </h2>
        {customers.length === 0 ? (
          <p className={hint}>Ningún cliente debe nada.</p>
        ) : (
          <ul aria-label="Clientes por cobrar" className="flex flex-col gap-3">
            {customers.map((customer) => (
              <li key={customer.customerId}>
                {/* The Customer's page goes back to this entry, not on to Clientes. */}
                <Link
                  to={`/clientes/${customer.customerId}`}
                  state={{ fromList: "/por-cobrar" }}
                  className="block rounded-2xl"
                >
                  <Card size="sm" className={rowCard}>
                    <CardContent className="flex flex-col gap-2">
                      <span className="max-w-full min-w-0 text-xl font-semibold wrap-anywhere">{customer.name}</span>
                      <span className={`${figureRow} border-t pt-2`}>
                        <span className="font-medium">Debe</span>{" "}
                        <span className={`${amountClasses} text-2xl`}>{formatMoney(customer.owed)}</span>
                      </span>
                      <span className="flex flex-wrap items-center justify-between gap-x-3">
                        <span className={hint}>{`Cuenta más antigua: ${formatDay(customer.oldestDay)}`}</span>
                        <span className={leadsOn}>
                          Ver cliente
                          <ChevronDrawing className="size-5" />
                        </span>
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cuentas-sin-cliente" className="flex flex-col gap-3">
        <h2 id="cuentas-sin-cliente" className="text-xl font-semibold">
          Cuentas sin cliente
        </h2>
        {bills.length === 0 ? (
          <p className={hint}>No hay cuentas abiertas sin cliente.</p>
        ) : (
          <ul aria-label="Cuentas sin cliente" className="flex flex-col gap-3">
            {bills.map((bill) => (
              <li key={bill.id} data-owed-bill-id={bill.id}>
                {/* Cuenta goes back to this entry, not on to a new list. */}
                <Link to={`/cuentas/${bill.id}`} state={{ fromList: "/por-cobrar" }} className="block rounded-2xl">
                  <Card size="sm" className={rowCard}>
                    <CardContent className="flex flex-col gap-2">
                      {/* The note is all that says whose it is. */}
                      <span className="max-w-full min-w-0 text-xl font-semibold wrap-anywhere">
                        {bill.note ?? "Sin nota"}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className={hint}>{formatDay(bill.day)}</span>
                        {bill.fromEarlierDay ? <Badge variant="secondary">De un día anterior</Badge> : null}
                      </span>
                      <span className={`${figureRow} border-t pt-2`}>
                        <span className="font-medium">Debe</span>{" "}
                        <span className={`${amountClasses} text-2xl`}>{formatMoney(bill.owed)}</span>
                      </span>
                      <span className="flex flex-wrap items-center justify-between gap-x-3">
                        <span className={`max-w-full min-w-0 wrap-anywhere tabular-nums ${hint}`}>
                          {`Total ${formatMoney(bill.total)} · Pagado ${formatMoney(bill.paid)}`}
                        </span>
                        <span className={leadsOn}>
                          Ver cuenta
                          <ChevronDrawing className="size-5" />
                        </span>
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <LoadMore more={more} />
      </section>
    </div>
  );
}
