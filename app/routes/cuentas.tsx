import { Effect } from "effect";
import { Form, Link, useNavigation } from "react-router";

import { type BillFilter, listBills } from "~/backend/bills";
import { getCustomer } from "~/backend/customers";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
import { CustomerPicker } from "~/components/customer-picker";
import { BILL_STATES, billStateLabel, type BillState } from "~/shared/bill-state";
import { formatDay } from "~/shared/day";
import { formatMoney } from "~/shared/money";
import { pageFrom } from "~/shared/page";

import type { Route } from "./+types/cuentas";

// Cuentas (spec §6.2): every Bill with its state, filtered by Day, state or
// Customer, 50 per page. An Admin screen: `requireAdminUser` refuses a Worker
// before the filters are read, and `listBills` refuses one again. Each row
// opens Cuenta.

export const meta: Route.MetaFunction = () => [{ title: "Cuentas · Gamo Cafe" }];

const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;

/** The filters the URL asked for, keeping only what can be applied. */
function filtersOf(params: URLSearchParams): Required<Omit<BillFilter, "settledOnly">> {
  const day = params.get("dia");
  const state = params.get("estado");
  return {
    day: day !== null && DAY_TEXT.test(day) ? day : null,
    state: BILL_STATES.find((known) => known === state) ?? null,
    customerId: params.get("cliente") || null,
    page: pageFrom(params.get("pagina")),
  };
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const filter = filtersOf(new URL(request.url).searchParams);

  const { listed, customer } = await run(
    context,
    Effect.gen(function* () {
      const listed = yield* listBills(filter);
      // The chosen Customer's name, so the picker shows the filter that is on.
      const customer =
        filter.customerId === null
          ? null
          : yield* getCustomer(filter.customerId).pipe(
              Effect.catchTag("CustomerNotFound", () => Effect.succeed(null)),
            );
      return { listed, customer };
    }).pipe(Effect.provideService(CurrentUser, admin)),
    refuseRead,
  );

  return {
    ...filter,
    bills: listed.bills,
    hasMore: listed.hasMore,
    customer: customer === null ? null : { id: customer.id, name: customer.name },
  };
}

/** This page's URL for a page number, the filters kept. */
function pageUrl(filters: ReturnType<typeof filtersOf>, page: number) {
  const params = new URLSearchParams();
  if (filters.day !== null) params.set("dia", filters.day);
  if (filters.state !== null) params.set("estado", filters.state);
  if (filters.customerId !== null) params.set("cliente", filters.customerId);
  if (page > 1) params.set("pagina", String(page));
  const query = params.toString();
  return query === "" ? "/cuentas" : `/cuentas?${query}`;
}

const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg";
const pageLink = "rounded-xl border border-stone-300 bg-white px-4 py-3 font-medium";

export default function Cuentas({ loaderData }: Route.ComponentProps) {
  const { day, state, customerId, page, hasMore, bills, customer } = loaderData;
  const filtered = day !== null || state !== null || customerId !== null;
  const filtering = useNavigation().state !== "idle";

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Cuentas</h1>

      <Form method="get" className="mt-4 flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4">
        <label htmlFor="dia" className="font-medium">
          Día
        </label>
        <input id="dia" type="date" name="dia" defaultValue={day ?? ""} className={field} />

        <label htmlFor="estado" className="font-medium">
          Estado
        </label>
        <select id="estado" name="estado" defaultValue={state ?? ""} className={field}>
          <option value="">Todos los estados</option>
          {BILL_STATES.map((known) => (
            <option key={known} value={known}>
              {billStateLabel[known]}
            </option>
          ))}
        </select>

        <CustomerPicker name="cliente" defaultValue={customer} label="Cliente" />

        <div className="flex items-center gap-3">
          <button type="submit" disabled={filtering} className="rounded-xl bg-stone-900 px-4 py-3 font-semibold text-white disabled:opacity-60">
            {filtering ? "Filtrando…" : "Filtrar"}
          </button>
          {filtered ? (
            <Link to="/cuentas" className="text-stone-600 underline">
              Limpiar
            </Link>
          ) : null}
        </div>
      </Form>

      {bills.length === 0 ? (
        <p className="mt-4 text-stone-600">
          {filtered ? "No hay cuentas con esos filtros." : "No hay cuentas todavía."}
        </p>
      ) : (
        <ul aria-label="Cuentas" className="mt-4 flex flex-col gap-2">
          {bills.map((bill) => (
            <li key={bill.id} data-bill-id={bill.id}>
              <Link
                to={`/cuentas/${bill.id}`}
                className="block rounded-2xl border border-stone-300 bg-white p-4 active:bg-stone-100"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-lg font-medium">
                      {bill.customer?.name ?? bill.note ?? "Sin cliente"}
                    </span>
                    <span className="block text-stone-600">{formatDay(bill.day)}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-stone-100 px-3 py-1 text-sm font-medium">
                    {billStateLabel[bill.state]}
                  </span>
                </span>
                <span className="mt-2 block tabular-nums text-stone-700">
                  {bill.state === "voided"
                    ? `Total ${formatMoney(bill.total)} · Pagado ${formatMoney(bill.paid)}`
                    : `Total ${formatMoney(bill.total)} · Pagado ${formatMoney(bill.paid)} · Debe ${formatMoney(
                        bill.owed,
                      )}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {page > 1 || hasMore ? (
        <nav aria-label="Páginas" className="mt-4 flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link to={pageUrl({ day, state, customerId, page }, page - 1)} className={pageLink}>
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <span aria-current="page" className="text-stone-600">{`Página ${page}`}</span>
          {hasMore ? (
            <Link to={pageUrl({ day, state, customerId, page }, page + 1)} className={pageLink}>
              Siguiente
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}
