import { useEffect, useState } from "react";
import { data, Form, useNavigation } from "react-router";
import { Effect, Result, Schema } from "effect";

import {
  type BillNotFound,
  type BillNotOpen,
  type BillSummary,
  type CustomerUnavailable,
  type EmptySelection,
  type InvalidQuantity,
  type ItemUnavailable,
  type NewSelection,
  type NoteTooLong,
  recordSelection,
  type TargetConflict,
} from "~/backend/bills";
import { activeItemsByCategory } from "~/backend/catalog";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { CustomerPicker } from "~/components/customer-picker";
import { requireUser } from "~/session.server";
import { newId } from "~/shared/id";
import { formatMoney } from "~/shared/money";

import type { Route } from "./+types/home";

// Vender (spec §6.1): the Items as large buttons by Category, a selection the
// browser holds until it is recorded, a Customer or a note, and **Dejar
// abierta**. Cobrar joins in ticket 08.

export const meta: Route.MetaFunction = () => [{ title: "Vender · Gamo Cafe" }];

export async function loader({ context }: Route.LoaderArgs) {
  requireUser(context);
  const categories = await run(context, activeItemsByCategory);
  return { categories };
}

/** The selection as the browser sends it, in the `selection` form field. */
const SelectionField = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ itemId: Schema.String, quantity: Schema.Int })),
);

/** The Vender form's fields as `recordSelection` takes them. */
function readSelection(form: FormData): NewSelection | { readonly error: string } {
  const parsed = Schema.decodeUnknownResult(SelectionField)(String(form.get("selection") ?? ""));
  if (!Result.isSuccess(parsed)) return { error: "No pudimos leer la selección. Recarga la página." };
  return {
    items: parsed.success,
    customerId: String(form.get("customerId") ?? "") || null,
    note: String(form.get("note") ?? "") || null,
    billId: String(form.get("billId") ?? "") || null,
  };
}

type SelectionError =
  | BillNotFound
  | BillNotOpen
  | CustomerUnavailable
  | EmptySelection
  | InvalidQuantity
  | ItemUnavailable
  | NoteTooLong
  | TargetConflict;

/** What each rule violation of `recordSelection` answers, in Spanish. */
function answerSelectionError(error: SelectionError): { readonly error: string } {
  switch (error._tag) {
    case "BillNotFound":
      throw new Response(null, { status: 404 });
    case "EmptySelection":
      return { error: "Agrega al menos un producto." };
    case "InvalidQuantity":
      return { error: "Las cantidades deben ser números enteros mayores a cero." };
    case "NoteTooLong":
      return { error: "La nota no puede pasar de 80 caracteres." };
    case "ItemUnavailable":
      return { error: "Un producto de la selección ya no está disponible. Quítalo y vuelve a intentar." };
    case "CustomerUnavailable":
      return { error: "Ese cliente no existe o está retirado." };
    case "TargetConflict":
      return { error: "No se puede elegir cliente ni nota al agregar a una cuenta abierta." };
    case "BillNotOpen":
      return { error: "Esta cuenta ya no está abierta. Registra los productos en una cuenta nueva." };
  }
}

