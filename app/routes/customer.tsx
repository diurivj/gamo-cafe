import { type MouseEvent, type ReactNode, type RefObject, useEffect, useReducer, useRef, useState } from "react";
import { Effect } from "effect";
import { data, Form, Link, replace, useFetcher, useLocation, useNavigate, useRevalidator } from "react-router";

import { listCustomerHandovers, listCustomerOpenBills, listCustomerPastBills } from "~/backend/bills";
import { CurrentUser } from "~/backend/current-user";
import { editCustomer, getCustomer, restoreCustomer, retireCustomer } from "~/backend/customers";
import { run } from "~/backend/run.server";
import { BillStateBadge } from "~/components/bill-state-badge";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { BackDrawing, ChevronDrawing } from "~/components/icons";
import { Notice } from "~/components/notice";
import { LoadMore, usePagedList } from "~/components/paged-list";
import { PaymentEntry } from "~/components/payment-entry";
import { Change, Pending, SentRows, useLeaveGuard, useReadAgainSince } from "~/components/recording";
import { useRecorded } from "~/shared/recorded";
import { amount, figureRow, hint, pageTitle, rowCard, sectionTitle } from "~/components/styles";
import { SubmitButton } from "~/components/submit-button";
import { Badge } from "~/components/ui/badge";
import { Button, buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { answerWithNotice, takeNotice } from "~/notice.server";
import { requireUser } from "~/session.server";
import { CURSOR_PARAM, cursorOf, nextText } from "~/shared/cursor";
import { customerNameMessages } from "~/shared/customer-messages";
import {
  ABONAR_STEP,
  ABONAR_STEP_PARAM,
  customerPaymentAfter,
  type CustomerPaymentAnswer,
  customerPaymentBody,
  customerPaymentOutcome,
  customerPaymentRecordingText,
  type CustomerPaymentRefusal,
  type CustomerPaymentSnapshot,
  customerPaymentSnapshot,
  type CustomerPaymentState,
  isCustomerPaymentAnswer,
  NEW_CUSTOMER_PAYMENT,
} from "~/shared/customer-payment";
import { dayOf, formatDay, formatTime } from "~/shared/day";
import { newId } from "~/shared/id";
import { listReturn } from "~/shared/list-return";
import { formatMoney } from "~/shared/money";
import { useSaidNotice } from "~/shared/notice";
import { paymentMethodLabel } from "~/shared/payment";
import type { PaymentDraft } from "~/shared/payment-draft";
import { readPaymentDraft } from "~/shared/payment-draft";
import { paymentMessages } from "~/shared/payment-messages";
import { sendForRecord } from "~/shared/record-request";

import type { Route } from "./+types/customer";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.customer.name ?? "Cliente"} · Gamo Cafe` },
];

// Cliente (UI redesign §5.3, §7): one Customer, leading with who they are and
// what they owe, then their Open Bills, oldest first, and **Abonar**, which
// opens the step that takes one handover across them (`?paso=abonar`). Every
// User sees and collects; an Admin also renames, retires, restores and sees
// the Customer's past Bills — Pagadas and Canceladas, 50 per page — which a
// Worker is never sent (spec §4.1, §4.2). `canManage` only decides what the
// page offers: the operations refuse a Worker themselves.
//
// An Abonar is `~/shared/customer-payment`: typed, frozen at the tap, sent to
// `/clientes/:customerId/abonar` (`./resources/record-handover`) with the
// browser's own `fetch`, and kept on screen until the server's own answer
// says what happened. Nothing is read after it until the User asks.

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
  const past =
    user.role === "admin"
      ? await run(
          context,
          listCustomerPastBills(params.customerId, cursorOf(request.url)).pipe(
            Effect.provideService(CurrentUser, user),
          ),
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
    pastBills: past === null ? null : { bills: past.bills, next: nextText(past.next) },
    // What a retirement or a restoration that redirected here has to say (spec §3.4).
    notice: takeNotice(context),
  };
}

type Data = Route.ComponentProps["loaderData"];
/** The page of past Bills in the loader's answer; a Worker's has none. */
const pastPageOf = (data: Data) => ({ rows: data.pastBills?.bills ?? [], next: data.pastBills?.next ?? null });

/** The intents the Customer page's forms ask for. An Abonar is not one: it has its own route. */
const INTENTS = ["edit", "retire", "restore"] as const;

/**
 * The operation a submitted form asks for, as one program so that `run` sees
 * the union of every operation's errors.
 */
function programFor(id: string, form: FormData) {
  return Effect.gen(function* () {
    const intent = String(form.get("intent") ?? "");
    switch (intent) {
      case "edit":
        return yield* editCustomer(id, { name: String(form.get("name") ?? ""), note: String(form.get("note") ?? "") });
      case "retire":
        return yield* retireCustomer(id);
      case "restore":
        return yield* restoreCustomer(id);
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
    }
  });

  if (outcome && "error" in outcome) return data(outcome, { status: 400 });
  const page = `/clientes/${id}`;
  // A retirement and a restoration are harmless and reversible, and say so in
  // their own answer like a User's role does; the rename has nothing to say.
  if (intent === "retire" || intent === "restore") {
    return answerWithNotice(request, page, {
      message: intent === "retire" ? "Cliente retirado." : "Cliente restaurado.",
    });
  }
  return replace(page);
}

type Heading = RefObject<HTMLHeadingElement | null>;
type StateFetcher = ReturnType<typeof useFetcher<typeof action>>;
type OpenBill = Data["openBills"][number];
type PastBill = NonNullable<Data["pastBills"]>["bills"][number];

/** How many Open Bills hold what a Customer owes: "2 cuentas abiertas". */
const openBillsText = (count: number) => `${count} ${count === 1 ? "cuenta abierta" : "cuentas abiertas"}`;

/** What the Customer owes, first and largest, and in how many Open Bills; `named` on the step that collects it. */
function Owed({ data, named = false }: { readonly data: Data; readonly named?: boolean }) {
  const { customer, openBills, owed } = data;
  return (
    <Card size="sm" role="region" aria-label={named ? "Cliente" : "Resumen"}>
      <CardContent className="flex flex-col gap-1">
        {named ? <p className="border-b pb-3 text-xl font-semibold wrap-break-word">{customer.name}</p> : null}
        <p className={figureRow}>
          <span className="text-xl font-medium">Debe</span>{" "}
          <span className={`font-heading text-4xl font-semibold ${amount}`}>{formatMoney(owed)}</span>
        </p>
        <p className={hint}>{openBills.length === 0 ? "No debe nada." : `En ${openBillsText(openBills.length)}.`}</p>
      </CardContent>
    </Card>
  );
}

/** One of the Customer's Bills, as a row that opens it. Cuenta goes back to this page, not on to a list. */
function BillRow({ bill, from }: { readonly bill: OpenBill | PastBill; readonly from: string }) {
  return (
    <Link to={`/cuentas/${bill.id}`} state={{ fromList: from }} className="block rounded-2xl">
      <Card size="sm" className={rowCard}>
        <CardContent className="flex flex-col gap-2">
          <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <span className="text-xl font-semibold">{formatDay(bill.day)}</span>
            <BillStateBadge state={bill.state} />
          </span>
          {bill.state === "voided" || bill.state === "paid" ? null : (
            <span className={`${figureRow} border-t pt-2`}>
              <span className="font-medium">Debe</span>{" "}
              <span className={`font-heading text-2xl font-semibold ${amount}`}>{formatMoney(bill.owed)}</span>
            </span>
          )}
          <span className="flex flex-wrap items-center justify-between gap-x-3">
            <span className={`${amount} ${hint}`}>
              {`Total ${formatMoney(bill.total)} · Pagado ${formatMoney(bill.paid)}`}
            </span>
            <span className="inline-flex items-center gap-1 font-medium">
              Ver cuenta
              <ChevronDrawing className="size-5" />
            </span>
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

/** What only an Admin does to a Customer: the name and the note, and retiring or restoring them. */
function Manage({
  customer,
  retired,
  state,
  renameError,
  stateError,
}: {
  readonly customer: Data["customer"];
  /** As the page shows them: what was asked for while the form is on its way. */
  readonly retired: boolean;
  readonly state: StateFetcher;
  readonly renameError: string | null;
  readonly stateError: string | null;
}) {
  return (
    <section aria-label="Administrar cliente" className="flex flex-col gap-6 border-t pt-6">
      <h2 className={sectionTitle}>Administrar cliente</h2>

      {/* Keyed by what is stored, so the fields show it after saving. */}
      <Form key={`${customer.name}\n${customer.note}`} method="post" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={customer.name}
            autoComplete="off"
            maxLength={80}
            aria-invalid={renameError ? true : undefined}
            aria-describedby={renameError ? "name-error" : undefined}
          />
          {renameError ? (
            <Notice tone="error" id="name-error">
              {renameError}
            </Notice>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="note">Nota (opcional)</Label>
          <Input id="note" name="note" defaultValue={customer.note ?? ""} autoComplete="off" maxLength={200} />
        </div>
        <SubmitButton name="intent" value="edit" className={buttonClasses({ size: "touch", variant: "outline" })}>
          Guardar
        </SubmitButton>
      </Form>

      <state.Form method="post" className="flex flex-col gap-3">
        <p>
          {retired
            ? "Al restaurarlo vuelve a ofrecerse al vender."
            : "Al retirarlo deja de ofrecerse al vender y su nombre queda libre para otro cliente. Lo que debe se sigue cobrando aquí, y se puede restaurar después."}
        </p>
        {stateError ? <Notice tone="error">{stateError}</Notice> : null}
        <SubmitButton
          name="intent"
          value={retired ? "restore" : "retire"}
          fetcher={state}
          className={buttonClasses({ size: "touch", variant: "outline" })}
        >
          {retired ? "Restaurar cliente" : "Retirar cliente"}
        </SubmitButton>
      </state.Form>
    </section>
  );
}

/** The Customer: who they are and what they owe, the way to collect it, then their records. */
function Overview({
  data,
  heading,
  error,
  renameError,
  said,
  state,
  list,
  abonarHref,
  onAbonar,
}: {
  readonly data: Data;
  readonly heading: Heading;
  /** What an Abonar was refused for, when its step is no longer there to say it. */
  readonly error: string | null;
  readonly renameError: string | null;
  /** What a form of this page recorded. */
  readonly said: string | null;
  /** The fetcher that retires and restores. */
  readonly state: StateFetcher;
  readonly list: ReactNode;
  readonly abonarHref: string;
  readonly onAbonar: () => void;
}) {
  const { customer, openBills, owed, handovers, canManage, pastBills } = data;
  const customerPath = `/clientes/${customer.id}`;
  const past = usePagedList({
    id: "cuentas-pasadas",
    data,
    pageOf: pastPageOf,
    hrefFor: (cursor) => `${customerPath}?${CURSOR_PARAM}=${encodeURIComponent(cursor)}`,
  });
  // Retiring and restoring are harmless and reversible, so the page shows
  // them at once (spec §3.4): while the form is on its way the Customer is
  // what was asked for, and a refusal puts them back as the server has them.
  const asked = state.formData?.get("intent");
  const retired = asked === "retire" ? true : asked === "restore" ? false : customer.retiredAt !== null;
  const stateError = state.data && "error" in state.data ? state.data.error : null;

  return (
    <div className="flex flex-col gap-6">
      {list}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 ref={heading} tabIndex={-1} className={`${pageTitle} min-w-0 wrap-break-word outline-none`}>
            {customer.name}
          </h1>
          {retired ? <Badge variant="secondary">Retirado</Badge> : null}
        </div>
        {customer.note ? <p className="wrap-break-word">{customer.note}</p> : null}
        <p className={`${hint} wrap-break-word`}>
          Lo agregó {customer.addedBy.name} el {formatDay(dayOf(customer.addedAt))} a las {formatTime(customer.addedAt)}.
        </p>
        {retired ? (
          <div>
            <p>Ya no se puede elegir para cuentas nuevas.</p>
            <p>Sus cuentas abiertas se cobran igual.</p>
          </div>
        ) : null}
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {said ? <Notice tone="success">{said}</Notice> : null}

      <Owed data={data} />
      {owed > 0 ? (
        <Link to={abonarHref} onClick={onAbonar} className={buttonClasses({ size: "touch" })}>
          Abonar
        </Link>
      ) : null}

      <section aria-labelledby="cuentas-abiertas" className="flex flex-col gap-3">
        <h2 id="cuentas-abiertas" className={sectionTitle}>
          Cuentas abiertas
        </h2>
        {openBills.length === 0 ? (
          <p className={hint}>No tiene cuentas abiertas.</p>
        ) : (
          <>
            {openBills.length > 1 ? <p className={hint}>La más antigua primero: un abono las paga en este orden.</p> : null}
            <ul aria-label="Cuentas abiertas" className="flex flex-col gap-3">
              {openBills.map((bill) => (
                <li key={bill.id}>
                  <BillRow bill={bill} from={customerPath} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="abonos" className="flex flex-col gap-3">
        <h2 id="abonos" className={sectionTitle}>
          Abonos
        </h2>
        {handovers.length === 0 ? (
          <p className={hint}>Todavía no hay abonos.</p>
        ) : (
          <Card size="sm">
            <CardContent>
              <ul aria-label="Abonos" className="flex flex-col divide-y">
                {handovers.map((event) => (
                  <li
                    key={event.reference ?? event.id}
                    data-handover-event={event.reference ?? "uno"}
                    className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
                  >
                    <div className={figureRow}>
                      <span className="font-semibold">{paymentMethodLabel[event.method]}</span>{" "}
                      <span className={`ml-auto font-medium ${amount}`}>{formatMoney(event.amount)}</span>
                    </div>
                    <p className={`${hint} wrap-break-word`}>
                      {`${event.byName} · ${formatDay(event.day)} ${formatTime(event.at)}`}
                    </p>
                    {event.billCount > 1 ? <p className={hint}>{`Repartido en ${event.billCount} cuentas`}</p> : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>

      {pastBills ? (
        <section aria-labelledby="cuentas-pasadas" className="flex flex-col gap-3">
          <h2 id="cuentas-pasadas" className={sectionTitle}>
            Cuentas pasadas
          </h2>
          {past.rows.length === 0 ? (
            <p className={hint}>Todavía no hay cuentas pasadas.</p>
          ) : (
            <>
              <ul aria-label="Cuentas pasadas" className="flex flex-col gap-3">
                {past.rows.map((bill) => (
                  <li key={bill.id} data-past-bill-id={bill.id}>
                    <BillRow bill={bill} from={customerPath} />
                  </li>
                ))}
              </ul>
              <LoadMore more={past.more} />
            </>
          )}
        </section>
      ) : null}

      {canManage ? (
        <Manage customer={customer} retired={retired} state={state} renameError={renameError} stateError={stateError} />
      ) : null}
    </div>
  );
}

/** The step that takes a handover: the Customer, the Payment, and the one action that records it. */
function Abonar({
  data,
  handover,
  heading,
  onType,
  onBack,
  onSend,
}: {
  readonly data: Data;
  readonly handover: Extract<CustomerPaymentState, { phase: "editing" }>;
  readonly heading: Heading;
  readonly onType: (draft: PaymentDraft) => void;
  readonly onBack: () => void;
  readonly onSend: () => void;
}) {
  // Whether a tap on the action found the handover could not be recorded yet.
  const [insist, setInsist] = useState(false);
  const paying = readPaymentDraft(handover.draft, data.owed, paymentMessages.CustomerPaymentExceedsOwed);

  return (
    <div className="flex flex-col gap-6">
      <Button type="button" variant="outline" size="touch" onClick={onBack} className="self-start">
        <BackDrawing className="size-5" />
        Volver al cliente
      </Button>
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        Abonar
      </h1>

      <Owed data={data} named />
      {handover.refusal ? <Notice tone="error">{handover.refusal}</Notice> : null}

      <section aria-labelledby="abono" className="flex flex-col gap-4">
        <h2 id="abono" className={sectionTitle}>
          Abono
        </h2>
        <div>
          {data.openBills.length > 1 ? <p>Paga primero la cuenta más antigua.</p> : null}
          <p className={hint}>Si pagan una parte en efectivo y otra por transferencia, registra un abono por cada una.</p>
        </div>
        <PaymentEntry
          value={handover.draft}
          onChange={onType}
          full={data.owed}
          tooMuch={paymentMessages.CustomerPaymentExceedsOwed}
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
        {paying.amount === null ? "Registrar abono" : `Registrar abono de ${formatMoney(paying.amount)}`}
      </Button>
    </div>
  );
}

/** What was sent, for as long as it is on screen: whose it is and what it carried. */
function Sent({ snapshot }: { readonly snapshot: CustomerPaymentSnapshot }) {
  return (
    <SentRows
      rows={[
        ["Cliente", snapshot.customerName],
        ["Abono", `${formatMoney(snapshot.amount)} · ${paymentMethodLabel[snapshot.method]}`],
      ]}
    />
  );
}

/** What the server confirmed, kept until the User goes on (UI redesign §5.4). */
function Confirmed({
  handover,
  heading,
  onOpenCustomer,
  onAnother,
}: {
  readonly handover: Extract<CustomerPaymentState, { phase: "confirmed" }>;
  readonly heading: Heading;
  readonly onOpenCustomer: () => void;
  /** Part in cash and part by transfer are two handovers, one after the other (UI redesign §5.3). */
  readonly onAnother: () => void;
}) {
  const { title, details, change } = customerPaymentOutcome(handover.snapshot, handover.result);
  useRecorded(title, details);
  return (
    <div className="flex flex-col gap-6">
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        {title}
      </h1>
      <Notice tone="success">{details}</Notice>
      {change !== null ? <Change amount={change} /> : null}

      <div className="flex flex-col gap-3">
        <Button type="button" size="touch" onClick={onOpenCustomer}>
          Ver cliente
        </Button>
        {handover.result.owed > 0 ? (
          <Button type="button" variant="outline" size="touch" onClick={onAnother}>
            Registrar otro abono
          </Button>
        ) : null}
      </div>

      <Sent snapshot={handover.snapshot} />
    </div>
  );
}

/** The lists a Customer is opened from, and what the way back to each is called. */
const LISTS: Readonly<Record<string, string>> = {
  "/clientes": "Clientes",
  "/por-cobrar": "Por cobrar",
};

/** The list whose row led here, when its link said so (`state={{ fromList }}`). */
function listBehind(state: unknown): string | null {
  const from = (state as { readonly fromList?: unknown } | null)?.fromList;
  return typeof from === "string" && Object.hasOwn(LISTS, from) ? from : null;
}

function CustomerScreen({ loaderData, actionData }: Route.ComponentProps) {
  const { customer, openBills, owed, notice: landingNotice } = loaderData;
  const [handover, dispatch] = useReducer(customerPaymentAfter, NEW_CUSTOMER_PAYMENT);
  const location = useLocation();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  const customerPath = `/clientes/${customer.id}`;
  const abonarHref = `${customerPath}?${ABONAR_STEP_PARAM}=${ABONAR_STEP}`;
  const atStep = new URLSearchParams(location.search).get(ABONAR_STEP_PARAM) === ABONAR_STEP;
  const canCollect = owed > 0;

  // A result stays until the User goes on (UI redesign §5.4): only a read
  // they asked for, with **Ver cliente** or **Registrar otro abono**, makes it
  // give way to the Customer as they are now. A read that was already on its
  // way when the answer came — the step left while it was recording — is not
  // that, and takes neither the result nor its change off the screen.
  const [goingOn, setGoingOn] = useState(false);
  const recordedAndLeft = useReadAgainSince(handover.phase === "confirmed" && goingOn, loaderData);
  useEffect(() => {
    if (!recordedAndLeft) return;
    dispatch({ type: "started" });
    setGoingOn(false);
  }, [recordedAndLeft]);

  // What was sent stays on screen whatever the address says.
  const sent = handover.phase !== "editing" && !recordedAndLeft;
  const view = sent ? handover.phase : handover.phase === "editing" && atStep && canCollect ? "abonar" : "customer";

  // A step with nothing to collect is the Customer: after a reload, or once
  // another phone collected it all. The address follows.
  const stray = handover.phase === "editing" && atStep && !canCollect;
  useEffect(() => {
    if (stray) leaveStep();
  }, [stray]);

  // A refusal is said on the step it was sent from. Going back from that step
  // leaves it there: the Customer's page keeps only one it has no step for.
  const wasAtStep = useRef(atStep);
  useEffect(() => {
    const left = wasAtStep.current && !atStep;
    wasAtStep.current = atStep;
    if (left && canCollect && handover.phase === "editing" && handover.refusal !== null) {
      dispatch({ type: "typed", draft: handover.draft });
    }
  }, [atStep]);

  // A snapshot is sent once per attempt, and only its own answer is heard.
  const attempt = handover.phase === "recording" ? handover.attempt : 0;
  useEffect(() => {
    if (handover.phase !== "recording") return;
    const { snapshot } = handover;
    let heard = true;
    void sendForRecord<CustomerPaymentAnswer, CustomerPaymentRefusal>(
      `${customerPath}/abonar`,
      customerPaymentBody(snapshot),
      isCustomerPaymentAnswer,
    ).then((outcome) => {
      if (!heard) return;
      dispatch({ type: "answered", key: snapshot.key, outcome });
      // The Bills are not what the screen showed: read them again, and the
      // handover as it was typed is checked against what is owed now.
      if (outcome.outcome === "refused" && outcome.answer.changed) void revalidate();
    });
    return () => {
      heard = false;
    };
  }, [attempt]);

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
  const guard = useLeaveGuard(handover.phase === "recording" || handover.phase === "unknown");

  // Whether a list is the history entry before this Customer, and whether
  // the step was reached from the Customer in this history: going back, not
  // on to a new entry, is what keeps the list's search and its place.
  const [cameFrom] = useState(() => listBehind(location.state));
  const listPath = cameFrom ?? "/clientes";
  const cameFromCustomer = useRef(false);
  /** From the step to the Customer, without leaving a second entry of the Customer behind. */
  function leaveStep() {
    if (cameFromCustomer.current) void navigate(-1);
    else void navigate(customerPath, { replace: true });
  }
  const toCustomer = () => {
    setGoingOn(true);
    // Left while it was on its way: this is the Customer's entry already.
    if (!atStep) void revalidate();
    else leaveStep();
  };
  const toAnother = () => {
    // Reading the Customer again is what ends the result and starts the next
    // handover, with the Bills and revisions as they are now.
    setGoingOn(true);
    if (atStep) void revalidate();
    else {
      cameFromCustomer.current = true;
      void navigate(abonarHref);
    }
  };
  const toList = (event: MouseEvent) => {
    const entriesBack = !atStep ? 1 : cameFromCustomer.current ? 2 : null;
    if (cameFrom === null || entriesBack === null) return;
    event.preventDefault();
    void navigate(-entriesBack);
  };

  function send() {
    if (handover.phase !== "editing") return;
    // Frozen at the tap, with a key of its own: a second tap finds the
    // handover already sent and changes nothing.
    const snapshot = customerPaymentSnapshot({
      draft: handover.draft,
      customer: { id: customer.id, name: customer.name, owed, bills: openBills },
      key: newId(),
    });
    if (!("problem" in snapshot)) dispatch({ type: "submitted", snapshot });
  }

  const renameError = actionData && "error" in actionData ? actionData.error : null;
  // The last notice the page said: the fetcher's own answer for a retirement
  // and a restoration, or the one a document POST left for the loader (spec
  // §3.4, ticket 34). Kept here, so a visit to the step does not say it again.
  const state = useFetcher<typeof action>({ key: `customer-state:${customer.id}` });
  const stateNotice = state.data && "notice" in state.data ? state.data.notice : null;
  const [said] = useSaidNotice(landingNotice, stateNotice);

  return (
    <>
      {sent && handover.phase === "confirmed" ? (
        <Confirmed handover={handover} heading={heading} onOpenCustomer={toCustomer} onAnother={toAnother} />
      ) : sent && (handover.phase === "recording" || handover.phase === "unknown") ? (
        <Pending
          recording={handover.phase === "recording"}
          title={customerPaymentRecordingText(handover.snapshot)}
          unknown="El abono pudo registrarse o no. Volver a intentar no lo registra dos veces."
          ended="Tu sesión terminó antes de saberlo. Entra de nuevo y revisa Mi día antes de repetir el abono."
          sessionEnded={handover.phase === "unknown" && handover.sessionEnded}
          check={{ to: "/mi-dia", label: "Revisar en Mi día" }}
          heading={heading}
          onRetry={() => dispatch({ type: "retried" })}
        >
          <Sent snapshot={handover.snapshot} />
        </Pending>
      ) : view === "abonar" && handover.phase === "editing" ? (
        <Abonar
          data={loaderData}
          handover={handover}
          heading={heading}
          onType={(draft) => dispatch({ type: "typed", draft })}
          onBack={() => {
            // What the step said stays on the step.
            dispatch({ type: "typed", draft: handover.draft });
            leaveStep();
          }}
          onSend={send}
        />
      ) : (
        <Overview
          data={loaderData}
          heading={heading}
          // A refusal with no step to be said on: the Customer owes nothing
          // any more, or the step was left while the handover was on its way.
          error={handover.phase === "editing" ? handover.refusal : null}
          renameError={renameError}
          said={said?.message ?? null}
          state={state}
          list={
            <Link
              to={listReturn(listPath)}
              onClick={toList}
              className={`${buttonClasses({ size: "touch", variant: "outline" })} self-start`}
            >
              <BackDrawing className="size-5" />
              {LISTS[listPath]}
            </Link>
          }
          abonarHref={abonarHref}
          onAbonar={() => {
            cameFromCustomer.current = true;
            // The last handover's refusal was about the Bills as they were.
            if (handover.phase === "editing") dispatch({ type: "typed", draft: handover.draft });
          }}
        />
      )}

      <ConfirmDialog
        open={guard.asking}
        title="El abono puede estarse registrando"
        description="Salir no cancela el registro. Antes de repetir el abono, revisa Mi día."
        confirm="Salir"
        cancel="Quedarme aquí"
        onConfirm={guard.leave}
        onCancel={guard.stay}
      />
    </>
  );
}

export default function Customer(props: Route.ComponentProps) {
  // Another Customer is another handover: each starts from nothing.
  return <CustomerScreen key={props.loaderData.customer.id} {...props} />;
}
