import { Effect } from "effect";
import { data, Form, Link, redirect, useLocation, useNavigation, useSubmit } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { addCustomer, SEARCH_LIMIT, searchCustomers } from "~/backend/customers";
import { run } from "~/backend/run.server";
import { ChevronDrawing } from "~/components/icons";
import { Notice } from "~/components/notice";
import { hint, pageTitle, rowCard, sectionTitle } from "~/components/styles";
import { SubmitButton } from "~/components/submit-button";
import { Badge } from "~/components/ui/badge";
import { buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { SearchInput } from "~/components/search-input";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { requireUser } from "~/session.server";
import { customerNameMessages } from "~/shared/customer-messages";
import { useListReturn } from "~/shared/list-return";
import { normalizeName } from "~/shared/normalize-name";

import type { Route } from "./+types/customers";

export const meta: Route.MetaFunction = () => [{ title: "Clientes · Gamo Cafe" }];

// Clientes (spec §6.1, UI redesign §7): search as a name is typed, then open
// a Customer or add the name as a new one. The matches come before the form
// that adds, so a name that is already there is seen before it is typed twice;
// a name an active Customer has is not offered at all (spec §5.2). Retired
// Customers are listed, marked, because their page is where their Open Bills
// are collected and where an Admin restores them. The search is in the
// address, so coming back from a Customer finds it as it was.

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
    // An active Customer already has the typed name, ignoring case and accents.
    taken,
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

export default function Customers({ loaderData, actionData }: Route.ComponentProps) {
  const { typed, customers, more, taken, canAdd } = loaderData;
  const submit = useSubmit();
  const navigation = useNavigation();
  // For the way back from a Customer that this list is no longer right behind.
  useListReturn("/clientes", useLocation().search);
  // The matches are a round trip away; say so at once, so no tap looks lost.
  const searching = navigation.state !== "idle" && navigation.formMethod === "GET";

  return (
    <div className="flex flex-col gap-5">
      <h1 className={pageTitle}>Clientes</h1>

      <Form
        method="get"
        role="search"
        className="flex flex-col gap-2"
        onChange={(event) => submit(event.currentTarget, { replace: true, preventScrollReset: true })}
      >
        <Label htmlFor="q">Buscar o agregar</Label>
        <SearchInput
          id="q"
          name="q"
          defaultValue={typed}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={80}
          aria-describedby="q-hint"
        />
        <p id="q-hint" className={hint}>
          Escribe el nombre. Si no está, lo puedes agregar.
        </p>
        {/* Its room is kept, so the list does not move when it speaks. */}
        <p aria-live="polite" className={`min-h-7 ${hint}`}>
          {searching ? "Buscando…" : ""}
        </p>
      </Form>

      {customers.length > 0 ? (
        <ul aria-label="Clientes" className="flex flex-col gap-3">
          {customers.map((customer) => (
            <li key={customer.id}>
              {/* The Customer's page goes back to this entry, not on to a new list. */}
              <Link to={`/clientes/${customer.id}`} state={{ fromList: "/clientes" }} className="block rounded-2xl">
                <Card size="sm" className={rowCard}>
                  <CardContent className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="min-w-0 text-xl font-semibold wrap-break-word">{customer.name}</span>
                        {customer.retired ? <Badge variant="secondary">Retirado</Badge> : null}
                      </span>
                      {customer.note ? <span className={`${hint} wrap-break-word`}>{customer.note}</span> : null}
                    </span>
                    <ChevronDrawing className="size-5 shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={hint}>
          {typed
            ? `Ningún cliente empieza con «${typed}».`
            : "Todavía no hay clientes. Escribe un nombre para agregar el primero."}
        </p>
      )}
      {more ? <p className={hint}>Hay más. Escribe más letras para encontrarlos.</p> : null}

      {taken ? <p>Ya hay un cliente con ese nombre: está en la lista.</p> : null}
      {canAdd ? (
        <section aria-labelledby="agregar" className="flex flex-col gap-4 border-t pt-5">
          <h2 id="agregar" className={sectionTitle}>
            Agregar cliente nuevo
          </h2>
          {customers.length > 0 ? <p>Si es uno de la lista, ábrelo ahí. Si no, agrégalo.</p> : null}
          {/* Keyed by the name, so a note typed for one name is not kept for another. */}
          <Form key={typed} method="post" className="flex flex-col gap-4">
            <input type="hidden" name="name" value={typed} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="note">Nota para «{typed}» (opcional)</Label>
              <Input
                id="note"
                name="note"
                autoComplete="off"
                maxLength={200}
                aria-describedby={actionData?.error ? "agregar-error" : undefined}
              />
            </div>
            {actionData?.error ? (
              <Notice tone="error" id="agregar-error">
                {actionData.error}
              </Notice>
            ) : null}
            <SubmitButton pendingLabel="Agregando…" className={buttonClasses({ size: "touch" })}>
              {`Agregar «${typed}»`}
            </SubmitButton>
          </Form>
        </section>
      ) : actionData?.error ? (
        <Notice tone="error">{actionData.error}</Notice>
      ) : null}
    </div>
  );
}
