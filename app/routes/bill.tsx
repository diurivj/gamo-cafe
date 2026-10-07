import { type MouseEvent, type ReactNode, type RefObject, useEffect, useReducer, useRef, useState } from "react";
import { Effect } from "effect";
import {
  data,
  Form,
  Link,
  redirect,
  type ShouldRevalidateFunctionArgs,
  useBlocker,
  useLocation,
  useNavigate,
  useRevalidator,
} from "react-router";

import { type BillNotFound, editBill, getBill } from "~/backend/bills";
import {
  type LineNotFound,
  type PaymentNotFound,
  type ReasonRequired,
  type TotalBelowPayments,
  removeLine,
  removePayment,
  voidBill,
} from "~/backend/corrections";
import { type AdminOnly, CurrentUser } from "~/backend/current-user";
import type { BillChanged, BillIsVoided } from "~/backend/payments";
import { run } from "~/backend/run.server";
import { BillStateBadge } from "~/components/bill-state-badge";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { CustomerPicker } from "~/components/customer-picker";
import { BackDrawing } from "~/components/icons";
import { Notice } from "~/components/notice";
import { PaymentEntry } from "~/components/payment-entry";
import { hint, pageTitle, sectionTitle } from "~/components/styles";
import { SubmitButton } from "~/components/submit-button";
import { Button, buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { answerWithNotice, takeNotice } from "~/notice.server";
import { requireUser } from "~/session.server";
import {
  billPaymentAfter,
  type BillPaymentAnswer,
  billPaymentBody,
  billPaymentOutcome,
  billPaymentRecordingText,
  type BillPaymentRefusal,
  type BillPaymentSnapshot,
  billPaymentSnapshot,
  type BillPaymentState,
  isBillPaymentAnswer,
  NEW_BILL_PAYMENT,
  PAY_STEP,
  PAY_STEP_PARAM,
} from "~/shared/bill-payment";
import { isOpenBill } from "~/shared/bill-state";
import {
  CORRECTION_INTENTS,
  type CorrectionIntent,
  correctionDone,
  correctionMessages,
} from "~/shared/correction-messages";
import { dayOf, formatDay, formatTime, type Instant } from "~/shared/day";
import { newId } from "~/shared/id";
import { listReturn } from "~/shared/list-return";
import { formatMoney } from "~/shared/money";
import { paymentMethodLabel } from "~/shared/payment";
import type { PaymentDraft } from "~/shared/payment-draft";
import { readPaymentDraft } from "~/shared/payment-draft";
import { paymentMessages } from "~/shared/payment-messages";
import { sendForRecord } from "~/shared/record-request";
import { trimToNull } from "~/shared/text";

import type { Route } from "./+types/bill";

// Cuenta (UI redesign §5.3, §7): one Bill, leading with its state and what it
// owes, then its Lines and its Payments, each with who and when. Its two
// routine actions are apart: **Cobrar** opens the step that takes a Payment
// (`?paso=cobrar`), **Agregar productos** opens Vender targeting this Bill.
// **Cliente y nota** (ticket 10) and the corrections (ticket 11, spec §5.7)
// come after them.
//
// A Payment is `~/shared/bill-payment`: typed, frozen at the tap, sent to
// `/cuentas/:billId/cobrar` (`./resources/record-payment`) with the browser's
// own `fetch`, and kept on screen until the server's own answer says what
// happened. Nothing is read after it until the User asks, so a Worker sees
// the result of a Payment that left the Bill Paid without being sent into a
// Bill they may no longer open (spec §4.1).

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
  return {
    bill,
    canAddItems: isOpenBill(bill.state),
    canPay: isOpenBill(bill.state) && bill.owed > 0,
    isAdmin: user.role === "admin",
    // Any User may while the Bill has no Payment; an Admin may afterwards
    // (spec §4.1). A Voided Bill accepts no corrections, this one included.
    canEdit: bill.state !== "voided" && (user.role === "admin" || bill.paid === 0),
    // What the form that redirected here recorded (spec §3.4).
    notice: takeNotice(context),
  };
}