export async function action({ context, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();
  if (String(form.get("intent") ?? "") !== "dejar-abierta") {
    return data({ error: "No entendimos esa acción. Recarga la página e intenta de nuevo." }, { status: 400 });
  }

  const selection = readSelection(form);
  if ("error" in selection) return data(selection, { status: 400 });

  const program = recordSelection(selection).pipe(Effect.provideService(CurrentUser, user));
  const result = await run(context, program, answerSelectionError);
  if ("error" in result) return data(result, { status: 400 });
  // `done` is new on every success: the page uses it to empty the selection.
  return { done: newId(), bill: result };
}

const tile =
  "flex min-h-20 flex-col justify-between gap-2 rounded-2xl border border-stone-300 bg-white p-4 text-left active:bg-stone-100 disabled:opacity-60";
const step = "h-10 w-10 shrink-0 rounded-full border border-stone-300 bg-white text-xl font-semibold";
const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg";
const quietButton = "rounded-xl border border-stone-300 bg-white px-4 py-2 font-medium disabled:opacity-60";
const primaryButton = "rounded-2xl bg-stone-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60";

/** What the screen says after a selection was recorded and left Open. */
const recordedMessage = (bill: BillSummary) =>
  `Se dejó abierta ${bill.customer ? `la cuenta de ${bill.customer.name}` : "una cuenta"} por ${formatMoney(bill.total)}.`;

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const { categories } = loaderData;
  const busy = useNavigation().state !== "idle";
  const [quantities, setQuantities] = useState<Readonly<Record<string, number>>>({});
  // A new key remounts the form after a recorded selection, so the picker and
  // the note start over; the key holds after a refusal, which keeps them.
  const [formKey, setFormKey] = useState("nueva");

  const recorded = actionData && "done" in actionData ? actionData.done : undefined;
  useEffect(() => {
    if (!recorded) return;
    setQuantities({});
    setFormKey(recorded);
  }, [recorded]);

  const items = categories.flatMap((category) => category.items);
  const selected = items.filter((item) => (quantities[item.id] ?? 0) > 0);
  const total = selected.reduce((sum, item) => sum + item.price * quantities[item.id]!, 0);

  function change(itemId: string, by: number) {
    setQuantities((current) => {
      const next = { ...current };
      const quantity = (next[itemId] ?? 0) + by;
      if (quantity > 0) next[itemId] = quantity;
      else delete next[itemId];
      return next;
    });
  }

  const selection = JSON.stringify(selected.map((item) => ({ itemId: item.id, quantity: quantities[item.id] })));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Vender</h1>

      {items.length === 0 ? (
        <p className="text-lg text-stone-600">
          Todavía no hay productos. Pídele a un administrador que agregue el menú.
        </p>
      ) : null}

      {/* `?index` aims the POST at this index route's action, not the layout's. */}
      <Form method="post" action="?index" key={formKey} className="flex flex-col gap-6">
        <input type="hidden" name="intent" value="dejar-abierta" />
        <input type="hidden" name="selection" value={selection} />
        {/* Ticket 07 sets this when Vender targets an Open Bill. */}
        <input type="hidden" name="billId" value="" />

        {selected.length > 0 ? (
          <section aria-labelledby="seleccion" className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="seleccion" className="text-lg font-semibold">
                Selección
              </h2>
              <button type="button" onClick={() => setQuantities({})} className={quietButton}>
                Limpiar
              </button>
            </div>
            <ul className="mt-2 divide-y divide-stone-200">
              {selected.map((item) => (
                <li key={item.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                  <button
                    type="button"
                    aria-label={`Quitar uno de ${item.name}`}
                    onClick={() => change(item.id, -1)}
                    className={step}
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-lg font-semibold tabular-nums">{quantities[item.id]}</span>
                  <button
                    type="button"
                    aria-label={`Agregar uno de ${item.name}`}
                    onClick={() => change(item.id, 1)}
                    className={step}
                  >
                    +
                  </button>
                  <span className="w-20 shrink-0 text-right tabular-nums">
                    {formatMoney(item.price * quantities[item.id]!)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-center justify-between text-xl font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(total)}</span>
            </p>
          </section>
        ) : null}

        {categories.map((category) => (
          <section key={category.id} aria-labelledby={`categoria-${category.id}`} className="flex flex-col gap-3">
            <h2 id={`categoria-${category.id}`} className="text-xl font-semibold">
              {category.name}
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {category.items.map((item) => (
                <button key={item.id} type="button" onClick={() => change(item.id, 1)} className={tile}>
                  <span className="font-medium">{item.name}</span>
                  <span className="flex items-center justify-between gap-2 text-stone-600">
                    <span>{formatMoney(item.price)}</span>
                    {quantities[item.id] ? (
                      <span className="rounded-full bg-stone-900 px-2 py-0.5 text-sm font-semibold text-white">
                        {quantities[item.id]}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}

        <section
          aria-labelledby="terminar"
          className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-4"
        >
          <h2 id="terminar" className="text-xl font-semibold">
            Cliente y nota
          </h2>

          <CustomerPicker name="customerId" />

          <label className="flex flex-col gap-1">
            <span className="font-medium">Nota (opcional)</span>
            <input name="note" maxLength={80} autoComplete="off" className={field} />
            <span className="text-sm text-stone-600">Quién se lo lleva o cualquier detalle. Hasta 80 caracteres.</span>
          </label>

          {actionData && "error" in actionData ? (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">
              {actionData.error}
            </p>
          ) : null}
          {actionData && "bill" in actionData ? (
            <p role="status" data-bill-id={actionData.bill.id} className="rounded-xl bg-green-50 p-3">
              {recordedMessage(actionData.bill)}
            </p>
          ) : null}

          <button type="submit" disabled={busy || items.length === 0} className={primaryButton}>
            Dejar abierta
          </button>
        </section>
      </Form>
    </div>
  );
}
