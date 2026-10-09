import { type RefObject, useEffect, useReducer, useRef, useState } from "react";
import { Effect } from "effect";
import { Link, type ShouldRevalidateFunctionArgs, useLocation, useNavigate, useRevalidator } from "react-router";

import { listCountItems } from "~/backend/counts";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { CountLineItem } from "~/components/count-line";
import { BackDrawing } from "~/components/icons";
import { Notice } from "~/components/notice";
import { Pending, SentRows, useLeaveGuard } from "~/components/recording";
import { useRecorded } from "~/shared/recorded";
import { hint, pageTitle, sectionTitle } from "~/components/styles";
import { StickyBar } from "~/components/sticky-bar";
import { Badge } from "~/components/ui/badge";
import { Button, buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  COUNT_PATH,
  COUNT_RECORD_PATH,
  COUNT_REVIEW_HREF,
  COUNT_UNKNOWN_TEXT,
  countActionText,
  countAfter,
  type CountAnswer,
  countBody,
  type CountDraft,
  type CountLine,
  countOutcome,
  countProblems,
  countRecordingText,
  type CountReview,
  type CountReviewAnswer,
  countReviewBody,
  type CountSnapshot,
  countSnapshot,
  type CountState,
  countStepOf,
  countSummary,
  DISCREPANCIES_PATH,
  isCountAnswer,
  isCountReviewAnswer,
  itemsText,
  NEW_COUNT,
  readCountDraft,
} from "~/shared/count";
import { newId } from "~/shared/id";
import { normalizeName } from "~/shared/normalize-name";
import { sendForRecord } from "~/shared/record-request";
import { STOCK_PATH } from "~/shared/stock-change";

import type { Route } from "./+types/conteo";

export const meta: Route.MetaFunction = () => [{ title: "Conteo · Gamo Cafe" }];

// Conteo (spec §5.8, §6.2; UI redesign §7): an Admin types what is on the
// shelf, Item by Item, without seeing what Stock expects; the review
// (`?paso=revisar`) reads expected, found and difference; its one action
// records the Count. An Admin screen: `requireAdminUser` refuses a Worker
// before anything is read, and the operations refuse one again.
//
// The loader carries Item names and nothing about Stock. The expected numbers
// reach the screen only when the review is asked for, from
// `/inventario/conteo/registrar` (`./resources/record-count`), which is also
// where the Count is sent. A Count is `~/shared/count`: typed, reviewed,
// frozen at the tap, sent with the browser's own `fetch`, and kept on screen
// until the server's own answer says what was recorded. The page has no
// action.

export async function loader({ context }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const lines = await run(
    context,
    listCountItems.pipe(Effect.provideService(CurrentUser, admin)),
    refuseRead,
  );
  return { lines };
}

/**
 * The two steps differ only in `?paso=`, and the Items are the same for both:
 * moving between them reads nothing, so the review is on screen from the tap.
 * A refusal asks for the Items again by itself.
 */
export function shouldRevalidate({ currentUrl, defaultShouldRevalidate, nextUrl }: ShouldRevalidateFunctionArgs) {
  const onlyStepChanged = currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search;
  return onlyStepChanged ? false : defaultShouldRevalidate;
}

type Line = Route.ComponentProps["loaderData"]["lines"][number];
type Heading = RefObject<HTMLHeadingElement | null>;
type Editing = Extract<CountState, { phase: "editing" }>;

/** What the link to the review carries: it was opened from the entry, so its way back is back. */
const WITHIN = { withinConteo: true };

const fieldId = (itemId: string) => `contar-${itemId}`;

const title = `${pageTitle} wrap-break-word outline-none`;