/** What each rule violation of `editBill` answers, in Spanish. */
const editMessages = {
  CustomerUnavailable: "Ese cliente no existe o está retirado.",
  NoteTooLong: "La nota no puede pasar de 80 caracteres.",
  BillHasPayment: "Esta cuenta ya tiene pagos. Solo un administrador puede cambiar el cliente o la nota.",
  BillChanged: "La cuenta cambió mientras la editabas y no se guardó nada. Revisa el cliente y la nota, y guarda de nuevo.",
} as const;

/** The revision every form of this page submits; without it the page is stale. */
function readRevision(form: FormData): number {
  const revision = Number(String(form.get("revision") ?? ""));
  if (!Number.isSafeInteger(revision)) {
    throw data({ error: "Recarga la página e intenta de nuevo." }, { status: 400 });
  }
  return revision;
}

type CorrectionError =
  | BillNotFound
  | BillChanged
  | BillIsVoided
  | AdminOnly
  | LineNotFound
  | PaymentNotFound
  | ReasonRequired
  | TotalBelowPayments;

/** What each rule violation of a correction answers, in Spanish (spec §5.7). */
function answerCorrectionError(error: CorrectionError): { readonly error: string } {
  switch (error._tag) {
    case "BillNotFound":
      throw new Response(null, { status: 404 });
    case "AdminOnly":
      throw new Response(null, { status: 403 });
    case "BillChanged":
      return { error: correctionMessages.BillChanged };
    case "BillIsVoided":
      return { error: correctionMessages.BillIsVoided };
    case "LineNotFound":
      return { error: correctionMessages.LineNotFound };
    case "PaymentNotFound":
      return { error: correctionMessages.PaymentNotFound };
    case "ReasonRequired":
      return { error: correctionMessages.ReasonRequired };
    case "TotalBelowPayments":
      return { error: correctionMessages.TotalBelowPayments };
  }
}

/**
 * Runs one correction (spec §5.7, §7.3.3): the operation for the submitted
 * intent, the Bill's revision and the reason as the form sent them. The
 * server enforces the permissions, not the screen: a Worker posting an
 * Admin-only correction is answered 403.
 */
async function answerCorrection(
  context: Route.ActionArgs["context"],
  user: ReturnType<typeof requireUser>,
  billId: string,
  intent: CorrectionIntent,
  form: FormData,
): Promise<{ readonly message: string } | { readonly error: string }> {
  const revision = Number(String(form.get("revision") ?? ""));
  if (!Number.isSafeInteger(revision)) {
    return { error: "Recarga la página e intenta de nuevo." };
  }
  const reason = trimToNull(String(form.get("reason") ?? ""));

  const program = Effect.gen(function* () {
    switch (intent) {
      case "quitar-linea":
        return yield* removeLine({
          billId,
          lineId: String(form.get("lineId") ?? ""),
          reason,
          expectedRevision: revision,
        });
      case "quitar-pago":
        return yield* removePayment({
          billId,
          paymentId: String(form.get("paymentId") ?? ""),
          reason,
          expectedRevision: revision,
        });
      case "cancelar-cuenta":
        return yield* voidBill({ billId, reason, expectedRevision: revision });
    }
  });

  const result = await run(
    context,
    program.pipe(Effect.provideService(CurrentUser, user)),
    answerCorrectionError,
  );
  if ("error" in result) return result;
  // A Worker whose removal leaves the Bill Paid no longer opens it (§4.1),
  // so they are sent to the list, where it is gone.
  if ("leftOpen" in result && !result.leftOpen && user.role !== "admin") throw redirect("/cuentas-abiertas");
  return { message: correctionDone[intent] };
}

