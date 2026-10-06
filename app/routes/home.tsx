import { useEffect, useState } from "react";
import { data, Form, Link, useNavigation, useOutletContext } from "react-router";
import { Effect, Result, Schema } from "effect";

import {
  type BillNotFound,
  type BillNotOpen,
  type BillSummary,
  type CustomerUnavailable,
  type EmptySelection,
  getBill,
  type InvalidQuantity,
  type ItemUnavailable,
  type NewSelection,
  type NewSelectionPayment,
  type NoteTooLong,
  recordSelection,
  type TargetConflict,
} from "~/backend/bills";
import { CurrentUser } from "~/backend/current-user";
import { type PaymentExceedsOwed, type PaymentNotPositive } from "~/backend/payments";
import { run } from "~/backend/run.server";
import { CustomerPicker } from "~/components/customer-picker";
import { PaymentFields } from "~/components/payment-fields";
import { redirectWithFlash, takeFlash } from "~/flash.server";
import { requireUser } from "~/session.server";
import { newId } from "~/shared/id";
import { formatMoney, parsePesos } from "~/shared/money";
import { PAYMENT_METHODS, type PaymentMethod } from "~/shared/payment";
import { paymentMessages } from "~/shared/payment-messages";

import type { Route } from "./+types/home";
import type { SellItems } from "./sell-items";

// Vender (spec §6.1): the Items as large buttons by Category, a selection the
// browser holds until it is recorded, a Customer or a note, **Dejar abierta**
// and **Cobrar** (ticket 08), which records the selection and a Payment in one
// batch. With `?billId=`, Cuenta's **Agregar productos** turns it into the
// same screen targeting one Open Bill (ticket 07). The Items come from the
// layout around it, `./sell-items`, which a sale does not load again.

export const meta: Route.MetaFunction = () => [{ title: "Vender · Gamo Cafe" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  const user = requireUser(context);
  const billId = new URL(request.url).searchParams.get("billId") ?? "";
  // What the selection that redirected here recorded (spec §3.4).
  const flash = takeFlash(context);
  // The key of the form this page renders (spec §3.4): new every time the
  // loader runs, so after each recorded sale, and the same for a double tap
  // or a retry of one rendered form. It is why this loader, unlike the Items'
  // in `./sell-items`, must run again after a sale.
  const submissionKey = newId();
  if (billId === "") return { target: null, flash, submissionKey };

  const bill = await run(
    context,
    getBill(billId).pipe(Effect.provideService(CurrentUser, user)),
    (error) => {
      switch (error._tag) {
        case "BillNotFound":
          throw new Response(null, { status: 404 });
        case "BillNotVisible":
          throw new Response(null, { status: 403 });
      }
    },
  );
  // The screen shows the target's figures, not its Lines or Payments.
  const { lines: _lines, payments: _payments, ...target } = bill;
  return { target, flash, submissionKey };
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
    submissionKey: String(form.get("submissionKey") ?? "") || null,
  };
}

/** What **Cobrar** sends besides the selection: a method and an optional amount. */
function readPayment(form: FormData): NewSelectionPayment | { readonly error: string } {
  const decoded = Schema.decodeUnknownResult(Schema.Literals(PAYMENT_METHODS))(
    String(form.get("method") ?? ""),
  );
  if (!Result.isSuccess(decoded)) return { error: paymentMessages.MethodMissing };

  const method: PaymentMethod = decoded.success;
  const typed = String(form.get("amount") ?? "").trim();
  if (typed === "") return { method, amount: null };
  const amount = parsePesos(typed);
  if (amount === undefined) return { error: paymentMessages.InvalidAmount };
  return { method, amount };
}

type SelectionError =
  | BillNotFound
  | BillNotOpen
  | CustomerUnavailable
  | EmptySelection
  | InvalidQuantity
  | ItemUnavailable
  | NoteTooLong
  | PaymentExceedsOwed
  | PaymentNotPositive
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
    case "PaymentNotPositive":
      return { error: paymentMessages.PaymentNotPositive };
    case "PaymentExceedsOwed":
      return { error: paymentMessages.PaymentExceedsSelection };
  }
}

export async function action({ context, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "dejar-abierta" && intent !== "cobrar") {
    return data({ error: "No entendimos esa acción. Recarga la página e intenta de nuevo." }, { status: 400 });
  }

  const selection = readSelection(form);
  if ("error" in selection) return data(selection, { status: 400 });

  // Cobrar records the selection and a Payment together, in the one batch of
  // `recordSelection` (spec §7.3.1).
  let payment: NewSelectionPayment | null = null;
  if (intent === "cobrar") {
    const read = readPayment(form);
    if ("error" in read) return data(read, { status: 400 });
    payment = read;
  }

  const program = recordSelection({ ...selection, payment }).pipe(Effect.provideService(CurrentUser, user));
  const result = await run(context, program, answerSelectionError);
  if ("error" in result) return data(result, { status: 400 });
  // Recorded: a redirect back to the screen, so a reload or the back button
  // records nothing again (spec §3.4). The message and the Bill's id travel
  // with it; the page empties the selection when it sees them.
  const message =
    intent === "cobrar" ? paidMessage(result) : selection.billId ? addedMessage(result) : recordedMessage(result);
  return redirectWithFlash(selection.billId ? `/?billId=${encodeURIComponent(selection.billId)}` : "/", {
    message,
    billId: result.id,
  });
}

