import { type ReactNode, type RefObject, useEffect, useId, useReducer, useRef, useState } from "react";
import {
  Link,
  type ShouldRevalidateFunctionArgs,
  useBlocker,
  useLocation,
  useNavigate,
  useOutletContext,
  useRevalidator,
} from "react-router";
import { Effect } from "effect";

import { getBill } from "~/backend/bills";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { CustomerPicker } from "~/components/customer-picker";
import { BackDrawing, CategoryDrawing, CheckDrawing, StepDrawing } from "~/components/icons";
import { Notice } from "~/components/notice";
import { PaymentEntry } from "~/components/payment-entry";
import { useRecorded } from "~/shared/recorded";
import { amount, figureRow, hint, pageTitle, sectionTitle } from "~/components/styles";
import { Change } from "~/components/recording";
import { StickyBar } from "~/components/sticky-bar";
import { Button, buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { requireUser } from "~/session.server";
import { categoryDrawing } from "~/shared/category-drawing";
import { newId } from "~/shared/id";
import { formatMoney } from "~/shared/money";
import { normalizeName } from "~/shared/normalize-name";
import { paymentMethodLabel } from "~/shared/payment";
import { readPaymentDraft } from "~/shared/payment-draft";
import { paymentMessages } from "~/shared/payment-messages";
import { sendForRecord } from "~/shared/record-request";
import {
  isSaleAnswer,
  linesOf,
  NEW_SALE,
  onlyStepChanged,
  recordingText,
  REVIEW_STEP,
  saleAfter,
  type SaleAnswer,
  saleBody,
  type SaleEvent,
  type SaleIntent,
  saleOutcome,
  type SaleRefusal,
  type SaleSnapshot,
  type SaleState,
  sameSale,
  snapshotOf,
  STEP_PARAM,
  unitsText,
} from "~/shared/sale";

import type { Route } from "./+types/home";
import type { SellItems } from "./sell-items";

// Vender (UI redesign §5, §6): one sale at a time, in two steps. Step 1
// chooses the Items; step 2 (`?paso=cobrar`) reviews them and records a
// Payment or leaves the Bill Open. The sale is then sent once, frozen, and the
// screen keeps it until the server's own answer says what happened; only
// **Nueva venta** starts another. With `?billId=`, Cuenta's **Agregar
// productos** turns it into the same flow targeting one Open Bill.
//
// The sale's state and every rule about it are `~/shared/sale`. It is sent to
// `/vender/registrar` (`./resources/record-sale`) with the browser's own
// `fetch`, so a request that fails leaves this screen, and what a safe retry
// needs, in place. The Items come from the layout around it, `./sell-items`.

export const meta: Route.MetaFunction = () => [{ title: "Vender · Gamo Cafe" }];

/** Where a sale is sent (`app/routes.ts`). */
const RECORD_PATH = "/vender/registrar";

export async function loader({ context, request }: Route.LoaderArgs) {
  const user = requireUser(context);
  const billId = new URL(request.url).searchParams.get("billId") ?? "";
  if (billId === "") return { target: null };

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
  return { target };
}

/**
 * The target Bill is read when Vender is opened for it; the two steps of a
 * sale differ only in `?paso=`. A sale is answered with the Bill as it left
 * it, so nothing is read again after one, and no failed read can take a
 * confirmed sale off the screen.
 */
export function shouldRevalidate({ currentUrl, defaultShouldRevalidate, nextUrl }: ShouldRevalidateFunctionArgs) {
  return onlyStepChanged(currentUrl, nextUrl) ? false : defaultShouldRevalidate;
}

type Target = NonNullable<Route.ComponentProps["loaderData"]["target"]>;
type Heading = RefObject<HTMLHeadingElement | null>;

/** The Open Bill the selection is added to, always in sight (UI redesign §5.3). */
function TargetBill({ target }: { readonly target: Target }) {
  return (
    <Card size="sm" role="region" aria-label="Cuenta destino">
      <CardContent className="flex flex-col gap-1">
        <p className="font-medium">
          {target.customer
            ? `Se agrega a la cuenta de ${target.customer.name}`
            : "Se agrega a una cuenta sin cliente"}
        </p>
        <p className={hint}>{`Total ${formatMoney(target.total)} · Debe ${formatMoney(target.owed)}`}</p>
        <Link
          to={`/cuentas/${target.id}`}
          className="inline-flex min-h-12 items-center self-start font-medium underline underline-offset-4"
        >
          Ver cuenta
        </Link>
      </CardContent>
    </Card>
  );
}

/** A selection's Lines and total: what step 2 reviews, and what a sent sale keeps showing. */
function Selection({ snapshot }: { readonly snapshot: Pick<SaleSnapshot, "lines" | "total"> }) {
  const id = useId();
  return (
    <Card size="sm" role="region" aria-labelledby={id}>
      <CardContent className="flex flex-col gap-3">
        <h2 id={id} className={sectionTitle}>
          Selección
        </h2>
        <ul className="flex flex-col gap-2">
          {snapshot.lines.map((line) => (
            <li key={line.itemId} className={figureRow}>
              <span className="min-w-0 wrap-break-word">
                <span className="font-semibold tabular-nums">{line.quantity} ×</span> {line.name}
              </span>{" "}
              <span className={`ml-auto ${amount}`}>{formatMoney(line.unitPrice * line.quantity)}</span>
            </li>
          ))}
        </ul>
        <p className={`${figureRow} border-t pt-3 text-xl font-semibold`}>
          <span>Total</span> <span className={amount}>{formatMoney(snapshot.total)}</span>
        </p>
      </CardContent>
    </Card>
  );
}

/** Step 1: the Items by Category, a search, and the total with the way forward. */
function Catalog({
  sale,
  dispatch,
  target,
  heading,
  onReview,
}: {
  readonly sale: Extract<SaleState, { phase: "editing" }>;
  readonly dispatch: (event: SaleEvent) => void;
  readonly target: Target | null;
  readonly heading: Heading;
  readonly onReview: () => void;
}) {
  const { categories } = useOutletContext<SellItems>();
  const searchId = useId();
  const [typed, setTyped] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const { quantities } = sale.draft;
  const offered = categories
    .map((category) => ({ ...category, items: category.items.filter((item) => !sale.unavailable.includes(item.id)) }))
    .filter((category) => category.items.length > 0);
  const { total, units } = linesOf(quantities, offered.flatMap((category) => category.items));

  const wanted = normalizeName(typed);
  const shown = offered
    .filter((category) => categoryId === null || category.id === categoryId)
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => normalizeName(item.name).includes(wanted)),
    }))
    .filter((category) => category.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
          Vender
        </h1>
        {units > 0 ? (
          <Button type="button" variant="outline" size="touch" onClick={() => setClearing(true)}>
            Vaciar
          </Button>
        ) : null}
      </div>

      {target ? <TargetBill target={target} /> : null}
      {sale.refusal ? <Notice tone="error">{sale.refusal}</Notice> : null}

      {offered.length === 0 ? (
        <p className={hint}>Todavía no hay productos. Pídele a un administrador que agregue el menú.</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor={searchId}>Buscar producto</Label>
            <Input
              id={searchId}
              type="search"
              value={typed}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>

          {offered.length > 1 ? (
            <div role="group" aria-label="Categoría" className="flex flex-wrap gap-2">
              {[{ id: null, name: "Todas" }, ...offered].map((category) => {
                const on = category.id === categoryId;
                return (
                  <Button
                    key={category.id ?? ""}
                    type="button"
                    variant="outline"
                    size="touch"
                    aria-pressed={on}
                    onClick={() => setCategoryId(category.id)}
                    // The one that is on is told by its mark and weight, not only its fill.
                    className="min-h-12 px-4 py-2 aria-pressed:border-foreground aria-pressed:bg-muted aria-pressed:font-semibold"
                  >
                    {on ? <CheckDrawing className="size-5" /> : null}
                    {category.name}
                  </Button>
                );
              })}
            </div>
          ) : null}

          {shown.length === 0 ? <p className={hint}>Ningún producto coincide.</p> : null}

          {shown.map((category) => {
            const drawing = categoryDrawing(category.name);
            return (
              <section key={category.id} aria-labelledby={`categoria-${category.id}`} className="flex flex-col gap-3">
                <h2 id={`categoria-${category.id}`} className="flex items-center gap-2 font-heading text-xl font-semibold">
                  {drawing ? <CategoryDrawing name={drawing} className="size-7 text-muted-foreground" /> : null}
                  {category.name}
                </h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {category.items.map((item) => {
                    const quantity = quantities[item.id] ?? 0;
                    return (
                      // One cell: the Item, which adds a unit wherever it is
                      // tapped, and over it the room its quantity takes, so
                      // nothing moves when the first unit is added. That room
                      // is at its end, or under the name where the two do not
                      // fit side by side: a narrow phone with large text.
                      <li key={item.id} className="@container grid">
                        <Button
                          type="button"
                          variant="outline"
                          size="touch"
                          onClick={() => dispatch({ type: "changed", itemId: item.id, by: 1 })}
                          className={`col-start-1 row-start-1 min-h-16 flex-col items-start justify-center gap-0 rounded-2xl px-4 pt-2 pb-16 text-left @[17rem]:pr-40 @[17rem]:pb-2 ${
                            quantity > 0 ? "border-foreground" : ""
                          }`}
                        >
                          <span className="font-medium wrap-break-word">{item.name}</span>
                          <span className="text-muted-foreground tabular-nums">{formatMoney(item.price)}</span>
                        </Button>
                        {quantity > 0 ? (
                          <div className="z-1 col-start-1 row-start-1 flex items-center gap-1 self-end justify-self-end pr-2 pb-2 @[17rem]:self-center @[17rem]:pb-0">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-touch"
                              aria-label={`Quitar uno de ${item.name}`}
                              onClick={() => dispatch({ type: "changed", itemId: item.id, by: -1 })}
                            >
                              <StepDrawing by={-1} />
                            </Button>
                            <span
                              aria-label={`${quantity} de ${item.name}`}
                              className="min-w-8 text-center text-xl font-semibold tabular-nums"
                            >
                              {quantity}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-touch"
                              aria-label={`Agregar uno de ${item.name}`}
                              onClick={() => dispatch({ type: "changed", itemId: item.id, by: 1 })}
                            >
                              <StepDrawing by={1} />
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      )}

      {/* What the selection adds up to, said when it changes. */}
      <p aria-live="polite" className="sr-only">
        {units > 0 ? `${unitsText(units)}, total ${formatMoney(total)}` : ""}
      </p>
      {units > 0 ? (
        // Rests just above the navigation bar, never under it.
        <StickyBar>
          <Card size="sm" role="region" aria-label="Total" className="shadow-lg ring-foreground/25">
            <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <p className="min-w-0">
                <span className={`block ${hint}`}>{unitsText(units)}</span>
                <span className={`block font-heading text-2xl leading-tight font-semibold ${amount}`}>
                  {formatMoney(total)}
                </span>
              </p>
              <Button type="button" size="touch" onClick={onReview}>
                {target ? "Continuar" : "Cobrar"}
              </Button>
            </CardContent>
          </Card>
        </StickyBar>
      ) : offered.length > 0 ? (
        <p className={hint}>Toca un producto para agregarlo.</p>
      ) : null}

      {units === 0 ? (
        // After a phone restart nothing here knows what the last sale became.
        <div>
          <p className={hint}>¿No sabes si una venta se registró?</p>
          <Link
            to="/mi-dia"
            className="inline-flex min-h-12 items-center font-medium underline underline-offset-4"
          >
            Revísala en Mi día
          </Link>
        </div>
      ) : null}

      <ConfirmDialog
        open={clearing}
        title="¿Vaciar la selección?"
        description={`Se ${units === 1 ? "quitará" : "quitarán"} ${unitsText(units)} y lo escrito para esta venta.`}
        confirm="Vaciar"
        cancel="Conservar"
        onConfirm={() => {
          setClearing(false);
          dispatch({ type: "cleared" });
        }}
        onCancel={() => setClearing(false)}
      />
    </div>
  );
}

/** Step 2: the selection, who it is for, and the Payment or leaving it Open. */
function Review({
  sale,
  dispatch,
  target,
  heading,
  onBack,
  onSend,
}: {
  readonly sale: Extract<SaleState, { phase: "editing" }>;
  readonly dispatch: (event: SaleEvent) => void;
  readonly target: Target | null;
  readonly heading: Heading;
  readonly onBack: () => void;
  readonly onSend: (intent: SaleIntent) => void;
}) {
  const { categories } = useOutletContext<SellItems>();
  const noteId = useId();
  // Whether a tap on the Payment's action found it could not be recorded yet.
  const [insist, setInsist] = useState(false);

  const { fields } = sale.draft;
  const selection = linesOf(sale.draft.quantities, categories.flatMap((category) => category.items));
  const paying = readPaymentDraft(fields.payment, selection.total, paymentMessages.PaymentExceedsSelection);
  const send = (intent: SaleIntent) => {
    // The field says what is missing; nothing is sent until it can be read.
    if (intent === "cobrar" && paying.amount === null) setInsist(true);
    else onSend(intent);
  };

  const pay = (
    <Button key="pay" type="button" size="touch" variant={target ? "outline" : "default"} onClick={() => send("cobrar")}>
      {paying.amount === null ? "Registrar pago" : `Registrar pago de ${formatMoney(paying.amount)}`}
    </Button>
  );
  const leaveOpen = (
    <div key="open" className="flex flex-col gap-2">
      <Button type="button" size="touch" variant={target ? "default" : "outline"} onClick={() => send("dejar-abierta")}>
        {target ? "Agregar a la cuenta" : "Dejar abierta"}
      </Button>
      <p className={hint}>
        {target ? "Sin pago." : "Sin pago: la cuenta queda abierta."}
      </p>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <Button type="button" variant="outline" size="touch" onClick={onBack} className="self-start">
        <BackDrawing />
        Cambiar productos
      </Button>
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        {target ? "Agregar a la cuenta" : "Cobrar"}
      </h1>

      {target ? <TargetBill target={target} /> : null}
      {sale.refusal ? <Notice tone="error">{sale.refusal}</Notice> : null}

      <Selection snapshot={selection} />

      {/* A Bill's Customer and note are set when it is opened, or on Cuenta. */}
      {target ? null : (
        <section aria-labelledby="cliente-y-nota" className="flex flex-col gap-4">
          <h2 id="cliente-y-nota" className={sectionTitle}>
            Cliente y nota (opcionales)
          </h2>
          <CustomerPicker
            defaultValue={fields.customer}
            onChange={(customer) => dispatch({ type: "fields", fields: { customer } })}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor={noteId}>Nota (opcional)</Label>
            <Input
              id={noteId}
              maxLength={80}
              autoComplete="off"
              value={fields.note}
              onChange={(event) => dispatch({ type: "fields", fields: { note: event.target.value } })}
            />
          </div>
        </section>
      )}

      <section aria-labelledby="pago" className="flex flex-col gap-4">
        <h2 id="pago" className={sectionTitle}>
          Pago
        </h2>
        <PaymentEntry
          value={fields.payment}
          onChange={(payment) => dispatch({ type: "fields", fields: { payment } })}
          full={selection.total}
          tooMuch={paymentMessages.PaymentExceedsSelection}
          insist={insist}
        />
      </section>

      {/* The usual action leads: paying a new sale, adding to a Bill that is already Open. */}
      <div className="flex flex-col gap-4">{target ? [leaveOpen, pay] : [pay, leaveOpen]}</div>
    </div>
  );
}

/** What a sale that was sent carried, and the Bill it targets, for as long as it is on screen. */
function Sent({ snapshot, target }: { readonly snapshot: SaleSnapshot; readonly target: Target | null }) {
  return (
    <>
      <Selection snapshot={snapshot} />
      {target || snapshot.customer || snapshot.note || snapshot.payment ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {target ? (
            <SentField label="Cuenta">{target.customer ? `De ${target.customer.name}` : "Sin cliente"}</SentField>
          ) : null}
          {snapshot.customer ? <SentField label="Cliente">{snapshot.customer.name}</SentField> : null}
          {snapshot.note ? <SentField label="Nota">{snapshot.note}</SentField> : null}
          {snapshot.payment ? (
            <SentField label="Pago">
              {`${formatMoney(snapshot.payment.amount)} · ${paymentMethodLabel[snapshot.payment.method]}`}
            </SentField>
          ) : null}
        </dl>
      ) : null}
    </>
  );
}

function SentField({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className={hint}>{label}</dt>
      <dd className="min-w-0 font-medium wrap-break-word">{children}</dd>
    </>
  );
}

/** A sale on its way, or one nobody knows the outcome of: frozen, with only safe ways on. */
function Pending({
  sale,
  target,
  heading,
  onRetry,
}: {
  readonly sale: Extract<SaleState, { phase: "recording" | "unknown" }>;
  readonly target: Target | null;
  readonly heading: Heading;
  readonly onRetry: () => void;
}) {
  const recording = sale.phase === "recording";
  return (
    <div className="flex flex-col gap-6" aria-busy={recording}>
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        {recording ? recordingText(sale.snapshot) : "No sabemos si se registró"}
      </h1>
      {recording ? (
        <Notice tone="info">Espera la confirmación.</Notice>
      ) : (
        <>
          <Notice tone="info">
            {sale.sessionEnded
              ? "Tu sesión terminó antes de saberlo. Entra de nuevo y revisa Mi día antes de repetir la venta."
              : "La venta pudo registrarse o no. Volver a intentar no la registra dos veces."}
          </Notice>
          <div className="flex flex-col gap-3">
            {sale.sessionEnded ? (
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
      <Sent snapshot={sale.snapshot} target={target} />
    </div>
  );
}

/** What the server confirmed, kept until **Nueva venta** (UI redesign §5.4). */
function Confirmed({
  sale,
  target,
  heading,
  onNewSale,
}: {
  readonly sale: Extract<SaleState, { phase: "confirmed" }>;
  readonly target: Target | null;
  readonly heading: Heading;
  readonly onNewSale: () => void;
}) {
  const { snapshot, result } = sale;
  const outcome = saleOutcome(snapshot, result);
  useRecorded(outcome.title, outcome.details);

  return (
    // The Bill, for what follows the sale: a test, or a tool, reads it here.
    <div data-bill-id={result.billId} className="flex flex-col gap-6">
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        {outcome.title}
      </h1>
      <Notice tone="success">{outcome.details}</Notice>

      {outcome.change !== null ? (
        <Change amount={outcome.change} />
      ) : null}

      <div className="flex flex-col gap-3">
        <Button type="button" size="touch" onClick={onNewSale}>
          Nueva venta
        </Button>
        {/* Only a Bill this User may open: a Worker is not sent to a Paid one. */}
        {result.canOpen ? (
          <Link to={`/cuentas/${result.billId}`} className={buttonClasses({ variant: "outline", size: "touch" })}>
            {target ? "Volver a la cuenta" : "Ver cuenta"}
          </Link>
        ) : null}
      </div>

      <Sent snapshot={snapshot} target={target} />
    </div>
  );
}

function Sale({ target }: { readonly target: Target | null }) {
  const { categories } = useOutletContext<SellItems>();
  const [sale, dispatch] = useReducer(saleAfter, NEW_SALE);
  const location = useLocation();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  const items = categories.flatMap((category) => category.items);
  const selecting = sale.phase === "editing" && linesOf(sale.draft.quantities, items).units > 0;
  const atReview = new URLSearchParams(location.search).get(STEP_PARAM) === REVIEW_STEP;
  const view = sale.phase !== "editing" ? sale.phase : atReview && selecting ? "review" : "catalog";

  const stepAddress = (review: boolean) => {
    const search = new URLSearchParams(location.search);
    if (review) search.set(STEP_PARAM, REVIEW_STEP);
    else search.delete(STEP_PARAM);
    return { pathname: location.pathname, search: search.toString() };
  };

  // The review step of an empty selection is step 1: after Nueva venta, after
  // a reload, after the last Item was refused. The address follows.
  const stray = sale.phase === "editing" && atReview && !selecting;
  useEffect(() => {
    if (stray) void navigate(stepAddress(false), { replace: true });
  }, [stray]);

  // A snapshot is sent once per attempt, and only its own answer is heard.
  const attempt = sale.phase === "recording" ? sale.attempt : 0;
  useEffect(() => {
    if (sale.phase !== "recording") return;
    const { snapshot } = sale;
    let heard = true;
    void sendForRecord<SaleAnswer, SaleRefusal>(RECORD_PATH, saleBody(snapshot), isSaleAnswer).then((outcome) => {
      if (!heard) return;
      dispatch({ type: "answered", key: snapshot.key, outcome });
      // The total the screen showed may not be today's: read the Items again.
      if (outcome.outcome === "refused" && outcome.answer.stalePrices) void revalidate();
    });
    return () => {
      heard = false;
    };
  }, [attempt]);

  // A new view takes the keyboard and the screen reader to its heading, which
  // says what happened: the step, that the sale is on its way, how it ended.
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [view]);

  // Unfinished work is not left by accident (UI redesign §6.2). Moving
  // between the two steps is not leaving; a confirmed sale has nothing to lose.
  const unfinished = selecting || sale.phase === "recording" || sale.phase === "unknown";
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => unfinished && !sameSale(currentLocation, nextLocation),
  );
  // Confirmed while the question was on screen: there is nothing left to
  // ask about, and the result is what the User has to see.
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

  // Whether step 2 was reached from step 1 in this history, so Back is one step back.
  const cameFromCatalog = useRef(false);

  function send(intent: SaleIntent) {
    if (sale.phase !== "editing") return;
    // Frozen at the tap, with a key of its own: a second tap finds the sale
    // already sent and changes nothing.
    const snapshot = snapshotOf({ draft: sale.draft, items, billId: target?.id ?? null, intent, key: newId() });
    if (!("problem" in snapshot)) dispatch({ type: "submitted", snapshot });
  }

  function newSale() {
    // The next sale is a new one, not more for the Bill this one was added
    // to: without the target, the screen starts over by itself.
    if (target) void navigate("/", { replace: true });
    else dispatch({ type: "started" });
  }

  const draft = sale.phase === "editing";
  return (
    <>
      {sale.phase === "confirmed" ? (
        <Confirmed sale={sale} target={target} heading={heading} onNewSale={newSale} />
      ) : sale.phase !== "editing" ? (
        <Pending sale={sale} target={target} heading={heading} onRetry={() => dispatch({ type: "retried" })} />
      ) : view === "review" ? (
        <Review
          sale={sale}
          dispatch={dispatch}
          target={target}
          heading={heading}
          onSend={send}
          onBack={() => {
            if (cameFromCatalog.current) void navigate(-1);
            else void navigate(stepAddress(false), { replace: true });
          }}
        />
      ) : (
        <Catalog
          sale={sale}
          dispatch={dispatch}
          target={target}
          heading={heading}
          onReview={() => {
            cameFromCatalog.current = true;
            void navigate(stepAddress(true));
          }}
        />
      )}

      <ConfirmDialog
        open={asking && unfinished}
        title={draft ? "¿Salir sin registrar la venta?" : "La venta puede estarse registrando"}
        description={
          draft
            ? "La selección no se ha registrado y se perderá."
            : "Salir no cancela el registro. Antes de repetir la venta, revisa Mi día."
        }
        confirm={draft ? "Salir y descartar" : "Salir"}
        cancel={draft ? "Seguir con la venta" : "Quedarme aquí"}
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => {
          if (blocker.state === "blocked") blocker.reset();
        }}
      />
    </>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { target } = loaderData;
  // Another target Bill, or none, is another sale: it starts from nothing.
  return <Sale key={target?.id ?? ""} target={target} />;
}
