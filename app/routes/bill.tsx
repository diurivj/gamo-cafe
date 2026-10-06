import { Effect, Result, Schema } from "effect";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import { type BillNotFound, getBill, takePayment } from "~/backend/bills";
import { CurrentUser } from "~/backend/current-user";
import { BillChanged, BillIsVoided, PaymentExceedsOwed, PaymentNotPositive } from "~/backend/payments";
import { run } from "~/backend/run.server";
import { PaymentFields } from "~/components/payment-fields";
import { requireUser } from "~/session.server";
import { billStateLabel, isOpenBill } from "~/shared/bill-state";
import { formatDay, formatTime } from "~/shared/day";
import { newId } from "~/shared/id";
import { type Centavos, formatMoney, parsePesos } from "~/shared/money";
import { PAYMENT_METHODS, paymentMethodLabel } from "~/shared/payment";
import { paymentMessages } from "~/shared/payment-messages";

import type { Route } from "./+types/bill";

// Cuenta (spec §6.1): one Bill with its Lines, who added each and when, its
// Payments with who, when and method, its state and what it owes. **Agregar
// productos** opens Vender targeting this Bill, so any User can add Lines to
// any Open Bill, and **Cobrar** takes a Payment (ticket 08). Customer and note
// edits (10) and corrections (11) join here later.

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
  return { bill, canAddItems: isOpenBill(bill.state), canPay: isOpenBill(bill.state) && bill.owed > 0 };
}

type PaymentError = BillNotFound | BillChanged | BillIsVoided | PaymentExceedsOwed | PaymentNotPositive;

/** What each rule violation of `takePayment` answers, in Spanish. */
function answerPaymentError(error: PaymentError): { readonly error: string } {
  switch (error._tag) {
    case "BillNotFound":
      throw new Response(null, { status: 404 });
    case "PaymentNotPositive":
      return { error: paymentMessages.PaymentNotPositive };
    case "PaymentExceedsOwed":
      return { error: paymentMessages.PaymentExceedsOwed };
    case "BillIsVoided":
      return { error: paymentMessages.BillIsVoided };
    case "BillChanged":
      return { error: paymentMessages.BillChanged };
  }
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();
  if (String(form.get("intent") ?? "") !== "pagar") {
    return data({ error: "No entendimos esa acción. Recarga la página e intenta de nuevo." }, { status: 400 });
  }

  const decoded = Schema.decodeUnknownResult(Schema.Literals(PAYMENT_METHODS))(
    String(form.get("method") ?? ""),
  );
  if (!Result.isSuccess(decoded)) return data({ error: paymentMessages.MethodMissing }, { status: 400 });

  // An empty amount means everything the Bill still owes (spec §5.5).
  const typed = String(form.get("amount") ?? "").trim();
  let amount: Centavos | null = null;
  if (typed !== "") {
    const parsed = parsePesos(typed);
    if (parsed === undefined) return data({ error: paymentMessages.InvalidAmount }, { status: 400 });
    amount = parsed;
  }

  // The revision the page was rendered from: a stale submission changes
  // nothing and is told the Bill has changed (spec §7.3).
  const revision = Number(String(form.get("revision") ?? ""));
  if (!Number.isSafeInteger(revision)) {
    return data({ error: "Recarga la página e intenta de nuevo." }, { status: 400 });
  }

  const result = await run(
    context,
    takePayment({ billId: params.billId, amount, method: decoded.success, expectedRevision: revision }).pipe(
      Effect.provideService(CurrentUser, user),
    ),
    answerPaymentError,
  );
  if ("error" in result) return data(result, { status: 400 });
  // A Worker may not open a Paid Bill (§4.1, §4.2); the list is where they see
  // it is gone. An Admin stays and sees it Pagada.
  if (result.paid && user.role !== "admin") throw redirect("/cuentas-abiertas");
  return { done: newId(), amount: result.amount };
}

const primaryButton =
  "block rounded-2xl bg-stone-900 px-4 py-4 text-center text-lg font-semibold text-white active:bg-stone-700 disabled:opacity-60";

export default function Bill({ loaderData, actionData }: Route.ComponentProps) {
  const { bill, canAddItems, canPay } = loaderData;
  const busy = useNavigation().state !== "idle";
  const paidNow = actionData && "done" in actionData ? actionData : undefined;

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

      <section aria-labelledby="pagos" className="mt-6">
        <h2 id="pagos" className="text-xl font-semibold">
          Pagos
        </h2>
        {bill.payments.length === 0 ? (
          <p className="mt-3 text-stone-600">Todavía no hay pagos.</p>
        ) : (
          <ul
            aria-label="Pagos"
            className="mt-3 flex flex-col divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white px-4"
          >
            {bill.payments.map((payment) => (
              <li key={payment.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{paymentMethodLabel[payment.method]}</span>
                  <span className="shrink-0 tabular-nums">{formatMoney(payment.amount)}</span>
                </div>
                <p className="text-stone-600">
                  {payment.day === bill.day
                    ? `${payment.byName} · ${formatTime(payment.at)}`
                    : `${payment.byName} · ${formatDay(payment.day)} ${formatTime(payment.at)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {actionData && "error" in actionData ? (
        <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-red-700">
          {actionData.error}
        </p>
      ) : null}
      {paidNow ? (
        <p role="status" className="mt-6 rounded-xl bg-green-50 p-3">
          {bill.owed === 0
            ? `Cuenta pagada: ${formatMoney(bill.total)}.`
            : `Abono de ${formatMoney(paidNow.amount)} registrado. Debe ${formatMoney(bill.owed)}.`}
        </p>
      ) : null}

      {canPay ? (
        <section
          aria-labelledby="cobrar"
          className="mt-6 flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-4"
        >
          <h2 id="cobrar" className="text-xl font-semibold">
            Cobrar
          </h2>

          {/* Keyed by the revision: after the Bill moves, the amount starts
              again at what is now owed. */}
          <Form key={bill.revision} method="post" className="flex flex-col gap-4">
            <input type="hidden" name="revision" value={bill.revision} />
            <PaymentFields
              defaultAmount={bill.owed}
              initialAmount={formatMoney(bill.owed)}
              amountHint="Ya viene todo lo que debe. Puedes cobrar menos."
            />
            <button type="submit" name="intent" value="pagar" disabled={busy} className={primaryButton}>
              Cobrar
            </button>
          </Form>
        </section>
      ) : null}
    </>
  );
}