const tile =
  "flex min-h-20 flex-col justify-between gap-2 rounded-2xl border border-stone-300 bg-white p-4 text-left active:bg-stone-100 disabled:opacity-60";
const step = "h-11 w-11 shrink-0 rounded-full border border-stone-300 bg-white text-xl font-semibold";
const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg";
const quietButton = "rounded-xl border border-stone-300 bg-white px-4 py-2 font-medium disabled:opacity-60";
const primaryButton = "rounded-2xl bg-stone-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60";

/** What the screen says after a selection was recorded and left Open. */
const recordedMessage = (bill: BillSummary) =>
  `Se dejó abierta ${bill.customer ? `la cuenta de ${bill.customer.name}` : "una cuenta"} por ${formatMoney(bill.total)}.`;

/** What it says after Lines were added to the Bill Cuenta sent the User from. */
const addedMessage = (bill: BillSummary) =>
  `Se agregaron los productos a la cuenta. Total ${formatMoney(bill.total)} · Debe ${formatMoney(bill.owed)}.`;

/** What it says after **Cobrar** recorded a Payment with the selection. */
const paidMessage = (bill: BillSummary) =>
  bill.owed === 0
    ? `Cuenta pagada: ${formatMoney(bill.total)}.`
    : `Abono registrado. Debe ${formatMoney(bill.owed)}.`;

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const { target, flash, submissionKey } = loaderData;
  const { categories } = useOutletContext<SellItems>();
  const busy = useNavigation().state !== "idle";
  const [quantities, setQuantities] = useState<Readonly<Record<string, number>>>({});
  // A new key remounts the form after a recorded selection, so the picker and
  // the note start over; the key holds after a refusal, which keeps them.
  const [formKey, setFormKey] = useState("nueva");

  // New for every recorded selection, whether this page was already open or
  // the redirect loaded it.
  const recorded = flash?.id;
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

      {target ? (
        <section aria-label="Cuenta destino" className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium">
            {target.customer
              ? `Agregando productos a la cuenta de ${target.customer.name}`
              : "Agregando productos a una cuenta sin cliente"}
          </p>
          <p className="mt-1 text-stone-600">{`Total ${formatMoney(target.total)} · Debe ${formatMoney(target.owed)}`}</p>
          <Link to={`/cuentas/${target.id}`} className="mt-2 inline-block font-medium underline">
            Ver cuenta
          </Link>
        </section>
      ) : null}

      {items.length === 0 ? (
        <p className="text-lg text-stone-600">
          Todavía no hay productos. Pídele a un administrador que agregue el menú.
        </p>
      ) : null}

      {/* `?index` aims the POST at this index route's action, not the layout's.
          A target Bill rides in the same query, so the action answers for the
          same page the loader rendered. */}
      <Form
        method="post"
        action={target ? `/?index&billId=${target.id}` : "?index"}
        key={formKey}
        className="flex flex-col gap-6"
      >
        <input type="hidden" name="selection" value={selection} />
        {/* Set when Cuenta's Agregar productos sent the User here. */}
        <input type="hidden" name="billId" value={target?.id ?? ""} />
        {/* One sale per rendered form, however many times it is sent. */}
        <input type="hidden" name="submissionKey" value={submissionKey} />

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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
            {target ? "Agregar a la cuenta" : "Cliente y nota"}
          </h2>

          {/* A Bill's Customer and note are set on Cuenta (ticket 10); when
              adding to one, the picker and the note stay out of the way. */}
          {target ? null : <CustomerPicker name="customerId" />}

          {target ? null : (
            <label className="flex flex-col gap-1">
              <span className="font-medium">Nota (opcional)</span>
              <input name="note" maxLength={80} autoComplete="off" className={field} />
              <span className="text-sm text-stone-600">Quién se lo lleva o cualquier detalle. Hasta 80 caracteres.</span>
            </label>
          )}

          {actionData && "error" in actionData ? (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">
              {actionData.error}
            </p>
          ) : null}
          {flash?.message ? (
            <p role="status" data-bill-id={flash.billId} className="rounded-xl bg-green-50 p-3">
              {flash.message}
            </p>
          ) : null}

          <button
            type="submit"
            name="intent"
            value="dejar-abierta"
            disabled={busy || items.length === 0}
            className={primaryButton}
          >
            {target ? "Agregar a la cuenta" : "Dejar abierta"}
          </button>
        </section>

        {/* Cobrar records the selection and a Payment together, in one batch
            (spec §6.1, §7.3.1, §8.1). */}
        <section
          aria-labelledby="cobrar"
          className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-4"
        >
          <h2 id="cobrar" className="text-xl font-semibold">
            Cobrar
          </h2>
          <PaymentFields
            defaultAmount={total}
            amountHint="Déjalo vacío para cobrar todo el total; también puedes cobrar menos."
          />
          <button
            type="submit"
            name="intent"
            value="cobrar"
            disabled={busy || items.length === 0}
            className={primaryButton}
          >
            Cobrar
          </button>
        </section>
      </Form>
    </div>
  );
}
