import { type MouseEvent, type ReactNode, type RefObject, useEffect, useReducer, useRef, useState } from "react";
import { Effect } from "effect";
import {
  data,
  Form,
  Link,
  type ShouldRevalidateFunctionArgs,
  useLocation,
  useNavigate,
  useRevalidator,
} from "react-router";

import { editBill, getBill } from "~/backend/bills";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { BillStateBadge } from "~/components/bill-state-badge";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { CLOSED_BILL } from "~/components/error-screen";
import { CustomerPicker } from "~/components/customer-picker";
import { BackDrawing } from "~/components/icons";
import { Notice } from "~/components/notice";
import { PaymentEntry } from "~/components/payment-entry";
import { Change, Pending, SentRows, useLeaveGuard, useReadAgainSince } from "~/components/recording";
import { useRecorded } from "~/shared/recorded";
import { amount, figureRow, hint, pageTitle, sectionTitle } from "~/components/styles";
import { SubmitButton } from "~/components/submit-button";
import { Button, buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
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
  type CorrectionAnswer,
  correctionAfter,
  correctionAt,
  correctionBody,
  correctionHref,
  correctionKey,
  correctionOfKey,
  correctionOutcome,
  type CorrectionPlan,
  correctionPlan,
  correctionRecordingText,
  type CorrectionRefusal,
  type CorrectionSnapshot,
  correctionSnapshot,
  type CorrectionState,
  type CorrectionTarget,
  isCorrectionAnswer,
  NEW_CORRECTION,
  reasonFor,
} from "~/shared/correction";
import type { CorrectionIntent } from "~/shared/correction-messages";
import { dayOf, formatDay, formatTime, type Instant } from "~/shared/day";
import { newId } from "~/shared/id";
import { listReturn } from "~/shared/list-return";
import { formatMoney } from "~/shared/money";
import { paymentMethodLabel } from "~/shared/payment";
import type { PaymentDraft } from "~/shared/payment-draft";
import { readPaymentDraft } from "~/shared/payment-draft";
import { paymentMessages } from "~/shared/payment-messages";
import { sendForRecord } from "~/shared/record-request";

import type { Route } from "./+types/bill";

// Cuenta (UI redesign §5.3, §7): one Bill, leading with its state and what it
// owes, then its Lines and its Payments, each with who and when. Its two
// routine actions are apart: **Cobrar** opens the step that takes a Payment
// (`?paso=cobrar`), **Agregar productos** opens Vender targeting this Bill.
// **Cliente y nota** (ticket 10) comes after the records.
//
// A Payment is `~/shared/bill-payment`: typed, frozen at the tap, sent to
// `/cuentas/:billId/cobrar` (`./resources/record-payment`) with the browser's
// own `fetch`, and kept on screen until the server's own answer says what
// happened. Nothing is read after it until the User asks, so a Worker sees
// the result of a Payment that left the Bill Paid without being sent into a
// Bill they may no longer open (spec §4.1).
//
// A correction (spec §5.7, UI redesign §7.2) is `~/shared/correction`, and is
// never one tap away from the routine actions: **Quitar** on a Line or a
// Payment and **Cancelar esta cuenta** each open a step of their own
// (`?paso=quitar-linea&id=…`), which names the record, says what will happen
// and has the one action that does it. It is sent and answered as a Payment
// is, to `/cuentas/:billId/corregir` (`./resources/record-correction`).

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
          // A Worker may not open a Bill that is no longer Open (spec §4.1),
          // and is told that much: the browser's Back leads here from the
          // result of the Payment that closed it.
          throw data(CLOSED_BILL, { status: 403 });
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

