import { Effect } from "effect";
import { data, Form, Link, redirect, useNavigation, useSubmit } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { addCustomer, SEARCH_LIMIT, searchCustomers } from "~/backend/customers";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";
import { customerNameMessages } from "~/shared/customer-messages";
import { normalizeName } from "~/shared/normalize-name";
import { SubmitButton } from "~/components/submit-button";

import type { Route } from "./+types/customers";

export const meta: Route.MetaFunction = () => [{ title: "Clientes · Gamo Cafe" }];

/**
 * Clientes: search as a name is typed, then open a Customer or add the name
 * as a new one. Retired Customers are listed, marked, because their page is
 * where their Open Bills are collected and where an Admin restores them.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  requireUser(context);
  const typed = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const customers = await run(context, searchCustomers(typed, { includeRetired: true }));

  const normalized = normalizeName(typed);
  const taken = customers.some(
    (customer) => customer.retiredAt === null && normalizeName(customer.name) === normalized,
  );
  return {
    typed,
    customers: customers.map(({ id, name, note, retiredAt }) => ({ id, name, note, retired: retiredAt !== null })),
    more: customers.length === SEARCH_LIMIT,
    // The typed name can be added: it says something and no active Customer has it.
    canAdd: normalized !== "" && !taken,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();
  const program = addCustomer({
    name: String(form.get("name") ?? ""),
    note: String(form.get("note") ?? ""),
  }).pipe(Effect.provideService(CurrentUser, user));

  const result = await run(context, program, (error) => ({ error: customerNameMessages[error._tag] }));
  if ("error" in result) return data(result, { status: 400 });
  throw redirect(`/clientes/${result.id}`);
}

const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg";

export default function Customers({ loaderData, actionData }: Route.ComponentProps) {
  const { typed, customers, more, canAdd } = loaderData;
  const submit = useSubmit();
  const navigation = useNavigation();
  // The matches are a round trip away; say so at once, so no tap looks lost.
  const searching = navigation.state !== "idle" && navigation.formMethod === "GET";

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Clientes</h1>

      <Form
        method="get"
        role="search"
        className="mt-4"
        onChange={(event) => submit(event.currentTarget, { replace: true, preventScrollReset: true })}
      >
        <label htmlFor="q" className="text-lg font-medium">
          Buscar o agregar
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

      {actionData?.error ? (
        <p role="alert" className="mt-3 text-red-700">
          {actionData.error}
        </p>
      ) : null}

      {customers.length > 0 ? (
        <ul aria-label="Clientes" className="mt-4 flex flex-col gap-2">
          {customers.map((customer) => (
            <li key={customer.id}>
              <Link
                to={`/clientes/${customer.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-stone-300 bg-white px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-lg font-medium">{customer.name}</span>
                  {customer.note ? <span className="block truncate text-stone-600">{customer.note}</span> : null}
                </span>
                {customer.retired ? (
                  <span className="shrink-0 rounded-full bg-stone-200 px-3 py-1 text-sm text-stone-700">Retirado</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-stone-600">
          {typed ? `Ningún cliente empieza con «${typed}».` : "Todavía no hay clientes. Escribe un nombre para agregar el primero."}
        </p>
      )}
      {more ? <p className="mt-2 text-stone-600">Hay más. Escribe más letras para encontrarlos.</p> : null}

      {canAdd ? (
        // Keyed by the name, so a note typed for one name is not kept for another.
        <Form key={typed} method="post" className="mt-6 flex flex-col gap-3 border-t border-stone-200 pt-4">
          <input type="hidden" name="name" value={typed} />
          <label htmlFor="note" className="font-medium">
            Nota para «{typed}» (opcional)
          </label>
          <input id="note" name="note" autoComplete="off" maxLength={200} className={field} />
          <SubmitButton
            pendingLabel="Agregando…"
            className="rounded-xl bg-stone-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
          >
            {`Agregar «${typed}»`}
          </SubmitButton>
        </Form>
      ) : null}
    </>
  );
}
