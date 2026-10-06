import { Form, Link, useNavigation, useSubmit } from "react-router";

import { listOpenBills } from "~/backend/bills";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";
import { billStateLabel } from "~/shared/bill-state";
import { formatDay } from "~/shared/day";
import { formatMoney } from "~/shared/money";

import type { Route } from "./+types/open-bills";

// Cuentas abiertas (spec §6.1): every Open Bill, newest first, with its
// Customer or note, Day, total, paid and owed, and a search by Customer. One
// index-driven read, so it stays cheap with 200 Open Bills (ticket 07).

export const meta: Route.MetaFunction = () => [{ title: "Cuentas abiertas · Gamo Cafe" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  requireUser(context);
  const typed = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const bills = await run(context, listOpenBills(typed));
  return { typed, bills };
}

const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg";

export default function OpenBills({ loaderData }: Route.ComponentProps) {
  const { typed, bills } = loaderData;
  const submit = useSubmit();
  // The results are a round trip away; say so at once, so no tap looks lost.
  const searching = useNavigation().state !== "idle";

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Cuentas abiertas</h1>

      <Form
        method="get"
        role="search"
        className="mt-4"
        onChange={(event) => submit(event.currentTarget, { replace: true, preventScrollReset: true })}
      >
        <label htmlFor="q" className="text-lg font-medium">
          Buscar por cliente
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={typed}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={80}
          placeholder="Nombre del cliente"
          className={`${field} mt-2`}
        />
        <p aria-live="polite" className="mt-1 h-5 text-sm text-stone-600">
          {searching ? "Buscando…" : ""}
        </p>
      </Form>

      {bills.length === 0 ? (
        <p className="mt-4 text-stone-600">
          {typed
            ? `Ninguna cuenta abierta es de un cliente que empiece con «${typed}».`
            : "No hay cuentas abiertas."}
        </p>
      ) : (
        <ul aria-label="Cuentas abiertas" className="mt-4 flex flex-col gap-2">
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
                  {`Total ${formatMoney(bill.total)} · Pagado ${formatMoney(bill.paid)} · Debe ${formatMoney(bill.owed)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