// The page's own form: **Cliente y nota**. A Payment and a correction are not
// forms of the page: each has its own route, `./resources/record-payment` and
// `./resources/record-correction`.
export async function action({ context, params, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  // Whatever is recorded answers the request that sent the form: the
  // browser's router gets the notice in the answer itself; a document POST
  // gets a redirect back to the page, so a reload or the back button records
  // nothing again (spec §3.4).
  const page = `/cuentas/${params.billId}`;

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

/** Whose Bill this is, in the few words a list or a summary has room for. */
const whoseBill = (bill: Pick<LoadedBill, "customer" | "note">) => bill.customer?.name ?? bill.note ?? "Sin cliente";

/** Who recorded something and when: the time on the Bill's own Day, else with the Day. */
const recordedAt = (billDay: string, at: Instant) => {
  const day = dayOf(at);
  return day === billDay ? formatTime(at) : `${formatTime(at)} · ${formatDay(day)}`;
};

type LoadedLine = LoadedBill["lines"][number];
type LoadedPayment = LoadedBill["payments"][number];

/** A Line, a Payment and the Bill itself as a correction is asked about them. */
const lineTarget = (line: LoadedLine): CorrectionTarget => ({
  intent: "quitar-linea",
  line: { ...line, removed: line.removal !== null },
});
const paymentTarget = (payment: LoadedPayment): CorrectionTarget => ({
  intent: "quitar-pago",
  payment: { ...payment, removed: payment.removal !== null },
});
const voidTarget = (bill: LoadedBill): CorrectionTarget => ({
  intent: "cancelar-cuenta",
  movesStock: bill.lines.some((line) => line.removal === null && line.movedStock),
});

/** The record the address's correction is about, as the Bill has it now; null when it has none. */
function targetAt(bill: LoadedBill, asked: NonNullable<ReturnType<typeof correctionAt>>): CorrectionTarget | null {
  switch (asked.intent) {
    case "quitar-linea": {
      const line = bill.lines.find((line) => line.id === asked.targetId);
      return line ? lineTarget(line) : null;
    }
    case "quitar-pago": {
      const payment = bill.payments.find((payment) => payment.id === asked.targetId);
      return payment ? paymentTarget(payment) : null;
    }
    case "cancelar-cuenta":
      return voidTarget(bill);
  }
}

/** A removal as its record says it: who, when and, when one was given, why. */
const removalText = (billDay: string, removal: NonNullable<LoadedLine["removal"]>) =>
  `Quitado por ${removal.byName} · ${recordedAt(billDay, removal.at)}${removal.reason ? ` · Motivo: ${removal.reason}` : ""}`;

/** A Line as its row and its correction's step show it. */
function LineRecord({ bill, line }: { readonly bill: LoadedBill; readonly line: LoadedLine }) {
  return (
    <>
      <div className={`${figureRow} ${line.removal ? "text-muted-foreground line-through" : ""}`}>
        <span className="min-w-0 wrap-break-word">
          <span className="font-semibold tabular-nums">{`${line.quantity} ×`}</span> {line.itemName}
        </span>{" "}
        <span className={`ml-auto font-medium ${amount}`}>{formatMoney(line.unitPrice * line.quantity)}</span>
      </div>
      <p className={hint}>{`${formatMoney(line.unitPrice)} c/u`}</p>
      <p className={`${hint} wrap-break-word`}>{`${line.byName} · ${recordedAt(bill.day, line.at)}`}</p>
    </>
  );
}

/** A Payment as its row and its correction's step show it. */
function PaymentRecord({ bill, payment }: { readonly bill: LoadedBill; readonly payment: LoadedPayment }) {
  return (
    <>
      <div className={`${figureRow} ${payment.removal ? "text-muted-foreground line-through" : ""}`}>
        <span className="font-semibold">{paymentMethodLabel[payment.method]}</span>{" "}
        <span className={`ml-auto font-medium ${amount}`}>{formatMoney(payment.amount)}</span>
      </div>
      <p className={`${hint} wrap-break-word`}>{`${payment.byName} · ${recordedAt(bill.day, payment.at)}`}</p>
    </>
  );
}

/** A row of the summary: what the figure is, and the figure. */
function Figure({ label, lead = false, children }: { readonly label: string; readonly lead?: boolean; readonly children: ReactNode }) {
  return (
    <div className={`${figureRow} ${lead ? "border-b pb-3" : ""}`}>
      <dt className={lead ? "text-xl font-medium" : hint}>{label}</dt>{" "}
      <dd className={`${amount} ${lead ? "font-heading text-4xl font-semibold" : "font-medium"}`}>{children}</dd>
    </div>
  );
}

/** What the Bill owes, first and largest, then what it adds up to and what was paid. */
function Figures({ bill }: { readonly bill: LoadedBill }) {
  return (
    <dl className="flex flex-col gap-2">
      <Figure label="Debe" lead>
        {formatMoney(bill.owed)}
      </Figure>
      <Figure label="Total">{formatMoney(bill.total)}</Figure>
      <Figure label="Pagado">{formatMoney(bill.paid)}</Figure>
    </dl>
  );
}

function Summary({ bill }: { readonly bill: LoadedBill }) {
  return (
    <Card size="sm" role="region" aria-label="Resumen">
      <CardContent>
        <Figures bill={bill} />
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
  onCorrect,
}: {
  readonly data: Data;
  readonly heading: Heading;
  /** What a form of this screen, its Payment or a correction was refused for. */
  readonly error: string | null;
  /** What a form of this screen recorded. */
  readonly said: string | null;
  readonly list: ReactNode;
  readonly payHref: string;
  readonly onPay: () => void;
  /** A correction's step is being opened. */
  readonly onCorrect: (intent: CorrectionIntent, targetId: string | null) => void;
}) {
  const { bill, canAddItems, canPay, isAdmin, canEdit } = data;
  // What this User is offered is `correctionPlan`'s to say (spec §4.1, §5.7):
  // a Paid Bill still accepts an Admin's corrections, a Voided one accepts none.
  const offered = (target: CorrectionTarget) => correctionPlan(bill, target, isAdmin) !== null;
  /** The way into a correction's step: quiet, and never the action itself. */
  const stepLink = (intent: CorrectionIntent, targetId: string | null, label: string, name: string) => (
    <Link
      to={correctionHref(bill.id, intent, targetId)}
      onClick={() => onCorrect(intent, targetId)}
      aria-label={name}
      className={`${buttonClasses({ size: "touch", variant: "outline" })} mt-2 self-start`}
    >
      {label}
    </Link>
  );

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
                    <LineRecord bill={bill} line={line} />
                    {line.removal ? (
                      <p className="font-medium wrap-break-word">{removalText(bill.day, line.removal)}</p>
                    ) : offered(lineTarget(line)) ? (
                      stepLink("quitar-linea", line.id, "Quitar", `Quitar ${line.quantity} × ${line.itemName}`)
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        {/* Why a Worker finds no way to remove a Line here (spec §4.1). */}
        {!isAdmin && bill.paid > 0 && bill.lines.some((line) => line.removal === null) ? (
          <p className={hint}>Esta cuenta ya tiene pagos: solo un administrador puede quitar productos.</p>
        ) : null}
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
                    <PaymentRecord bill={bill} payment={payment} />
                    {payment.removal ? (
                      <p className="font-medium wrap-break-word">{removalText(bill.day, payment.removal)}</p>
                    ) : offered(paymentTarget(payment)) ? (
                      stepLink("quitar-pago", payment.id, "Quitar pago", `Quitar pago de ${formatMoney(payment.amount)}`)
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

      {offered(voidTarget(bill)) ? (
        <section aria-labelledby="cancelar-cuenta" className="flex flex-col gap-3 border-t pt-6">
          <h2 id="cancelar-cuenta" className={sectionTitle}>
            Cancelar cuenta
          </h2>
          <p>Para una cuenta que no debió registrarse. No se puede deshacer.</p>
          {stepLink("cancelar-cuenta", null, "Cancelar esta cuenta", "Cancelar esta cuenta")}
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
        <p className={`mt-2 ${figureRow} border-t pt-3`}>
          <span className="text-xl font-medium">Debe</span>{" "}
          <span className={`font-heading text-4xl font-semibold ${amount}`}>{formatMoney(bill.owed)}</span>
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

/** What each correction's step is called. */
const correctionTitle: Record<CorrectionIntent, string> = {
  "quitar-linea": "Quitar producto",
  "quitar-pago": "Quitar pago",
  "cancelar-cuenta": "Cancelar cuenta",
};

/**
 * The step of a correction (UI redesign §7.2): the Bill and the record it is
 * about, what will happen, the reason when one is owed, and the one action
 * that does it, named by its effect. The step is the confirmation: no dialog
 * asks again.
 */
function Correct({
  bill,
  target,
  plan,
  reason,
  refusal,
  heading,
  onType,
  onBack,
  onSend,
}: {
  readonly bill: LoadedBill;
  readonly target: CorrectionTarget;
  readonly plan: CorrectionPlan;
  readonly reason: string;
  readonly refusal: string | null;
  readonly heading: Heading;
  readonly onType: (reason: string) => void;
  readonly onBack: () => void;
  readonly onSend: () => void;
}) {
  // Whether a tap on the action found the reason missing.
  const [insist, setInsist] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const missing = plan.needsReason && reason.trim() === "";
  const line = target.intent === "quitar-linea" ? bill.lines.find((line) => line.id === target.line.id) : undefined;
  const payment =
    target.intent === "quitar-pago" ? bill.payments.find((payment) => payment.id === target.payment.id) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <Button type="button" variant="outline" size="touch" onClick={onBack} className="self-start">
        <BackDrawing />
        Volver a la cuenta
      </Button>
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        {correctionTitle[target.intent]}
      </h1>

      <Card size="sm" role="region" aria-label="Cuenta">
        <CardContent className="flex flex-col gap-1">
          <p className="text-xl font-semibold wrap-break-word">{whoseBill(bill)}</p>
          <p className={hint}>{formatDay(bill.day)}</p>
          <div className="mt-2 flex flex-col gap-1 border-t pt-3">
            {line ? <LineRecord bill={bill} line={line} /> : null}
            {payment ? <PaymentRecord bill={bill} payment={payment} /> : null}
            {target.intent === "cancelar-cuenta" ? <Figures bill={bill} /> : null}
          </div>
        </CardContent>
      </Card>

      {refusal ? <Notice tone="error">{refusal}</Notice> : null}

      {plan.blocked !== null ? (
        <Notice tone="info">{plan.blocked}</Notice>
      ) : (
        <>
          <section aria-labelledby="efecto" className="flex flex-col gap-3">
            <h2 id="efecto" className={sectionTitle}>
              {target.intent === "cancelar-cuenta" ? "Al cancelarla" : "Al quitarlo"}
            </h2>
            <ul className="flex list-disc flex-col gap-2 pl-6">
              {plan.consequences.map((consequence) => (
                <li key={consequence} className="wrap-break-word">
                  {consequence}
                </li>
              ))}
            </ul>
          </section>

          {plan.needsReason ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="motivo">Motivo</Label>
              <Textarea
                ref={field}
                id="motivo"
                value={reason}
                onChange={(event) => onType(event.currentTarget.value)}
                rows={2}
                autoComplete="off"
                aria-required
                aria-invalid={(insist && missing) || undefined}
                aria-describedby="motivo-ayuda"
              />
              {insist && missing ? (
                <Notice tone="error" id="motivo-ayuda">
                  Escribe el motivo.
                </Notice>
              ) : (
                <p id="motivo-ayuda" className={hint}>
                  Queda en el historial, con tu nombre.
                </p>
              )}
            </div>
          ) : null}

          <Button
            type="button"
            size="touch"
            variant={target.intent === "cancelar-cuenta" ? "destructive" : "default"}
            onClick={() => {
              // The field says what is missing; nothing is sent without it.
              if (missing) {
                setInsist(true);
                field.current?.focus();
              } else onSend();
            }}
          >
            {plan.action}
          </Button>
        </>
      )}
    </div>
  );
}

/** What was sent, for as long as it is on screen: the Bill, and the Payment or the correction. */
function Sent({
  bill,
  rows,
}: {
  readonly bill: LoadedBill;
  /** What it was, and what it carried: "Pago", "$20.00 · Efectivo". */
  readonly rows: ReadonlyArray<readonly [label: string, value: string]>;
}) {
  return <SentRows rows={[["Cuenta", `${whoseBill(bill)} · ${formatDay(bill.day)}`], ...rows]} />;
}

const sentPayment = (snapshot: BillPaymentSnapshot) =>
  [["Pago", `${formatMoney(snapshot.amount)} · ${paymentMethodLabel[snapshot.method]}`]] as const;

const sentCorrection = (snapshot: CorrectionSnapshot) =>
  [
    [correctionTitle[snapshot.intent], snapshot.what],
    ...(snapshot.reason === null ? [] : [["Motivo", snapshot.reason] as const]),
  ] as const;

/** What the server confirmed, kept until the User goes on (UI redesign §5.4). */
function Confirmed({
  title,
  details,
  change = null,
  canOpen,
  heading,
  list,
  onOpenBill,
  children,
}: {
  readonly title: string;
  readonly details: string;
  /** The cash to hand back, when a Payment had any. */
  readonly change?: string | null;
  /** Only a Bill this User may open: a Worker is not sent to one that is no longer Open. */
  readonly canOpen: boolean;
  readonly heading: Heading;
  readonly list: ReactNode;
  readonly onOpenBill: () => void;
  readonly children: ReactNode;
}) {
  useRecorded(title, details);
  return (
    <div className="flex flex-col gap-6">
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        {title}
      </h1>
      <Notice tone="success">{details}</Notice>

      {change !== null ? <Change amount={change} /> : null}

      <div className="flex flex-col gap-3">
        {list}
        {canOpen ? (
          <Button type="button" variant="outline" size="touch" onClick={onOpenBill}>
            Ver cuenta
          </Button>
        ) : null}
      </div>

      {children}
    </div>
  );
}

/** What was refused because the Bill is no longer this User's to open. */
function Gone({
  title,
  heading,
  list,
  children,
}: {
  readonly title: string;
  readonly heading: Heading;
  readonly list: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        {title}
      </h1>
      <Notice tone="error">La cuenta ya no está abierta: se cobró o se canceló desde otro teléfono.</Notice>
      {list}
      {children}
    </div>
  );
}

/** The lists a Bill is opened from, and what the way back to each is called. */
const LISTS: Readonly<Record<string, string>> = {
  "/cuentas-abiertas": "Cuentas abiertas",
  "/cuentas": "Cuentas",
  "/por-cobrar": "Por cobrar",
  "/historial": "Historial",
};

/** A Customer's page lists their Bills too, and is the way back from one it opened. */
const isCustomerPage = (path: string) => /^\/clientes\/[^/?#]+$/.test(path);

/** What the way back to a list is called: a path `listBehind` let through, or Cuentas abiertas. */
const listName = (path: string) => (isCustomerPage(path) ? "Cliente" : LISTS[path]);

/** The list whose row led here, when its link said so (`state={{ fromList }}`). */
function listBehind(state: unknown): string | null {
  const from = (state as { readonly fromList?: unknown } | null)?.fromList;
  return typeof from === "string" && (Object.hasOwn(LISTS, from) || isCustomerPage(from)) ? from : null;
}

function BillScreen({ loaderData, actionData }: Route.ComponentProps) {
  const { bill, canPay, isAdmin, notice: landingNotice } = loaderData;
  const [payment, dispatch] = useReducer(billPaymentAfter, NEW_BILL_PAYMENT);
  const [correction, dispatchCorrection] = useReducer(correctionAfter, NEW_CORRECTION);
  const location = useLocation();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  const billPath = `/cuentas/${bill.id}`;
  const search = new URLSearchParams(location.search);
  const atPay = search.get(PAY_STEP_PARAM) === PAY_STEP;
  // The correction the address asks for, and what it would do to the Bill as
  // it is now: no plan, no step.
  const asked = correctionAt(search);
  const target = asked ? targetAt(bill, asked) : null;
  const plan = target ? correctionPlan(bill, target, isAdmin) : null;
  const atStep = atPay || asked !== null;

  // A result stays until the User goes on (UI redesign §5.4): only a read
  // they asked for, with **Ver cuenta**, makes it give way to the Bill as it
  // is now, and the next Payment or correction is new. A read that was already
  // on its way when the answer came — the step left while it was recording —
  // is not that, and takes neither the result nor its change off the screen.
  const [goingOn, setGoingOn] = useState(false);
  const paidAndLeft = useReadAgainSince(payment.phase === "confirmed" && goingOn, loaderData);
  useEffect(() => {
    if (!paidAndLeft) return;
    dispatch({ type: "started" });
    setGoingOn(false);
  }, [paidAndLeft]);
  const correctedAndLeft = useReadAgainSince(correction.phase === "confirmed" && goingOn, loaderData);
  useEffect(() => {
    if (!correctedAndLeft) return;
    dispatchCorrection({ type: "started" });
    setGoingOn(false);
  }, [correctedAndLeft]);

  // What was sent stays on screen whatever the address says.
  const sent: "payment" | "correction" | null =
    payment.phase !== "editing" && !paidAndLeft
      ? "payment"
      : correction.phase !== "editing" && !correctedAndLeft
        ? "correction"
        : null;
  const idle = payment.phase === "editing" && correction.phase === "editing";
  const view =
    sent === "payment"
      ? payment.phase
      : sent === "correction"
        ? `correction-${correction.phase}`
        : !idle
          ? "bill"
          : atPay && canPay
            ? "pay"
            : plan
              ? "correct"
              : "bill";

  // A step with nothing to do is the Bill: Cobrar on one that owes nothing, a
  // correction of a record that can no longer be corrected, after a reload or
  // once another phone got there first. The address follows.
  const stray = idle && ((atPay && !canPay) || (asked !== null && plan === null));
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

  const correctionAttempt = correction.phase === "recording" ? correction.attempt : 0;
  useEffect(() => {
    if (correction.phase !== "recording") return;
    const { snapshot, attempt } = correction;
    let heard = true;
    void sendForRecord<CorrectionAnswer, CorrectionRefusal>(
      `${billPath}/corregir`,
      correctionBody(snapshot),
      isCorrectionAnswer,
    ).then((outcome) => {
      if (!heard) return;
      dispatchCorrection({ type: "answered", attempt, outcome });
      // The Bill is not what the step showed: read it again. The step stays,
      // with the reason, when the record can still be corrected.
      if (outcome.outcome === "refused" && outcome.answer.changed?.canOpen) void revalidate();
    });
    return () => {
      heard = false;
    };
  }, [correctionAttempt]);

  // A new view takes the keyboard and the screen reader to its heading, which
  // says what happened: the step, that something is on its way, how it ended.
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [view]);

  // What is on its way is not left by accident (UI redesign §6.2).
  const unsure = (phase: string) => phase === "recording" || phase === "unknown";
  const unfinished = unsure(payment.phase) ? "payment" : unsure(correction.phase) ? "correction" : null;
  const guard = useLeaveGuard(unfinished !== null);

  // Whether a list is the history entry before this Bill, and whether the
  // step was reached from the Bill in this history: going back, not on to a
  // new entry, is what keeps the list's search, its pages and its place.
  const [cameFrom] = useState(() => listBehind(location.state));
  const listPath = cameFrom ?? "/cuentas-abiertas";
  const cameFromBill = useRef(false);
  /** From a step to the Bill, without leaving a second entry of the Bill behind. */
  function leaveStep() {
    if (cameFromBill.current) void navigate(-1);
    else void navigate(billPath, { replace: true });
  }
  const toBill = () => {
    setGoingOn(true);
    // Left while it was on its way: this is the Bill's entry already.
    if (!atStep) void revalidate();
    else leaveStep();
  };
  const toList = (event: MouseEvent) => {
    const entriesBack = !atStep ? 1 : cameFromBill.current ? 2 : null;
    if (cameFrom === null || entriesBack === null) return;
    event.preventDefault();
    void navigate(-entriesBack);
  };
  const listLink = (variant: "outline" | "default") => (
    <Link to={listReturn(listPath)} onClick={toList} className={`${buttonClasses({ size: "touch", variant })} ${variant === "outline" ? "self-start" : ""}`}>
      {variant === "outline" ? <BackDrawing /> : null}
      {listName(listPath)}
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

  /** The reason typed for the correction on screen, and for no other record. */
  const correcting = asked ? correctionKey(asked.intent, asked.targetId) : null;
  function sendCorrection() {
    if (correction.phase !== "editing" || !target || !plan || correcting === null) return;
    // Frozen at the tap, with the revision the step showed: a second tap finds
    // the correction already sent, and the server records it at most once.
    const snapshot = correctionSnapshot({ bill, target, plan, reason: reasonFor(correction, correcting) });
    if (!("problem" in snapshot)) dispatchCorrection({ type: "submitted", snapshot });
  }

  // The screen that sent a form reads its notice from the router's own data
  // (ticket 34); the loader's is the one a document POST left (spec §3.4).
  const answeredNotice = actionData && "notice" in actionData ? actionData.notice : null;
  const said = (answeredNotice ?? landingNotice)?.message ?? null;
  const refused = actionData && "error" in actionData ? actionData.error : null;
  // A Payment refused for a Bill that then owes nothing, or a correction
  // refused for a record that can no longer be corrected, has no step left to
  // be said on: the Bill says it, until this screen has something newer to
  // say. A correction whose step is still there says its refusal there.
  const refusedOf = correction.phase === "editing" && correction.refusal !== null && correction.target !== null ? correctionOfKey(correction.target) : null;
  const refusedTarget = refusedOf ? targetAt(bill, refusedOf) : null;
  const stepGone = refusedTarget === null || correctionPlan(bill, refusedTarget, isAdmin) === null;
  const stepRefusal =
    said !== null
      ? null
      : ((payment.phase === "editing" ? payment.refusal : null) ??
        (correction.phase === "editing" && stepGone ? correction.refusal : null));

  return (
    <>
      {sent === "payment" && payment.phase === "confirmed" ? (
        <Confirmed
          {...billPaymentOutcome(payment.snapshot, payment.result)}
          canOpen={payment.result.canOpen}
          heading={heading}
          list={listLink("default")}
          onOpenBill={toBill}
        >
          <Sent bill={bill} rows={sentPayment(payment.snapshot)} />
        </Confirmed>
      ) : sent === "payment" && payment.phase === "gone" ? (
        <Gone title="No se registró el pago" heading={heading} list={listLink("default")}>
          <Sent bill={bill} rows={sentPayment(payment.snapshot)} />
        </Gone>
      ) : sent === "payment" && (payment.phase === "recording" || payment.phase === "unknown") ? (
        <Pending
          recording={payment.phase === "recording"}
          title={billPaymentRecordingText(payment.snapshot)}
          unknown="El pago pudo registrarse o no. Volver a intentar no lo registra dos veces."
          ended="Tu sesión terminó antes de saberlo. Entra de nuevo y revisa Mi día antes de repetir el pago."
          sessionEnded={payment.phase === "unknown" && payment.sessionEnded}
          check={{ to: "/mi-dia", label: "Revisar en Mi día" }}
          heading={heading}
          onRetry={() => dispatch({ type: "retried" })}
        >
          <Sent bill={bill} rows={sentPayment(payment.snapshot)} />
        </Pending>
      ) : sent === "correction" && correction.phase === "confirmed" ? (
        <Confirmed
          {...correctionOutcome(correction.snapshot, correction.result)}
          canOpen={correction.result.canOpen}
          heading={heading}
          list={listLink("default")}
          onOpenBill={toBill}
        >
          <Sent bill={bill} rows={sentCorrection(correction.snapshot)} />
        </Confirmed>
      ) : sent === "correction" && correction.phase === "gone" ? (
        <Gone title="No se registró la corrección" heading={heading} list={listLink("default")}>
          <Sent bill={bill} rows={sentCorrection(correction.snapshot)} />
        </Gone>
      ) : sent === "correction" && (correction.phase === "recording" || correction.phase === "unknown") ? (
        <Pending
          recording={correction.phase === "recording"}
          title={correctionRecordingText(correction.snapshot)}
          // A Worker has no Historial to look in (spec §4.1): an Admin does.
          unknown={`La corrección pudo registrarse o no. Volver a intentar no la registra dos veces.${
            isAdmin ? "" : " Si sigue sin saberse, pide a un administrador que revise la cuenta."
          }`}
          ended="Tu sesión terminó antes de saberlo. Entra de nuevo y revisa la cuenta antes de repetir la corrección."
          sessionEnded={correction.phase === "unknown" && correction.sessionEnded}
          check={isAdmin ? { to: "/historial", label: "Revisar en Historial" } : null}
          heading={heading}
          onRetry={() => dispatchCorrection({ type: "retried" })}
        >
          <Sent bill={bill} rows={sentCorrection(correction.snapshot)} />
        </Pending>
      ) : view === "pay" && payment.phase === "editing" ? (
        <Pay
          bill={bill}
          payment={payment}
          heading={heading}
          onType={(draft) => dispatch({ type: "typed", draft })}
          onBack={leaveStep}
          onSend={send}
        />
      ) : view === "correct" && correction.phase === "editing" && target && plan && correcting !== null ? (
        <Correct
          // Another record is another step: what a tap found missing is its own.
          key={correcting}
          bill={bill}
          target={target}
          plan={plan}
          reason={reasonFor(correction, correcting)}
          refusal={correction.target === correcting ? correction.refusal : null}
          heading={heading}
          onType={(reason) => dispatchCorrection({ type: "typed", target: correcting, reason })}
          onBack={leaveStep}
          onSend={sendCorrection}
        />
      ) : (
        <Overview
          data={loaderData}
          heading={heading}
          error={refused ?? stepRefusal}
          said={said}
          list={listLink("outline")}
          payHref={`${billPath}?${PAY_STEP_PARAM}=${PAY_STEP}`}
          onPay={() => {
            cameFromBill.current = true;
            // The last Payment's refusal was about the Bill as it was.
            if (payment.phase === "editing") dispatch({ type: "typed", draft: payment.draft });
          }}
          onCorrect={(intent, targetId) => {
            cameFromBill.current = true;
            // What was typed for this record is kept; the last refusal was
            // about the Bill as it was.
            const opened = correctionKey(intent, targetId);
            dispatchCorrection({ type: "typed", target: opened, reason: reasonFor(correction, opened) });
          }}
        />
      )}

      <ConfirmDialog
        open={guard.asking}
        title={unfinished === "correction" ? "La corrección puede estarse registrando" : "El pago puede estarse registrando"}
        description={
          unfinished === "correction"
            ? "Salir no cancela el registro. Antes de repetir la corrección, revisa la cuenta."
            : "Salir no cancela el registro. Antes de repetir el pago, revisa Mi día."
        }
        confirm="Salir"
        cancel="Quedarme aquí"
        onConfirm={guard.leave}
        onCancel={guard.stay}
      />
    </>
  );
}

export default function Bill(props: Route.ComponentProps) {
  // Another Bill is another Payment and another correction: each starts from nothing.
  return <BillScreen key={props.loaderData.bill.id} {...props} />;
}
