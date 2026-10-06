import { Effect } from "effect";
import { Link } from "react-router";

import { getBill } from "~/backend/bills";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";
import { billStateLabel, isOpenBill } from "~/shared/bill-state";
import { formatDay, formatTime } from "~/shared/day";
import { formatMoney } from "~/shared/money";

import type { Route } from "./+types/bill";

// Cuenta (spec §6.1): one Bill with its Lines, who added each and when, its
// state and what it owes. **Agregar productos** opens Vender targeting this
// Bill, so any User can add Lines to any Open Bill. Payments (ticket 08),
// Customer and note edits (10) and corrections (11) join here later.

export const meta: Route.MetaFunction = () => [{ title: "Cuenta · Gamo Cafe" }];

export async function loader({ context, params }: Route.LoaderArgs) {
  const user = requireUser(context);
  const bill = await run(
    context,
    getBill(params.billId).pipe(Effect.provideService(CurrentUser, user)),
    (error) => {
      switch (error._tag) {
        case "BillNotFound":
          throw new Response(null, { status: 404 });
        case "BillNotVisible":
          throw new Response(null, { status: 403 });
      }
    },
  );
  return { bill, canAddItems: isOpenBill(bill.state) };
}

const primaryButton =
  "block rounded-2xl bg-stone-900 px-4 py-4 text-center text-lg font-semibold text-white active:bg-stone-700";

export default function Bill({ loaderData }: Route.ComponentProps) {
  const { bill, canAddItems } = loaderData;

  return (
    <>
      <Link to="/cuentas-abiertas" className="text-stone-600 underline">
        Cuentas abiertas
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Cuenta</h1>
        <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-medium">{billStateLabel[bill.state]}</span>
      </div>

      <p className="mt-2 text-lg">
        {bill.customer ? (
          <Link to={`/clientes/${bill.customer.id}`} className="underline">
            {bill.customer.name}
          </Link>
        ) : (
          (bill.note ?? "Sin cliente")
        )}
      </p>
      {bill.customer && bill.note ? <p className="mt-1 text-stone-600">{bill.note}</p> : null}
      <p className="mt-1 text-stone-600">{formatDay(bill.day)}</p>

      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-stone-200 bg-white p-4 text-center">
        <div>
          <dt className="text-sm text-stone-600">Total</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatMoney(bill.total)}</dd>
        </div>
        <div>
          <dt className="text-sm text-stone-600">Pagado</dt>
          <dd className="text-lg tabular-nums">{formatMoney(bill.paid)}</dd>
        </div>
        <div>
          <dt className="text-sm text-stone-600">Debe</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatMoney(bill.owed)}</dd>
        </div>
      </dl>

      {canAddItems ? (
        <Link to={`/?billId=${bill.id}`} className={`mt-4 ${primaryButton}`}>
          Agregar productos
        </Link>
      ) : null}

      <section aria-labelledby="productos" className="mt-6">
        <h2 id="productos" className="text-xl font-semibold">
          Productos
        </h2>
        {bill.lines.length === 0 ? (
          <p className="mt-3 text-stone-600">Esta cuenta no tiene productos.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white px-4">
            {bill.lines.map((line) => (
              <li key={line.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 font-medium">{`${line.quantity} × ${line.itemName}`}</span>
                  <span className="shrink-0 tabular-nums">{formatMoney(line.unitPrice * line.quantity)}</span>
                </div>
                <p className="text-sm text-stone-600">{`${formatMoney(line.unitPrice)} c/u`}</p>
                <p className="text-stone-600">
                  {line.day === bill.day
                    ? `${line.byName} · ${formatTime(line.at)}`
                    : `${line.byName} · ${formatDay(line.day)} ${formatTime(line.at)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
