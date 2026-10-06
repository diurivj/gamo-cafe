import { Effect, Result, Schema } from "effect";
import { data, Form, Link, useNavigation } from "react-router";

import {
  type ExpectedBillRevision,
  listCustomerHandovers,
  listCustomerOpenBills,
  listCustomerPastBills,
  takeCustomerPayment,
} from "~/backend/bills";
import { CurrentUser } from "~/backend/current-user";
import { editCustomer, getCustomer, restoreCustomer, retireCustomer } from "~/backend/customers";
import { run } from "~/backend/run.server";
import { PaymentFields } from "~/components/payment-fields";
import { requireUser } from "~/session.server";
import { billStateLabel } from "~/shared/bill-state";
import { customerNameMessages } from "~/shared/customer-messages";
import { dayOf, formatDay, formatTime } from "~/shared/day";
import { newId } from "~/shared/id";
import { type Centavos, formatMoney, parsePesos } from "~/shared/money";
import { PAYMENT_METHODS, paymentMethodLabel } from "~/shared/payment";
import { paymentMessages } from "~/shared/payment-messages";
import { pageFrom, pageUrl } from "~/shared/page";

import type { Route } from "./+types/customer";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.customer.name ?? "Cliente"} · Gamo Cafe` },
];

/**
 * One Customer: their Open Bills and what they owe, with **Abonar** to pay
 * across them (spec §6.1 Clientes, §8.3). Every User sees and collects; an
 * Admin also renames, retires, restores and sees the Customer's past Bills —
 * Pagadas and Canceladas, 50 per page — which a Worker is never sent
 * (spec §4.1, §4.2). `canManage` only decides what the page offers: the
 * operations refuse a Worker themselves.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const user = requireUser(context);
  const { customer, openBills, handovers } = await run(
    context,
    Effect.gen(function* () {
      const customer = yield* getCustomer(params.customerId);
      const openBills = yield* listCustomerOpenBills(params.customerId);
      const handovers = yield* listCustomerHandovers(params.customerId);
      return { customer, openBills, handovers };
    }),
    (error) => {
      switch (error._tag) {
        case "CustomerNotFound":
          throw data(null, { status: 404 });
      }
    },
  );
  const owed = openBills.reduce((sum, bill) => sum + bill.owed, 0);
  const page = pageFrom(new URL(request.url).searchParams.get("pagina"));
  const pastBills =
    user.role === "admin"
      ? await run(
          context,
          listCustomerPastBills(params.customerId, page).pipe(Effect.provideService(CurrentUser, user)),
          (error) => {
            switch (error._tag) {
              case "AdminOnly":
                throw data(null, { status: 403 });
            }
          },
        )
      : null;
  return {
    customer,
    openBills,
    owed,
    handovers,
    canManage: user.role === "admin",
    pastBills,
    page,
  };
}

/** The intents the Customer page's forms ask for. */
const INTENTS = ["edit", "retire", "restore", "abonar"] as const;

/** The Bills as the page showed them: `billId:revision`, one form field each. */
function billRevisions(form: FormData): Array<ExpectedBillRevision> | string {
  const revisions: Array<ExpectedBillRevision> = [];
  for (const value of form.getAll("bill")) {
    const [billId, revision] = String(value).split(":");
    const parsed = Number(revision);
    if (!billId || !Number.isSafeInteger(parsed)) return "Recarga la página e intenta de nuevo.";
    revisions.push({ billId, revision: parsed });
  }
  return revisions;
}

/**
 * The operation a submitted form asks for, as one program so that `run` sees
 * the union of every operation's errors. A form whose fields cannot be read
 * comes back as `{ error }`, answered 400 by the action.
 */
function programFor(id: string, form: FormData) {
  return Effect.gen(function* () {
    const intent = String(form.get("intent") ?? "");
    switch (intent) {
      case "edit":
        yield* editCustomer(id, { name: String(form.get("name") ?? ""), note: String(form.get("note") ?? "") });
        return { recorded: null };
      case "retire":
        yield* retireCustomer(id);
        return { recorded: null };
      case "restore":
        yield* restoreCustomer(id);
        return { recorded: null };
      case "abonar": {
        const method = Schema.decodeUnknownResult(Schema.Literals(PAYMENT_METHODS))(
          String(form.get("method") ?? ""),
        );
        if (!Result.isSuccess(method)) return { error: paymentMessages.MethodMissing };

        // An empty amount is everything the Customer owes (spec §5.5).
        const typed = String(form.get("amount") ?? "").trim();
        let amount: Centavos | null = null;
        if (typed !== "") {
          const parsed = parsePesos(typed);
          if (parsed === undefined) return { error: paymentMessages.InvalidAmount };
          amount = parsed;
        }

        const revisions = billRevisions(form);
        if (typeof revisions === "string") return { error: revisions };

        const recorded = yield* takeCustomerPayment({
          customerId: id,
          amount,
          method: method.success,
          expectedRevisions: revisions,
        });
        return { recorded: { amount: recorded.amount } };
      }
      default:
        throw data(null, { status: 400 });
    }
  });
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();
  const id = params.customerId;

  const intent = String(form.get("intent") ?? "");
  if (!INTENTS.some((known) => known === intent)) throw data(null, { status: 400 });

  const outcome = await run(context, programFor(id, form).pipe(Effect.provideService(CurrentUser, user)), (error) => {
    switch (error._tag) {
      case "AdminOnly":
        throw data({ error: "Solo un administrador puede cambiar a un cliente." }, { status: 403 });
      case "CustomerNotFound":
        throw data(null, { status: 404 });
      case "CustomerNameRequired":
        return { error: customerNameMessages.CustomerNameRequired };
      case "CustomerNameTaken":
        return {
          error:
            intent === "restore"
              ? "Otro cliente activo ya usa este nombre. Cambia uno de los dos nombres antes de restaurar."
              : customerNameMessages.CustomerNameTaken,
        };
      case "PaymentNotPositive":
        return { error: paymentMessages.CustomerPaymentNotPositive };
      case "PaymentExceedsOwed":
        return { error: paymentMessages.CustomerPaymentExceedsOwed };
      case "CustomerBillsChanged":
        return { error: paymentMessages.CustomerBillsChanged };
    }
  });

  if ("error" in outcome) return data(outcome, { status: 400 });
  if (outcome.recorded) return { recorded: { amount: outcome.recorded.amount }, error: null };
  return { recorded: null, error: null };
}

const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg";
const secondaryButton = "rounded-xl border border-stone-300 bg-white px-4 py-4 text-lg font-medium disabled:opacity-60";
const primaryButton =
  "block rounded-2xl bg-stone-900 px-4 py-4 text-center text-lg font-semibold text-white active:bg-stone-700 disabled:opacity-60";

export default function Customer({ loaderData, actionData }: Route.ComponentProps) {
  const { customer, openBills, owed, handovers, canManage, pastBills, page } = loaderData;
  const busy = useNavigation().state !== "idle";
  const retired = customer.retiredAt !== null;
  const recordedAmount =
    actionData && "recorded" in actionData && actionData.recorded != null ? actionData.recorded.amount : undefined;

  return (
    <>
      <Link to="/clientes" className="text-stone-600 underline">
        Clientes
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{customer.name}</h1>
        {retired ? <span className="rounded-full bg-stone-200 px-3 py-1 text-sm text-stone-700">Retirado</span> : null}
      </div>
      {customer.note ? <p className="mt-2 text-lg">{customer.note}</p> : null}
      <p className="mt-2 text-stone-600">
        Lo agregó {customer.addedBy.name} el {formatDay(dayOf(customer.addedAt))} a las {formatTime(customer.addedAt)}.
      </p>
      {retired ? (
        <>
          <p className="mt-2 text-stone-600">Ya no se puede elegir para cuentas nuevas.</p>
          <p className="mt-1 text-stone-600">Sus cuentas abiertas se cobran igual.</p>
        </>
      ) : null}

      {actionData && "error" in actionData && actionData.error ? (
        <p role="alert" className="mt-4 text-red-700">
          {actionData.error}
        </p>
      ) : null}
      {recordedAmount !== undefined ? (
        <p role="status" className="mt-4 rounded-xl bg-green-50 p-3">
          {`Abono de ${formatMoney(recordedAmount)} registrado.`}
        </p>
      ) : null}

      <section aria-labelledby="cuentas-abiertas" className="mt-6">
        <h2 id="cuentas-abiertas" className="text-xl font-semibold">
          Cuentas abiertas
        </h2>
        {openBills.length === 0 ? (
          <p className="mt-3 text-stone-600">No debe nada.</p>
        ) : (
          <>
            <p className="mt-3 text-lg font-medium tabular-nums">
              {`Debe ${formatMoney(owed)} en ${openBills.length} ${openBills.length === 1 ? "cuenta" : "cuentas"}.`}
            </p>
            <ul aria-label="Cuentas abiertas" className="mt-3 flex flex-col gap-2">
              {openBills.map((bill) => (
                <li key={bill.id}>
                  <Link
                    to={`/cuentas/${bill.id}`}
                    className="block rounded-2xl border border-stone-300 bg-white p-4 active:bg-stone-100"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="block text-stone-600">{formatDay(bill.day)}</span>
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
          </>
        )}
      </section>

      {owed > 0 ? (
        <section
          aria-labelledby="abonar"
          className="mt-6 flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-4"
        >
          <h2 id="abonar" className="text-xl font-semibold">
            Abonar
          </h2>
          {/* Keyed by what is owed: after an Abonar the field starts again at
              what is left, and the form carries the fresh revisions. */}
          <Form key={owed} method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="abonar" />
            {openBills.map((bill) => (
              <input key={bill.id} type="hidden" name="bill" value={`${bill.id}:${bill.revision}`} />
            ))}
            <PaymentFields
              defaultAmount={owed}
              initialAmount={formatMoney(owed)}
              amountHint="Ya viene todo lo que debe. Puedes abonar menos."
            />
            <button type="submit" disabled={busy} className={primaryButton}>
              Abonar
            </button>
          </Form>
        </section>
      ) : null}

      <section aria-labelledby="abonos" className="mt-6">
        <h2 id="abonos" className="text-xl font-semibold">
          Abonos
        </h2>
        {handovers.length === 0 ? (
          <p className="mt-3 text-stone-600">Todavía no hay abonos.</p>
        ) : (
          <ul
            aria-label="Abonos"
            className="mt-3 flex flex-col divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white px-4"
          >
            {handovers.map((event) => (
              <li key={event.reference ?? event.id} data-handover-event={event.reference ?? "uno"} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{paymentMethodLabel[event.method]}</span>
                  <span className="shrink-0 tabular-nums">{formatMoney(event.amount)}</span>
                </div>
                <p className="text-stone-600">{`${event.byName} · ${formatDay(event.day)} ${formatTime(event.at)}`}</p>
                {event.billCount > 1 ? <p className="text-stone-600">{`${event.billCount} cuentas`}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {pastBills ? (
        <section aria-labelledby="cuentas-pasadas" className="mt-6">
          <h2 id="cuentas-pasadas" className="text-xl font-semibold">
            Cuentas pasadas
          </h2>
          {pastBills.bills.length === 0 ? (
            <p className="mt-3 text-stone-600">Todavía no hay cuentas pasadas.</p>
          ) : (
            <>
              <ul aria-label="Cuentas pasadas" className="mt-3 flex flex-col gap-2">
                {pastBills.bills.map((bill) => (
                  <li key={bill.id} data-past-bill-id={bill.id}>
                    <Link
                      to={`/cuentas/${bill.id}`}
                      className="block rounded-2xl border border-stone-300 bg-white p-4 active:bg-stone-100"
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="block text-stone-600">{formatDay(bill.day)}</span>
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
              {page > 1 || pastBills.hasMore ? (
                <nav aria-label="Páginas de cuentas pasadas" className="mt-4 flex items-center justify-between gap-3">
                  {page > 1 ? (
                    <Link to={pageUrl(`/clientes/${customer.id}`, page - 1)} className={secondaryButton}>
                      Anterior
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span aria-current="page" className="text-stone-600">{`Página ${page}`}</span>
                  {pastBills.hasMore ? (
                    <Link to={pageUrl(`/clientes/${customer.id}`, page + 1)} className={secondaryButton}>
                      Siguiente
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {canManage ? (
        <section aria-label="Administrar cliente" className="mt-6 flex flex-col gap-4 border-t border-stone-200 pt-4">
          {/* Keyed by what is stored, so the fields show it after saving. */}
          <Form key={`${customer.name}\n${customer.note}`} method="post" className="flex flex-col gap-3">
            <label htmlFor="name" className="font-medium">
              Nombre
            </label>
            <input
              id="name"
              name="name"
              required
              defaultValue={customer.name}
              autoComplete="off"
              maxLength={80}
              className={field}
            />
            <label htmlFor="note" className="font-medium">
              Nota (opcional)
            </label>
            <input
              id="note"
              name="note"
              defaultValue={customer.note ?? ""}
              autoComplete="off"
              maxLength={200}
              className={field}
            />
            <button
              type="submit"
              name="intent"
              value="edit"
              disabled={busy}
              className="rounded-xl bg-stone-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
            >
              Guardar
            </button>
          </Form>

          <Form method="post" className="flex flex-col">
            {retired ? (
              <button type="submit" name="intent" value="restore" disabled={busy} className={secondaryButton}>
                Restaurar cliente
              </button>
            ) : (
              <button type="submit" name="intent" value="retire" disabled={busy} className={secondaryButton}>
                Retirar cliente
              </button>
            )}
          </Form>
        </section>
      ) : null}
    </>
  );
}
