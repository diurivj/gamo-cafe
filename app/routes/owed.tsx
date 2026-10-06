import { Effect } from "effect";
import { Link } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { listOwed } from "~/backend/owed";
import { run } from "~/backend/run.server";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
import { LoadMore, usePagedList } from "~/components/paged-list";
import { CURSOR_PARAM, cursorOf, nextText } from "~/shared/cursor";
import { formatDay } from "~/shared/day";
import { formatMoney } from "~/shared/money";

import type { Route } from "./+types/owed";

// Por cobrar (spec §6.2): each Customer with what they owe and the Day of
// their oldest Open Bill, then the Open Bills with no Customer, flagged when
// from an earlier Day. Overall Owed at the top. Admin only (spec §4.1). The
// Customers are bounded by who buys on credit; the loose Bills come a page at
// a time.

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

const row = "block rounded-2xl border border-stone-300 bg-white p-4 active:bg-stone-100";

export default function Owed({ loaderData }: Route.ComponentProps) {
  const { total, customers } = loaderData.owed;
  const { rows: bills, more } = usePagedList({ id: "sin-cliente", data: loaderData, pageOf, hrefFor });

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">Por cobrar</h1>

      <p className="rounded-2xl border border-stone-200 bg-white p-4 text-lg">
        {"Total por cobrar: "}
        <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
      </p>

      <section aria-labelledby="clientes-por-cobrar">
        <h2 id="clientes-por-cobrar" className="text-xl font-semibold">
          Clientes
        </h2>
        {customers.length === 0 ? (
          <p className="mt-3 text-stone-600">Ningún cliente debe nada.</p>
        ) : (
          <ul aria-label="Clientes por cobrar" className="mt-3 flex flex-col gap-2">
            {customers.map((customer) => (
              <li key={customer.customerId}>
                <Link to={`/clientes/${customer.customerId}`} className={row}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 truncate text-lg font-medium">{customer.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatMoney(customer.owed)}</span>
                  </span>
                  <span className="mt-1 block text-stone-600">
                    {`Cuenta más antigua: ${formatDay(customer.oldestDay)}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cuentas-sin-cliente">
        <h2 id="cuentas-sin-cliente" className="text-xl font-semibold">
          Cuentas sin cliente
        </h2>
        {bills.length === 0 ? (
          <p className="mt-3 text-stone-600">No hay cuentas abiertas sin cliente.</p>
        ) : (
          <ul aria-label="Cuentas sin cliente" className="mt-3 flex flex-col gap-2">
            {bills.map((bill) => (
              <li key={bill.id} data-owed-bill-id={bill.id}>
                <Link to={`/cuentas/${bill.id}`} className={row}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="block text-stone-600">{formatDay(bill.day)}</span>
                    {bill.fromEarlierDay ? (
                      <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium">
                        De un día anterior
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-2 block tabular-nums text-stone-700">
                    {`Total ${formatMoney(bill.total)} · Pagado ${formatMoney(bill.paid)} · Debe ${formatMoney(bill.owed)}`}
                  </span>
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