/** The step that takes what was found: a field per Item, and nothing about what Stock expects. */
function Entry({
  lines,
  count,
  heading,
  onType,
  onReview,
}: {
  readonly lines: ReadonlyArray<Line>;
  readonly count: Editing;
  readonly heading: Heading;
  readonly onType: (draft: CountDraft) => void;
  readonly onReview: () => void;
}) {
  const { draft } = count;
  // The Items are all here, so the search is the screen's own. What was typed
  // for an Item the search hides stays typed.
  const [query, setQuery] = useState("");
  // Whether a tap on the action found the Count could not be reviewed yet.
  const [insist, setInsist] = useState(false);
  // The field that takes the keyboard once the search no longer hides it.
  const [focusOn, setFocusOn] = useState<string | null>(null);
  useEffect(() => {
    if (focusOn === null) return;
    document.getElementById(focusOn)?.focus();
    setFocusOn(null);
  }, [focusOn]);

  const wanted = normalizeName(query);
  const found = wanted === "" ? lines : lines.filter((line) => normalizeName(line.name).includes(wanted));
  const read = readCountDraft(draft, lines);
  const problem =
    read.invalid.length > 0
      ? `${read.invalid.length === 1 ? "Una cantidad no se puede leer" : `${read.invalid.length} cantidades no se pueden leer`}. Corrígela${read.invalid.length === 1 ? "" : "s"} para revisar.`
      : read.counted.length === 0
        ? countProblems.nothingCounted
        : null;

  return (
    <div className="flex flex-col gap-5">
      <Link to={STOCK_PATH} className={`${buttonClasses({ variant: "outline", size: "touch" })} max-w-full shrink self-start`}>
        <BackDrawing />
        <span className="min-w-0 wrap-anywhere">Inventario</span>
      </Link>
      <div className="flex flex-col gap-1">
        <h1 ref={heading} tabIndex={-1} className={title}>
          Conteo
        </h1>
        {lines.length === 0 ? null : (
          <p className={hint}>
            Escribe lo que hay en el estante. Lo que dejes en blanco no entra al conteo; si no queda ninguno, escribe 0.
          </p>
        )}
      </div>
      {count.refusal ? <Notice tone="error">{count.refusal}</Notice> : null}

      {lines.length === 0 ? (
        <p className={hint}>Todavía no hay productos con inventario. En Productos se elige cuáles lo llevan.</p>
      ) : (
        <>
          <div role="search" className="flex flex-col gap-2">
            <Label htmlFor="buscar">Buscar producto</Label>
            <Input
              id="buscar"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={80}
            />
            <p aria-live="polite" className={hint}>
              {wanted === ""
                ? ""
                : found.length === 0
                  ? `Ningún producto con inventario contiene «${query.trim()}».`
                  : `${found.length} de ${lines.length} productos.`}
            </p>
            {wanted !== "" && found.length === 0 ? (
              <Button type="button" variant="outline" size="touch" onClick={() => setQuery("")}>
                Ver todos
              </Button>
            ) : null}
          </div>

          <section aria-labelledby="contado" className="flex flex-col gap-3">
            <h2 id="contado" className={sectionTitle}>
              Unidades contadas
            </h2>
            <Card size="sm">
              <CardContent>
                <ul aria-label="Unidades contadas" className="flex flex-col divide-y">
                  {found.map((line) => {
                    const id = fieldId(line.id);
                    const invalid = read.invalid.includes(line.id);
                    return (
                      <li key={line.id} className="@container py-3">
                        {/* Side by side where the name and the field fit; one under the other with large text. */}
                        <div className="flex flex-col gap-2 @[22rem]:flex-row @[22rem]:items-center @[22rem]:justify-between @[22rem]:gap-4">
                          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                            {/* The label is the Item's name and nothing else: no Stock, no hint of it. */}
                            <Label htmlFor={id} className="min-w-0 text-xl font-semibold wrap-anywhere">
                              {line.name}
                            </Label>
                            {line.retired ? <Badge variant="secondary">Retirado</Badge> : null}
                          </span>
                          <Input
                            id={id}
                            inputMode="numeric"
                            autoComplete="off"
                            value={draft.units[line.id] ?? ""}
                            onChange={(event) =>
                              onType({ ...draft, units: { ...draft.units, [line.id]: event.target.value } })
                            }
                            aria-invalid={invalid ? true : undefined}
                            aria-describedby={invalid ? `${id}-error` : undefined}
                            className="@[22rem]:w-28 @[22rem]:shrink-0"
                          />
                        </div>
                        {invalid ? (
                          <p id={`${id}-error`} className="mt-2 font-medium text-destructive">
                            {countProblems.unitsInvalid}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </section>

          <div className="flex flex-col gap-2">
            <Label htmlFor="nota">Nota (opcional)</Label>
            <Input
              id="nota"
              autoComplete="off"
              maxLength={200}
              value={draft.note}
              onChange={(event) => onType({ ...draft, note: event.target.value })}
            />
          </div>

          {/* Rests just above the navigation bar, never under it. */}
          <StickyBar>
            <Card size="sm" role="region" aria-label="Conteo" className="shadow-lg ring-foreground/25">
              <CardContent className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                {insist && problem ? (
                  <p role="alert" className="min-w-0 font-medium text-destructive wrap-break-word">
                    {problem}
                  </p>
                ) : (
                  <p aria-live="polite" className="min-w-0 font-medium wrap-break-word">
                    {`Contados: ${read.counted.length} de ${lines.length}`}
                  </p>
                )}
                <Button
                  type="button"
                  size="touch"
                  onClick={() => {
                    if (problem === null) return onReview();
                    // The fields say what cannot be read, and the first of
                    // them takes the keyboard; nothing is asked until then.
                    setInsist(true);
                    setQuery("");
                    setFocusOn(fieldId(read.invalid[0] ?? lines[0]!.id));
                  }}
                >
                  Revisar conteo
                </Button>
              </CardContent>
            </Card>
          </StickyBar>
        </>
      )}
    </div>
  );
}

/** The way back from the review to the fields, with everything typed. */
function BackToEntry({ onBack }: { readonly onBack: () => void }) {
  return (
    <Button type="button" variant="outline" size="touch" onClick={onBack} className="max-w-full shrink self-start">
      <BackDrawing />
      <span className="min-w-0 wrap-anywhere">Volver a contar</span>
    </Button>
  );
}

/** The lines of a Count, as the review and the result show them. */
function Lines({ label, lines }: { readonly label: string; readonly lines: ReadonlyArray<CountLine> }) {
  return (
    <Card size="sm">
      <CardContent>
        <ul aria-label={label} className="flex flex-col divide-y">
          {lines.map((line) => (
            <CountLineItem key={line.itemId} line={line} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** The step that shows expected, found and difference, says what recording does, and has the one action. */
function Review({
  review,
  heading,
  onBack,
  onRetry,
  onSend,
}: {
  readonly review: CountReview;
  readonly heading: Heading;
  readonly onBack: () => void;
  readonly onRetry: () => void;
  readonly onSend: () => void;
}) {
  const { read } = review;
  return (
    <div className="flex flex-col gap-6" aria-busy={read === "reading"}>
      <BackToEntry onBack={onBack} />
      <h1 ref={heading} tabIndex={-1} className={title}>
        Revisar conteo
      </h1>

      {read === "reading" ? (
        <Notice tone="info">Leyendo las existencias…</Notice>
      ) : read === "failed" ? (
        <>
          <Notice tone="error">No pudimos leer las existencias. Nada se registró y lo que escribiste sigue aquí.</Notice>
          <Button type="button" size="touch" onClick={onRetry}>
            Volver a intentar
          </Button>
        </>
      ) : (
        <>
          <p className="text-lg font-medium wrap-break-word">{`${countSummary(read.lines)}.`}</p>
          <Lines label="Revisión del conteo" lines={read.lines} />
          {review.note === null ? null : <p className="wrap-break-word">{`Nota: ${review.note}`}</p>}

          {/* What the action will do, said before it (UI redesign §7.2). */}
          <div className="flex flex-col gap-1">
            <p className="text-lg font-medium wrap-break-word">
              {review.counted.length === 1
                ? "Al registrar, las existencias de este producto quedan en lo contado."
                : `Al registrar, las existencias de estos ${itemsText(review.counted.length)} quedan en lo contado.`}
            </p>
            <p className={hint}>
              Todavía no cambia nada. El conteo queda guardado en Diferencias. Lo esperado se lee de nuevo al
              registrar: lo que se venda o se ajuste desde esta revisión entra en la diferencia.
            </p>
          </div>

          <Button type="button" size="touch" onClick={onSend}>
            {countActionText(review.counted)}
          </Button>
        </>
      )}
    </div>
  );
}

/** What was sent, for as long as it is on screen. */
function Sent({ snapshot }: { readonly snapshot: CountSnapshot }) {
  return (
    <div className="flex flex-col gap-3">
      {snapshot.note === null ? null : <SentRows rows={[["Nota", snapshot.note]]} />}
      <ul aria-label="Conteo enviado" className="flex flex-col divide-y">
        {snapshot.counted.map((line) => (
          <li key={line.itemId} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
            <span className="max-w-full min-w-0 font-medium wrap-anywhere">{line.itemName}</span>
            <span className="tabular-nums">
              <span className={hint}>Contado: </span>
              {line.found}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the server recorded, kept until the Admin goes on. */
function Confirmed({
  count,
  heading,
}: {
  readonly count: Extract<CountState, { phase: "confirmed" }>;
  readonly heading: Heading;
}) {
  const outcome = countOutcome(count.snapshot, count.result);
  useRecorded(outcome.title, outcome.details);
  return (
    <div className="flex flex-col gap-6">
      <h1 ref={heading} tabIndex={-1} className={title}>
        {outcome.title}
      </h1>
      <Notice tone="success">{outcome.details}</Notice>
      {outcome.moved ? (
        <Notice tone="info">
          Las existencias cambiaron entre la revisión y el registro. Lo esperado es lo que había al registrar.
        </Notice>
      ) : null}

      <div className="flex flex-col gap-3">
        <Link to={STOCK_PATH} className={buttonClasses({ size: "touch" })}>
          Volver a Inventario
        </Link>
        <Link to={DISCREPANCIES_PATH} className={buttonClasses({ variant: "outline", size: "touch" })}>
          Ver diferencias
        </Link>
      </div>

      <Lines label="Conteo registrado" lines={count.result.lines} />
    </div>
  );
}

export default function Conteo({ loaderData }: Route.ComponentProps) {
  const { lines } = loaderData;
  const location = useLocation();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  const step = countStepOf(new URLSearchParams(location.search));
  const [count, dispatch] = useReducer(countAfter, NEW_COUNT);

  // What was sent stays on screen whatever the address says. The review is
  // on screen only while there is one: an address that asks for it without
  // one — opened by itself, or its Count was typed over — shows the fields.
  const review = count.phase === "editing" ? count.review : null;
  // The tap that asks for the review shows it at once; its address follows.
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (step === "review") setAsked(false);
  }, [step]);
  const view = count.phase !== "editing" ? count.phase : (step === "review" || asked) && review ? "review" : "entry";
  const stranded = count.phase === "editing" && step === "review" && review === null;
  // A refusal reads the Items again first: leaving sooner would interrupt that read.
  const [readingAgain, setReadingAgain] = useState(false);
  const readAgain = () => {
    setReadingAgain(true);
    void revalidate().finally(() => setReadingAgain(false));
  };
  useEffect(() => {
    if (stranded && !readingAgain) void navigate(COUNT_PATH, { replace: true });
  }, [stranded, readingAgain]);

  // The review is read once per attempt, and only its own answer is heard.
  const reading = review?.read === "reading" ? `${review.key}:${review.attempt}` : null;
  useEffect(() => {
    if (review === null || reading === null) return;
    let heard = true;
    void sendForRecord<CountReviewAnswer>(COUNT_RECORD_PATH, countReviewBody(review), isCountReviewAnswer).then(
      (outcome) => {
        if (!heard) return;
        dispatch({ type: "reviewAnswered", key: review.key, outcome });
        // Refused: the Items are not what the screen listed, so they are read again.
        if (outcome.outcome === "refused" && !outcome.answer.sessionEnded) readAgain();
      },
    );
    return () => {
      heard = false;
    };
  }, [reading]);

  // A snapshot is sent once per attempt, and only its own answer is heard.
  const attempt = count.phase === "recording" ? count.attempt : 0;
  useEffect(() => {
    if (count.phase !== "recording") return;
    const { snapshot } = count;
    let heard = true;
    void sendForRecord<CountAnswer>(COUNT_RECORD_PATH, countBody(snapshot), isCountAnswer).then((outcome) => {
      if (!heard) return;
      dispatch({ type: "answered", key: snapshot.key, outcome });
      if (outcome.outcome === "refused" && !outcome.answer.sessionEnded) readAgain();
    });
    return () => {
      heard = false;
    };
  }, [attempt]);

  // A new view takes the keyboard and the screen reader to its heading, which
  // says what happened. Coming back to the fields keeps their place.
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    if (view !== "entry") window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [view]);

  // What was typed is not lost by a stray tap, and what is on its way is not
  // left by accident (UI redesign §6.2). Moving between the two steps is not leaving.
  const drafting =
    count.phase === "editing" &&
    (count.draft.note.trim() !== "" || Object.values(count.draft.units).some((typed) => typed.trim() !== ""));
  const onItsWay = count.phase === "recording" || count.phase === "unknown";
  const guard = useLeaveGuard(drafting || onItsWay, { within: COUNT_PATH });

  // The review opened from the fields goes back in history, which keeps their
  // place; one the browser went forward to may have no such entry behind it.
  const cameWithin = (location.state as { readonly withinConteo?: unknown } | null)?.withinConteo === true;
  const toEntry = () => {
    if (cameWithin) void navigate(-1);
    else void navigate(COUNT_PATH, { replace: true });
  };

  function askReview() {
    if (count.phase !== "editing") return;
    // Read again at every tap: what Stock expects may have moved since the last review.
    dispatch({ type: "reviewAsked", key: newId(), items: lines });
    setAsked(true);
    void navigate(COUNT_REVIEW_HREF, { state: WITHIN });
  }

  function send() {
    if (count.phase !== "editing") return;
    // Frozen at the tap, with a key of its own: a second tap finds the Count
    // already sent and changes nothing.
    const snapshot = countSnapshot(count.review, newId());
    if (snapshot !== null) dispatch({ type: "submitted", snapshot });
  }

  return (
    <>
      {count.phase === "confirmed" ? (
        <Confirmed count={count} heading={heading} />
      ) : count.phase === "recording" || count.phase === "unknown" ? (
        <Pending
          recording={count.phase === "recording"}
          title={countRecordingText(count.snapshot)}
          unknown={COUNT_UNKNOWN_TEXT}
          ended="Tu sesión terminó antes de saberlo. Entra de nuevo y revisa Diferencias antes de repetirlo."
          sessionEnded={count.phase === "unknown" && count.sessionEnded}
          check={{ to: DISCREPANCIES_PATH, label: "Revisar en Diferencias" }}
          heading={heading}
          onRetry={() => dispatch({ type: "retried" })}
        >
          <Sent snapshot={count.snapshot} />
        </Pending>
      ) : view === "review" && review ? (
        <Review
          review={review}
          heading={heading}
          onBack={toEntry}
          onRetry={() => dispatch({ type: "reviewRetried" })}
          onSend={send}
        />
      ) : (
        <Entry
          lines={lines}
          count={count}
          heading={heading}
          onType={(draft) => dispatch({ type: "typed", draft })}
          onReview={askReview}
        />
      )}

      <ConfirmDialog
        open={guard.asking}
        title={onItsWay ? "El conteo puede estarse registrando" : "¿Salir sin registrar el conteo?"}
        description={
          onItsWay
            ? "Salir no cancela el registro. Antes de repetirlo, revisa Diferencias."
            : "Lo que escribiste no se ha registrado y se perderá."
        }
        confirm={onItsWay ? "Salir" : "Salir y descartar"}
        cancel={onItsWay ? "Quedarme aquí" : "Seguir contando"}
        onConfirm={guard.leave}
        onCancel={guard.stay}
      />
    </>
  );
}