// The page's own forms: **Cliente y nota** and the corrections. A Payment is
// not one of them: it has its own route, `./resources/record-payment`.
export async function action({ context, params, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  // Whatever is recorded answers the request that sent the form: the
  // browser's router gets the notice in the answer itself; a document POST
  // gets a redirect back to the page, so a reload or the back button records
  // nothing again (spec §3.4).
  const page = `/cuentas/${params.billId}`;

  // The corrections have their own program and their own answer: a Worker
  // posting an Admin-only one is refused with a 403.
  if ((CORRECTION_INTENTS as ReadonlyArray<string>).includes(intent)) {
    const answered = await answerCorrection(context, user, params.billId, intent as CorrectionIntent, form);
    if ("error" in answered) return data(answered, { status: 400 });
    return answerWithNotice(request, page, answered);
  }

  if (intent !== "editar") {
    return data({ error: "No entendimos esa acción. Recarga la página e intenta de nuevo." }, { status: 400 });
  }
  const program = editBill({
    billId: params.billId,
    customerId: String(form.get("customerId") ?? "") || null,
    note: String(form.get("note") ?? ""),
    expectedRevision: readRevision(form),
  }).pipe(Effect.provideService(CurrentUser, user));
  const result = await run(context, program, (error) => {
    switch (error._tag) {
      case "BillNotFound":
        throw new Response(null, { status: 404 });
      case "BillIsVoided":
        return { error: paymentMessages.BillIsVoided };
      case "BillChanged":
        return { error: editMessages.BillChanged };
      case "BillHasPayment":
        return { error: editMessages.BillHasPayment };
      case "CustomerUnavailable":
        return { error: editMessages.CustomerUnavailable };
      case "NoteTooLong":
        return { error: editMessages.NoteTooLong };
    }
  });

  if (result && "error" in result) return data(result, { status: 400 });
  return answerWithNotice(request, page, { message: "Se guardaron los cambios de la cuenta." });
}

/**
 * A form of this page that was refused is most often a stale one: the Bill is
 * read again after it too, so the next attempt carries the revision the Bill
 * has now. The router would otherwise keep what it had after a 400.
 */
export function shouldRevalidate({ formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  return formMethod !== undefined && formMethod !== "GET" ? true : defaultShouldRevalidate;
}

type Data = Route.ComponentProps["loaderData"];
type LoadedBill = Data["bill"];
type Heading = RefObject<HTMLHeadingElement | null>;

/** Where Cuentas abiertas is. */
const LIST_PATH = "/cuentas-abiertas";

/** Whose Bill this is, in the few words a list or a summary has room for. */
const whoseBill = (bill: Pick<LoadedBill, "customer" | "note">) => bill.customer?.name ?? bill.note ?? "Sin cliente";

/** Who recorded something and when: the time on the Bill's own Day, else with the Day. */
const recordedAt = (billDay: string, at: Instant) => {
  const day = dayOf(at);
  return day === billDay ? formatTime(at) : `${formatTime(at)} · ${formatDay(day)}`;
};

/** The reason an Admin's correction carries. Each form has its own, so the label holds the field. */
const reasonField = (
  <Label className="flex-col items-stretch gap-2">
    Motivo
    <Input name="reason" required autoComplete="off" />
  </Label>
);

/** A row of the summary: what the figure is, and the figure. */
function Figure({ label, lead = false, children }: { readonly label: string; readonly lead?: boolean; readonly children: ReactNode }) {
  return (
    <div className={`flex flex-wrap items-baseline justify-between gap-x-3 ${lead ? "border-b pb-3" : ""}`}>
      <dt className={lead ? "text-xl font-medium" : hint}>{label}</dt>{" "}
      <dd className={`tabular-nums ${lead ? "font-heading text-4xl font-semibold" : "font-medium"}`}>{children}</dd>
    </div>
  );
}

/** What the Bill owes, first and largest, then what it adds up to and what was paid. */
function Summary({ bill }: { readonly bill: LoadedBill }) {
  return (
    <Card size="sm" role="region" aria-label="Resumen">
      <CardContent>
        <dl className="flex flex-col gap-2">
          <Figure label="Debe" lead>
            {formatMoney(bill.owed)}
          </Figure>
          <Figure label="Total">{formatMoney(bill.total)}</Figure>
          <Figure label="Pagado">{formatMoney(bill.paid)}</Figure>
        </dl>
      </CardContent>
    </Card>
  );
}

/** The Bill itself: its state and what it owes, its two routine actions, then its records. */
function Overview({
  data,
  heading,
  error,
  said,
  list,
  payHref,
  onPay,
}: {
  readonly data: Data;
  readonly heading: Heading;
  /** What a form of this screen, or its Payment, was refused for. */
  readonly error: string | null;
  /** What a form of this screen recorded. */
  readonly said: string | null;
  readonly list: ReactNode;
  readonly payHref: string;
  readonly onPay: () => void;
}) {
  const { bill, canAddItems, canPay, isAdmin, canEdit } = data;
  // A Voided Bill accepts no further corrections (spec §5.7); a Paid Bill does,
  // which is what §8.5 is about.
  const canCorrect = bill.state !== "voided";

  return (
    <div className="flex flex-col gap-6">
      {list}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
            Cuenta
          </h1>
          <BillStateBadge state={bill.state} />
        </div>
        <div>
          <p className="text-xl font-semibold wrap-break-word">
            {bill.customer ? (
              <Link to={`/clientes/${bill.customer.id}`} className="underline underline-offset-4">
                {bill.customer.name}
              </Link>
            ) : (
              (bill.note ?? "Sin cliente")
            )}
          </p>
          {bill.customer && bill.note ? <p className="wrap-break-word">{bill.note}</p> : null}
          <p className={hint}>{formatDay(bill.day)}</p>
        </div>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {said ? <Notice tone="success">{said}</Notice> : null}
      {bill.voided ? (
        // A record of the Bill, not news: it is not announced as a notice is.
        <Card size="sm">
          <CardContent className="font-medium wrap-break-word">
            {`Cancelada por ${bill.voided.byName} · ${recordedAt(bill.day, bill.voided.at)} · Motivo: ${bill.voided.reason}`}
          </CardContent>
        </Card>
      ) : null}

      <Summary bill={bill} />

      {canPay || canAddItems ? (
        <div className="flex flex-col gap-3">
          {canPay ? (
            <Link to={payHref} onClick={onPay} className={buttonClasses({ size: "touch" })}>
              Cobrar
            </Link>
          ) : null}
          {canAddItems ? (
            <Link
              to={`/?billId=${bill.id}`}
              className={buttonClasses({ size: "touch", variant: canPay ? "outline" : "default" })}
            >
              Agregar productos
            </Link>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="productos" className="flex flex-col gap-3">
        <h2 id="productos" className={sectionTitle}>
          Productos
        </h2>
        {bill.lines.length === 0 ? (
          <p className={hint}>Esta cuenta no tiene productos.</p>
        ) : (
          <Card size="sm">
            <CardContent>
              <ul className="flex flex-col divide-y">
                {bill.lines.map((line) => (
                  <li key={line.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                    <div className={`flex items-baseline justify-between gap-3 ${line.removal ? "text-muted-foreground line-through" : ""}`}>
                      <span className="min-w-0 wrap-break-word">
                        <span className="font-semibold tabular-nums">{`${line.quantity} ×`}</span> {line.itemName}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">{formatMoney(line.unitPrice * line.quantity)}</span>
                    </div>
                    <p className={hint}>{`${formatMoney(line.unitPrice)} c/u`}</p>
                    <p className={`${hint} wrap-break-word`}>{`${line.byName} · ${recordedAt(bill.day, line.at)}`}</p>
                    {line.removal ? (
                      <p className="font-medium wrap-break-word">
                        {`Quitado por ${line.removal.byName} · ${recordedAt(bill.day, line.removal.at)}${
                          line.removal.reason ? ` · ${line.removal.reason}` : ""
                        }`}
                      </p>
                    ) : canCorrect && (bill.paid === 0 || (isAdmin && line.quantity * line.unitPrice <= bill.owed)) ? (
                      <Form method="post" className="mt-2 flex flex-col gap-3">
                        <input type="hidden" name="revision" value={bill.revision} />
                        <input type="hidden" name="lineId" value={line.id} />
                        {/* The reason is required once the Bill has a Payment,
                            which is what `paid > 0` says (spec §5.7). */}
                        {isAdmin && bill.paid > 0 ? reasonField : null}
                        <SubmitButton
                          name="intent"
                          value="quitar-linea"
                          aria-label={`Quitar ${line.quantity} × ${line.itemName}`}
                          className={`${buttonClasses({ size: "touch", variant: "outline" })} self-start`}
                        >
                          Quitar
                        </SubmitButton>
                      </Form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="pagos" className="flex flex-col gap-3">
        <h2 id="pagos" className={sectionTitle}>
          Pagos
        </h2>
        {bill.payments.length === 0 ? (
          <p className={hint}>Todavía no hay pagos.</p>
        ) : (
          <Card size="sm">
            <CardContent>
              <ul aria-label="Pagos" className="flex flex-col divide-y">
                {bill.payments.map((payment) => (
                  <li key={payment.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                    <div className={`flex items-baseline justify-between gap-3 ${payment.removal ? "text-muted-foreground line-through" : ""}`}>
                      <span className="font-semibold">{paymentMethodLabel[payment.method]}</span>
                      <span className="shrink-0 font-medium tabular-nums">{formatMoney(payment.amount)}</span>
                    </div>
                    <p className={`${hint} wrap-break-word`}>{`${payment.byName} · ${recordedAt(bill.day, payment.at)}`}</p>
                    {payment.removal ? (
                      <p className="font-medium wrap-break-word">
                        {`Quitado por ${payment.removal.byName} · ${recordedAt(bill.day, payment.removal.at)} · ${
                          payment.removal.reason ?? ""
                        }`}
                      </p>
                    ) : canCorrect && isAdmin ? (
                      <Form method="post" className="mt-2 flex flex-col gap-3">
                        <input type="hidden" name="revision" value={bill.revision} />
                        <input type="hidden" name="paymentId" value={payment.id} />
                        {reasonField}
                        <SubmitButton
                          name="intent"
                          value="quitar-pago"
                          aria-label={`Quitar pago de ${formatMoney(payment.amount)}`}
                          className={`${buttonClasses({ size: "touch", variant: "outline" })} self-start`}
                        >
                          Quitar pago
                        </SubmitButton>
                      </Form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>

      {canEdit ? (
        <section aria-labelledby="cliente-nota" className="flex flex-col gap-4 border-t pt-6">
          <h2 id="cliente-nota" className={sectionTitle}>
            Cliente y nota
          </h2>

          {/* Keyed by what is stored: after saving, the fields show the new
              values; while a User types, another form's revalidation leaves
              what is typed alone (ticket 18's trap). */}
          <Form
            key={`${bill.customer?.id ?? "sin-cliente"}\n${bill.note ?? ""}`}
            method="post"
            className="flex flex-col gap-4"
          >
            <input type="hidden" name="revision" value={bill.revision} />
            <CustomerPicker name="customerId" defaultValue={bill.customer} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="bill-note">Nota (opcional)</Label>
              <Input
                id="bill-note"
                name="note"
                defaultValue={bill.note ?? ""}
                maxLength={80}
                autoComplete="off"
                aria-describedby="bill-note-hint"
              />
              <p id="bill-note-hint" className={hint}>
                Hasta 80 caracteres.
              </p>
            </div>
            <SubmitButton name="intent" value="editar" className={buttonClasses({ size: "touch", variant: "outline" })}>
              Guardar
            </SubmitButton>
          </Form>
        </section>
      ) : null}

      {canCorrect && isAdmin ? (
        <section aria-labelledby="cancelar-cuenta" className="flex flex-col gap-3 border-t pt-6">
          <h2 id="cancelar-cuenta" className={sectionTitle}>
            Cancelar cuenta
          </h2>
          <p>No se puede deshacer. Los productos regresan a existencias.</p>
          <Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="revision" value={bill.revision} />
            {reasonField}
            <SubmitButton
              name="intent"
              value="cancelar-cuenta"
              className={`${buttonClasses({ size: "touch", variant: "destructive" })} self-start`}
            >
              Cancelar cuenta
            </SubmitButton>
          </Form>
        </section>
      ) : null}
    </div>
  );
}

/** The Bill a Payment is for, always in sight while it is typed or on its way. */
function BillToPay({ bill }: { readonly bill: LoadedBill }) {
  return (
    <Card size="sm" role="region" aria-label="Cuenta">
      <CardContent className="flex flex-col gap-1">
        <p className="text-xl font-semibold wrap-break-word">{whoseBill(bill)}</p>
        <p className={hint}>{formatDay(bill.day)}</p>
        <p className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 border-t pt-3">
          <span className="text-xl font-medium">Debe</span>{" "}
          <span className="font-heading text-4xl font-semibold tabular-nums">{formatMoney(bill.owed)}</span>
        </p>
      </CardContent>
    </Card>
  );
}

/** The step that takes a Payment: the Bill, the Payment, and the one action that records it. */
function Pay({
  bill,
  payment,
  heading,
  onType,
  onBack,
  onSend,
}: {
  readonly bill: LoadedBill;
  readonly payment: Extract<BillPaymentState, { phase: "editing" }>;
  readonly heading: Heading;
  readonly onType: (draft: PaymentDraft) => void;
  readonly onBack: () => void;
  readonly onSend: () => void;
}) {
  // Whether a tap on the action found the Payment could not be recorded yet.
  const [insist, setInsist] = useState(false);
  const paying = readPaymentDraft(payment.draft, bill.owed, paymentMessages.PaymentExceedsOwed);

  return (
    <div className="flex flex-col gap-6">
      <Button type="button" variant="outline" size="touch" onClick={onBack} className="self-start">
        <BackDrawing />
        Volver a la cuenta
      </Button>
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        Cobrar
      </h1>

      <BillToPay bill={bill} />
      {payment.refusal ? <Notice tone="error">{payment.refusal}</Notice> : null}

      <section aria-labelledby="pago" className="flex flex-col gap-4">
        <h2 id="pago" className={sectionTitle}>
          Pago
        </h2>
        <PaymentEntry
          value={payment.draft}
          onChange={onType}
          full={bill.owed}
          tooMuch={paymentMessages.PaymentExceedsOwed}
          insist={insist}
        />
      </section>

      <Button
        type="button"
        size="touch"
        onClick={() => {
          // The field says what is missing; nothing is sent until it can be read.
          if (paying.amount === null) setInsist(true);
          else onSend();
        }}
      >
        {paying.amount === null ? "Registrar pago" : `Registrar pago de ${formatMoney(paying.amount)}`}
      </Button>
    </div>
  );
}

/** What a Payment that was sent carried, for as long as it is on screen. */
function Sent({ snapshot, bill }: { readonly snapshot: BillPaymentSnapshot; readonly bill: LoadedBill }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      <dt className={hint}>Cuenta</dt>
      <dd className="min-w-0 font-medium wrap-break-word">{`${whoseBill(bill)} · ${formatDay(bill.day)}`}</dd>
      <dt className={hint}>Pago</dt>
      <dd className="min-w-0 font-medium wrap-break-word">
        {`${formatMoney(snapshot.amount)} · ${paymentMethodLabel[snapshot.method]}`}
      </dd>
    </dl>
  );
}

/** A Payment on its way, or one nobody knows the outcome of: frozen, with only safe ways on. */
function Pending({
  payment,
  bill,
  heading,
  onRetry,
}: {
  readonly payment: Extract<BillPaymentState, { phase: "recording" | "unknown" }>;
  readonly bill: LoadedBill;
  readonly heading: Heading;
  readonly onRetry: () => void;
}) {
  const recording = payment.phase === "recording";
  return (
    <div className="flex flex-col gap-6" aria-busy={recording}>
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        {recording ? billPaymentRecordingText(payment.snapshot) : "No sabemos si se registró"}
      </h1>
      {recording ? (
        <Notice tone="info">Espera la confirmación.</Notice>
      ) : (
        <>
          <Notice tone="info">
            {payment.sessionEnded
              ? "Tu sesión terminó antes de saberlo. Entra de nuevo y revisa Mi día antes de repetir el pago."
              : "El pago pudo registrarse o no. Volver a intentar no lo registra dos veces."}
          </Notice>
          <div className="flex flex-col gap-3">
            {payment.sessionEnded ? (
              // A document load: the way out of a session that ended.
              <a href="/entrar" className={buttonClasses({ size: "touch" })}>
                Entrar de nuevo
              </a>
            ) : (
              <Button type="button" size="touch" onClick={onRetry}>
                Volver a intentar
              </Button>
            )}
            <Link to="/mi-dia" className={buttonClasses({ variant: "outline", size: "touch" })}>
              Revisar en Mi día
            </Link>
          </div>
        </>
      )}
      <Sent snapshot={payment.snapshot} bill={bill} />
    </div>
  );
}

/** What the server confirmed, kept until the User goes on (UI redesign §5.4). */
function Confirmed({
  payment,
  bill,
  heading,
  list,
  onOpenBill,
}: {
  readonly payment: Extract<BillPaymentState, { phase: "confirmed" }>;
  readonly bill: LoadedBill;
  readonly heading: Heading;
  readonly list: ReactNode;
  readonly onOpenBill: () => void;
}) {
  const { snapshot, result } = payment;
  const outcome = billPaymentOutcome(snapshot, result);

  return (
    <div className="flex flex-col gap-6">
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        {outcome.title}
      </h1>
      <Notice tone="success">{outcome.details}</Notice>

      {outcome.change !== null ? (
        <Card size="sm" role="region" aria-label="Cambio">
          <CardContent className="flex items-baseline justify-between gap-3">
            <span className="text-xl font-medium">Cambio</span>
            <span className="font-heading text-4xl font-semibold tabular-nums">{outcome.change}</span>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3">
        {list}
        {/* Only a Bill this User may open: a Worker is not sent to a Paid one. */}
        {result.canOpen ? (
          <Button type="button" variant="outline" size="touch" onClick={onOpenBill}>
            Ver cuenta
          </Button>
        ) : null}
      </div>

      <Sent snapshot={snapshot} bill={bill} />
    </div>
  );
}

/** A Payment that was refused because the Bill is no longer this User's to open. */
function Gone({
  payment,
  bill,
  heading,
  list,
}: {
  readonly payment: Extract<BillPaymentState, { phase: "gone" }>;
  readonly bill: LoadedBill;
  readonly heading: Heading;
  readonly list: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        No se registró el pago
      </h1>
      <Notice tone="error">La cuenta ya no está abierta: se cobró o se canceló desde otro teléfono.</Notice>
      {list}
      <Sent snapshot={payment.snapshot} bill={bill} />
    </div>
  );
}

function BillScreen({ loaderData, actionData }: Route.ComponentProps) {
  const { bill, canPay, notice: landingNotice } = loaderData;
  const [payment, dispatch] = useReducer(billPaymentAfter, NEW_BILL_PAYMENT);
  const location = useLocation();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  const billPath = `/cuentas/${bill.id}`;
  const atPay = new URLSearchParams(location.search).get(PAY_STEP_PARAM) === PAY_STEP;
  // The Bill was read again after the result came on screen: the result gives
  // way to the Bill as it is now, and the next Payment is a new one. What the
  // loader had read when the result arrived, however old or new, is not that.
  const [readAtResult, setReadAtResult] = useState<typeof loaderData | null>(null);
  const confirmed = payment.phase === "confirmed";
  useEffect(() => {
    setReadAtResult(confirmed ? loaderData : null);
  }, [confirmed]);
  const left = confirmed && readAtResult !== null && readAtResult !== loaderData;
  useEffect(() => {
    if (left) dispatch({ type: "started" });
  }, [left]);
  // A Payment that was sent stays on screen whatever the address says.
  const view =
    payment.phase !== "editing" ? (left ? "bill" : payment.phase) : atPay && canPay ? "pay" : "bill";

  // The step of a Bill that owes nothing is the Bill: after a reload, or once
  // another phone paid it. The address follows.
  const stray = payment.phase === "editing" && atPay && !canPay;
  useEffect(() => {
    if (stray) leaveStep();
  }, [stray]);

  // A snapshot is sent once per attempt, and only its own answer is heard.
  const attempt = payment.phase === "recording" ? payment.attempt : 0;
  useEffect(() => {
    if (payment.phase !== "recording") return;
    const { snapshot } = payment;
    let heard = true;
    void sendForRecord<BillPaymentAnswer, BillPaymentRefusal>(
      `${billPath}/cobrar`,
      billPaymentBody(snapshot),
      isBillPaymentAnswer,
    ).then((outcome) => {
      if (!heard) return;
      dispatch({ type: "answered", key: snapshot.key, outcome });
      // The Bill is not what the screen showed: read it again, and the
      // Payment as it was typed is checked against what it owes now.
      if (outcome.outcome === "refused" && outcome.answer.changed?.canOpen) void revalidate();
    });
    return () => {
      heard = false;
    };
  }, [attempt]);

  // A new view takes the keyboard and the screen reader to its heading, which
  // says what happened: the step, that the Payment is on its way, how it ended.
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [view]);

  // A Payment on its way is not left by accident (UI redesign §6.2).
  const unfinished = payment.phase === "recording" || payment.phase === "unknown";
  const blocker = useBlocker(unfinished);
  // Answered while the question was on screen: there is nothing left to ask
  // about, and the answer is what the User has to see.
  const asking = blocker.state === "blocked";
  useEffect(() => {
    if (asking && !unfinished) blocker.reset();
  }, [asking, unfinished]);
  useEffect(() => {
    if (!unfinished) return;
    // The browser decides whether to ask; a phone often does not.
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [unfinished]);

  // Whether Cuentas abiertas is the history entry before this Bill, and
  // whether the step was reached from the Bill in this history: going back,
  // not on to a new entry, is what keeps the list's search and its place.
  const [cameFromList] = useState(() => (location.state as { fromOpenBills?: boolean } | null)?.fromOpenBills === true);
  const cameFromBill = useRef(false);
  /** From the step to the Bill, without leaving a second entry of the Bill behind. */
  function leaveStep() {
    if (cameFromBill.current) void navigate(-1);
    else void navigate(billPath, { replace: true });
  }
  const toBill = () => {
    // Left while the Payment was on its way: this is the Bill's entry already.
    if (!atPay) void revalidate();
    else leaveStep();
  };
  const toList = (event: MouseEvent) => {
    const entriesBack = !atPay ? 1 : cameFromBill.current ? 2 : null;
    if (!cameFromList || entriesBack === null) return;
    event.preventDefault();
    void navigate(-entriesBack);
  };
  const listLink = (variant: "outline" | "default") => (
    <Link to={listReturn(LIST_PATH)} onClick={toList} className={`${buttonClasses({ size: "touch", variant })} ${variant === "outline" ? "self-start" : ""}`}>
      {variant === "outline" ? <BackDrawing /> : null}
      Cuentas abiertas
    </Link>
  );

  function send() {
    if (payment.phase !== "editing") return;
    // Frozen at the tap, with a key of its own: a second tap finds the
    // Payment already sent and changes nothing.
    const snapshot = billPaymentSnapshot({
      draft: payment.draft,
      bill: { id: bill.id, revision: bill.revision, owed: bill.owed, customerName: bill.customer?.name ?? null },
      key: newId(),
    });
    if (!("problem" in snapshot)) dispatch({ type: "submitted", snapshot });
  }

  // The screen that sent a form reads its notice from the router's own data
  // (ticket 34); the loader's is the one a document POST left (spec §3.4).
  const answeredNotice = actionData && "notice" in actionData ? actionData.notice : null;
  const said = (answeredNotice ?? landingNotice)?.message ?? null;
  const refused = actionData && "error" in actionData ? actionData.error : null;

  return (
    <>
      {view === "bill" || payment.phase === "editing" ? null : payment.phase === "confirmed" ? (
        <Confirmed payment={payment} bill={bill} heading={heading} list={listLink("default")} onOpenBill={toBill} />
      ) : payment.phase === "gone" ? (
        <Gone payment={payment} bill={bill} heading={heading} list={listLink("default")} />
      ) : (
        <Pending payment={payment} bill={bill} heading={heading} onRetry={() => dispatch({ type: "retried" })} />
      )}
      {view === "pay" && payment.phase === "editing" ? (
        <Pay
          bill={bill}
          payment={payment}
          heading={heading}
          onType={(draft) => dispatch({ type: "typed", draft })}
          onBack={leaveStep}
          onSend={send}
        />
      ) : view === "bill" ? (
        <Overview
          data={loaderData}
          heading={heading}
          // A Payment refused for a Bill that then owes nothing is said here,
          // until this screen has something newer to say.
          error={refused ?? (said === null && payment.phase === "editing" ? payment.refusal : null)}
          said={said}
          list={listLink("outline")}
          payHref={`${billPath}?${PAY_STEP_PARAM}=${PAY_STEP}`}
          onPay={() => {
            cameFromBill.current = true;
            // The last Payment's refusal was about the Bill as it was.
            if (payment.phase === "editing") dispatch({ type: "typed", draft: payment.draft });
          }}
        />
      ) : null}

      <ConfirmDialog
        open={asking && unfinished}
        title="El pago puede estarse registrando"
        description="Salir no cancela el registro. Antes de repetir el pago, revisa Mi día."
        confirm="Salir"
        cancel="Quedarme aquí"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => {
          if (blocker.state === "blocked") blocker.reset();
        }}
      />
    </>
  );
}

export default function Bill(props: Route.ComponentProps) {
  // Another Bill is another Payment: it starts from nothing.
  return <BillScreen key={props.loaderData.bill.id} {...props} />;
}
