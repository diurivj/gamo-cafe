import { Effect } from "effect";
import { data, Form, Link, useNavigation } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { editCustomer, getCustomer, restoreCustomer, retireCustomer } from "~/backend/customers";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";
import { customerNameMessages } from "~/shared/customer-messages";
import { dayOf, formatDay, formatTime } from "~/shared/day";

import type { Route } from "./+types/customer";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.customer.name ?? "Cliente"} · Gamo Cafe` },
];

/**
 * One Customer. Every User sees who they are; an Admin also renames, retires
 * and restores (spec §4.1). `canManage` only decides what the page offers:
 * the operations refuse a Worker themselves.
 */
export async function loader({ context, params }: Route.LoaderArgs) {
  const user = requireUser(context);
  const customer = await run(context, getCustomer(params.customerId), (error) => {
    switch (error._tag) {
      case "CustomerNotFound":
        throw data(null, { status: 404 });
    }
  });
  return { customer, canManage: user.role === "admin" };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();
  const id = params.customerId;

  const intent = String(form.get("intent") ?? "");
  let program;
  switch (intent) {
    case "edit":
      program = editCustomer(id, { name: String(form.get("name") ?? ""), note: String(form.get("note") ?? "") });
      break;
    case "retire":
      program = retireCustomer(id);
      break;
    case "restore":
      program = restoreCustomer(id);
      break;
    default:
      throw data(null, { status: 400 });
  }

  const refusal = await run(context, program.pipe(Effect.provideService(CurrentUser, user)), (error) => {
    switch (error._tag) {
      case "AdminOnly":
        return data({ error: "Solo un administrador puede cambiar a un cliente." }, { status: 403 });
      case "CustomerNotFound":
        throw data(null, { status: 404 });
      case "CustomerNameRequired":
        return data({ error: customerNameMessages.CustomerNameRequired }, { status: 400 });
      case "CustomerNameTaken":
        return data(
          {
            error:
              intent === "restore"
                ? "Otro cliente activo ya usa este nombre. Cambia uno de los dos nombres antes de restaurar."
                : customerNameMessages.CustomerNameTaken,
          },
          { status: 400 },
        );
    }
  });
  return refusal ?? { error: null };
}

const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg";
const secondaryButton = "rounded-xl border border-stone-300 bg-white px-4 py-4 text-lg font-medium disabled:opacity-60";

export default function Customer({ loaderData, actionData }: Route.ComponentProps) {
  const { customer, canManage } = loaderData;
  const busy = useNavigation().state !== "idle";
  const retired = customer.retiredAt !== null;

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
        <p className="mt-2 text-stone-600">Ya no se puede elegir para cuentas nuevas.</p>
      ) : null}

      {actionData?.error ? (
        <p role="alert" className="mt-4 text-red-700">
          {actionData.error}
        </p>
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
