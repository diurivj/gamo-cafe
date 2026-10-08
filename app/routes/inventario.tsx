import { type RefObject, useEffect, useReducer, useRef, useState } from "react";
import { Effect } from "effect";
import { Link, useLocation, useNavigate, useRevalidator } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { listInventory, listRecentAdjustments } from "~/backend/inventory";
import { run } from "~/backend/run.server";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { BackDrawing, ChevronDrawing } from "~/components/icons";
import { Notice } from "~/components/notice";
import { Pending, SentRows, useLeaveGuard, useReadAgainSince } from "~/components/recording";
import { hint, pageTitle, sectionTitle } from "~/components/styles";
import { Badge } from "~/components/ui/badge";
import { Button, buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { ADJUSTMENT_REASONS, type AdjustmentReason, adjustmentReasonLabel, adjustmentSign } from "~/shared/adjustment";
import { COUNT_PATH, DISCREPANCIES_PATH } from "~/shared/count";
import { formatDay, formatTime } from "~/shared/day";
import { newId } from "~/shared/id";
import { normalizeName } from "~/shared/normalize-name";
import { sendForRecord } from "~/shared/record-request";
import {
  adjustHref,
  type AdjustmentDraft,
  adjustmentEffect,
  adjustmentProblems,
  adjustmentReasonNoun,
  adjustmentSnapshot,
  ADJUSTMENTS_HREF,
  cancelHref,
  cancellationEffect,
  cancellationSnapshot,
  isStockChangeAnswer,
  newAdjustmentDraft,
  newStockChange,
  readAdjustmentDraft,
  signedUnits,
  STOCK_CHANGE_PATH,
  STOCK_PATH,
  stockChangeAfter,
  type StockChangeAnswer,
  stockChangeBody,
  stockChangeOutcome,
  stockChangeRecordingText,
  type StockChangeSnapshot,
  type StockChangeState,
  stockChangeUnknownText,
  type StockStep,
  stockStepOf,
} from "~/shared/stock-change";

import type { Route } from "./+types/inventario";

export const meta: Route.MetaFunction = () => [{ title: "Inventario · Gamo Cafe" }];

// Inventario (spec §5.8, §6.2; UI redesign §7): every stock-tracked Item with
// its Stock, its Minimum and what to mind about it, found by name. Recording
// an Adjustment, the recent Adjustments and cancelling one are steps of the
// same screen (`?paso=ajustar`, `?paso=ajustes`, `?paso=cancelar`), so none of
// their forms is on the list. An Admin screen: `requireAdminUser` refuses a
// Worker before anything is read, and the operations refuse one again.
//
// A change of Stock is `~/shared/stock-change`: typed, frozen at the tap,
// sent to `/inventario/ajustar` (`./resources/record-stock-change`) with the
// browser's own `fetch`, and kept on screen until the server's own answer
// says what happened. No Stock on screen moves before that answer, and
// nothing is read after it until the Admin goes on.

export async function loader({ context }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  return run(
    context,
    Effect.all({ lines: listInventory, adjustments: listRecentAdjustments() }).pipe(
      Effect.provideService(CurrentUser, admin),
    ),
    refuseRead,
  );
}

type Data = Route.ComponentProps["loaderData"];
type Line = Data["lines"][number];
type Adjustment = Data["adjustments"][number];
type Heading = RefObject<HTMLHeadingElement | null>;
type Editing = Extract<StockChangeState, { phase: "editing" }>;

/** What a link to a step of this screen carries: the step was opened from the screen, so its way back is back. */
const WITHIN = { withinInventario: true };

/** What a step starts with: the Item and the reason its link carried, when there is such an Item. */
const draftFor = (step: StockStep, lines: ReadonlyArray<Line>) =>
  step.name === "adjust" && lines.some((line) => line.id === step.itemId)
    ? newAdjustmentDraft(step.itemId, step.reason)
    : newAdjustmentDraft("", step.name === "adjust" ? step.reason : undefined);

/** An Adjustment in a line: "Entrada +4 · Agua mineral". */
const adjustmentText = (adjustment: { readonly reason: AdjustmentReason; readonly units: number; readonly itemName: string }) =>
  `${adjustmentReasonLabel[adjustment.reason]} ${signedUnits(adjustment.reason, adjustment.units)} · ${adjustment.itemName}`;

/** The way back from a step, named after where it leads. */
function Back({ label, onBack }: { readonly label: string; readonly onBack: () => void }) {
  return (
    // Its one word may be wider than a narrow phone with large text: it breaks instead of sticking out.
    <Button type="button" variant="outline" size="touch" onClick={onBack} className="max-w-full shrink self-start">
      <BackDrawing />
      <span className="min-w-0 wrap-anywhere">{label}</span>
    </Button>
  );
}

/** What an Item's Stock asks the Admin to mind, in words (spec §5.8): at or under its Minimum, and under zero. */
function Warnings({ line }: { readonly line: Line }) {
  if (!line.retired && !line.needsRestock && !line.belowZero) return null;
  return (
    <span className="flex max-w-full flex-wrap gap-2">
      {line.retired ? <Badge variant="secondary">Retirado</Badge> : null}
      {line.needsRestock ? <Badge variant="outline">Reponer</Badge> : null}
      {line.belowZero ? <Badge variant="destructive">Bajo cero</Badge> : null}
    </span>
  );
}

/** The Stock of every stock-tracked Item, found by name, and the ways into everything else. */
function Stock({
  lines,
  heading,
  error,
  query,
  onQuery,
}: {
  readonly lines: ReadonlyArray<Line>;
  readonly heading: Heading;
  /** What a change was refused for, when its step is no longer there to say it. */
  readonly error: string | null;
  readonly query: string;
  readonly onQuery: (query: string) => void;
}) {
  const wanted = normalizeName(query);
  const found = wanted === "" ? lines : lines.filter((line) => normalizeName(line.name).includes(wanted));
  const toRestock = lines.filter((line) => line.needsRestock).length;
  const belowZero = lines.filter((line) => line.belowZero).length;
  const minded = [
    toRestock > 0 ? `${toRestock} por reponer: en su mínimo o menos` : null,
    belowZero > 0 ? `${belowZero} bajo cero` : null,
  ].filter((part) => part !== null);

  return (
    <div className="flex flex-col gap-5">
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} wrap-break-word outline-none`}>
        Inventario
      </h1>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex flex-col gap-3">
        <Link to={adjustHref({ reason: "restock" })} state={WITHIN} className={buttonClasses({ size: "touch" })}>
          Registrar entrada
        </Link>
        <Link to={COUNT_PATH} className={buttonClasses({ variant: "outline", size: "touch" })}>
          Contar existencias
        </Link>
      </div>

      <nav aria-label="Más de inventario">
        <Card size="sm">
          <CardContent>
            <ul className="flex flex-col divide-y">
              {[
                { to: adjustHref({ reason: "waste" }), label: "Registrar merma o consumo interno", state: WITHIN },
                { to: ADJUSTMENTS_HREF, label: "Ajustes recientes", state: WITHIN },
                { to: DISCREPANCIES_PATH, label: "Diferencias de los conteos", state: undefined },
              ].map((way) => (
                <li key={way.to}>
                  <Link
                    to={way.to}
                    state={way.state}
                    className="flex min-h-12 items-center justify-between gap-3 py-2 font-medium"
                  >
                    <span className="min-w-0 wrap-break-word">{way.label}</span>
                    <ChevronDrawing className="size-5" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </nav>

      <section aria-labelledby="existencias" className="flex flex-col gap-3">
        <h2 id="existencias" className={sectionTitle}>
          Existencias
        </h2>
        {lines.length === 0 ? (
          <p className={hint}>
            Todavía no hay productos con inventario. En Productos se elige cuáles lo llevan.
          </p>
        ) : (
          <>
            {/* The Items are all here, so the search is the screen's own: nothing is asked of the server. */}
            <div role="search" className="flex flex-col gap-2">
              <Label htmlFor="buscar">Buscar producto</Label>
              <Input
                id="buscar"
                type="search"
                value={query}
                onChange={(event) => onQuery(event.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={80}
              />
              <p aria-live="polite" className={hint}>
                {wanted === ""
                  ? minded.length > 0
                    ? `${minded.join(" · ")}.`
                    : ""
                  : found.length === 0
                    ? `Ningún producto con inventario contiene «${query.trim()}».`
                    : `${found.length} de ${lines.length} productos.`}
              </p>
              {wanted !== "" && found.length === 0 ? (
                <Button type="button" variant="outline" size="touch" onClick={() => onQuery("")}>
                  Ver todos
                </Button>
              ) : null}
            </div>

            <ul aria-label="Existencias" className="flex flex-col gap-3">
              {found.map((line) => (
                <li key={line.id} aria-label={line.name}>
                  <Link to={adjustHref({ itemId: line.id })} state={WITHIN} className="block rounded-2xl">
                    <Card size="sm" className="transition-colors hover:bg-muted/60 active:bg-muted">
                      <CardContent className="flex flex-col gap-2">
                        <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                          <span className="max-w-full min-w-0 text-xl font-semibold wrap-anywhere">{line.name}</span>
                          <Warnings line={line} />
                        </span>
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3 border-t pt-2">
                          <span className="font-medium">Existencias</span>{" "}
                          <span
                            data-figure="stock"
                            className="max-w-full min-w-0 font-heading text-2xl font-semibold wrap-anywhere tabular-nums"
                          >
                            {line.stock}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center justify-between gap-x-3">
                          <span className={`tabular-nums ${hint}`}>
                            {line.minimum === null ? "Sin mínimo" : `Mínimo ${line.minimum}`}
                          </span>
                          <span className="inline-flex max-w-full min-w-0 items-center gap-1 font-medium">
                            <span className="min-w-0 wrap-break-word">Registrar ajuste</span>
                            <ChevronDrawing className="size-5" />
                          </span>
                        </span>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/** The step that records an Adjustment: the Item, the reason, the units, what it will do, and the one action. */
function Adjust({
  lines,
  change,
  heading,
  onType,
  onBack,
  onSend,
}: {
  readonly lines: ReadonlyArray<Line>;
  readonly change: Editing;
  readonly heading: Heading;
  readonly onType: (draft: AdjustmentDraft) => void;
  readonly onBack: () => void;
  readonly onSend: () => void;
}) {
  // Whether a tap on the action found the Adjustment could not be recorded yet.
  const [insist, setInsist] = useState(false);
  // An Item the list no longer has — it stopped counting its units while the
  // step was open — is no Item chosen, and the field says so.
  const draft = lines.some((known) => known.id === change.draft.itemId) ? change.draft : { ...change.draft, itemId: "" };
  const read = readAdjustmentDraft(draft, lines);
  const noun = adjustmentReasonNoun[draft.reason];
  const itemProblem = insist ? read.itemProblem : null;
  // An empty field is only a problem once the Admin tried to record it.
  const unitsProblem = draft.unitsText.trim() === "" && !insist ? null : read.unitsProblem;
  const line = lines.find((known) => known.id === draft.itemId);

  return (
    <div className="flex flex-col gap-6">
      <Back label="Inventario" onBack={onBack} />
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} wrap-break-word outline-none`}>
        {`Registrar ${noun}`}
      </h1>
      {change.refusal ? <Notice tone="error">{change.refusal}</Notice> : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="producto">Producto</Label>
        <NativeSelect
          id="producto"
          value={draft.itemId}
          onChange={(event) => onType({ ...draft, itemId: event.target.value })}
          aria-invalid={itemProblem ? true : undefined}
          aria-describedby="producto-hint"
        >
          <NativeSelectOption value="" disabled>
            Elige un producto
          </NativeSelectOption>
          {lines.map((known) => (
            <NativeSelectOption key={known.id} value={known.id}>
              {known.retired ? `${known.name} (retirado)` : known.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p id="producto-hint" role={itemProblem ? "alert" : undefined} className={itemProblem ? "font-medium text-destructive" : hint}>
          {itemProblem ??
            (line
              ? `${line.name}: ${line.stock} en existencias${line.minimum === null ? "" : `, mínimo ${line.minimum}`}.`
              : "")}
        </p>
      </div>

      <div className="@container flex flex-col gap-2">
        <span id="motivo" className="text-lg font-medium">
          Motivo
        </span>
        <RadioGroup
          aria-labelledby="motivo"
          value={draft.reason}
          onValueChange={(reason) => onType({ ...draft, reason: reason as AdjustmentReason })}
          // Side by side where the three fit; one under the other with large text.
          className="grid-cols-1 @[34rem]:grid-cols-3"
        >
          {ADJUSTMENT_REASONS.map((reason) => (
            <Label
              key={reason}
              className="min-h-14 cursor-pointer gap-3 rounded-2xl border border-input bg-background px-4 py-3 has-data-checked:border-foreground has-data-checked:bg-muted has-data-checked:ring-1 has-data-checked:ring-foreground"
            >
              <RadioGroupItem value={reason} />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold wrap-anywhere">{adjustmentReasonLabel[reason]}</span>
                <span className={`font-normal wrap-anywhere ${hint}`}>
                  {adjustmentSign(reason) === 1 ? "Suma unidades" : "Resta unidades"}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="unidades">Unidades</Label>
        <Input
          id="unidades"
          inputMode="numeric"
          autoComplete="off"
          value={draft.unitsText}
          onChange={(event) => onType({ ...draft, unitsText: event.target.value })}
          aria-invalid={unitsProblem ? true : undefined}
          aria-describedby="unidades-hint"
        />
        <p id="unidades-hint" role={unitsProblem ? "alert" : undefined} className={unitsProblem ? "font-medium text-destructive" : hint}>
          {unitsProblem ?? "Un número entero, uno o más."}
        </p>
      </div>

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

      {/* What the action will do, said before it (UI redesign §7.2), and when it changes. */}
      <p aria-live="polite" className="text-lg font-medium wrap-break-word">
        {read.item !== null && read.units !== null ? adjustmentEffect(draft.reason, read.units, read.item) : ""}
      </p>

      <Button
        type="button"
        size="touch"
        onClick={() => {
          // The fields say what is missing, and the first of them takes the
          // keyboard; nothing is sent until it can be read.
          if (read.item === null || read.units === null) {
            setInsist(true);
            document.getElementById(read.item === null ? "producto" : "unidades")?.focus();
          } else onSend();
        }}
      >
        {read.units === null ? `Registrar ${noun}` : `Registrar ${noun} de ${read.units}`}
      </Button>
    </div>
  );
}

/** An Adjustment as it was recorded: what, when, by whom, its note, and its cancellation when it has one. */
function Recorded({ adjustment }: { readonly adjustment: Adjustment }) {
  return (
    <>
      <span className="max-w-full min-w-0 text-xl font-semibold wrap-anywhere">{adjustmentText(adjustment)}</span>
      <span className={`${hint} wrap-break-word`}>
        {`${formatDay(adjustment.day)} ${formatTime(adjustment.at)} · ${adjustment.byName}`}
      </span>
      {adjustment.note ? <span className="wrap-break-word">{adjustment.note}</span> : null}
      {adjustment.cancellation ? (
        <span className="border-t pt-2 wrap-break-word">
          {`Cancelado: ${adjustment.cancellation.reason} · ${adjustment.cancellation.byName}`}
        </span>
      ) : null}
    </>
  );
}

/** The recent Adjustments, newest first, each with the way to cancel it while it stands. */
function Adjustments({
  adjustments,
  heading,
  error,
  onBack,
}: {
  readonly adjustments: ReadonlyArray<Adjustment>;
  readonly heading: Heading;
  readonly error: string | null;
  readonly onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Back label="Inventario" onBack={onBack} />
      <div className="flex flex-col gap-1">
        <h1 ref={heading} tabIndex={-1} className={`${pageTitle} wrap-break-word outline-none`}>
          Ajustes recientes
        </h1>
        <p className={hint}>Los más recientes primero.</p>
        <Link
          to="/historial"
          className="inline-flex min-h-12 items-center self-start font-medium underline underline-offset-4"
        >
          Ver todos en Historial
        </Link>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}

      {adjustments.length === 0 ? (
        <p className={hint}>Todavía no hay ajustes.</p>
      ) : (
        <ul aria-label="Ajustes recientes" className="flex flex-col gap-3">
          {adjustments.map((adjustment) => (
            <li
              key={adjustment.id}
              aria-label={`${adjustmentReasonLabel[adjustment.reason]} de ${adjustment.units} de ${adjustment.itemName}`}
            >
              <Card size="sm">
                <CardContent className="flex flex-col gap-2">
                  <Recorded adjustment={adjustment} />
                  {adjustment.cancellation ? null : (
                    <Link
                      to={cancelHref(adjustment.id)}
                      state={WITHIN}
                      className={buttonClasses({ variant: "outline", size: "touch" })}
                    >
                      Cancelar ajuste
                    </Link>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The step that cancels one Adjustment: the record, what cancelling does, why, and the one action. */
function Cancel({
  adjustment,
  item,
  change,
  heading,
  onReason,
  onBack,
  onSend,
}: {
  readonly adjustment: Adjustment;
  /** The Item's Stock as the screen read it; null when it no longer counts its units. */
  readonly item: Line | null;
  readonly change: Editing;
  readonly heading: Heading;
  readonly onReason: (why: string) => void;
  readonly onBack: () => void;
  readonly onSend: () => void;
}) {
  // Whether a tap on the action found the reason missing.
  const [insist, setInsist] = useState(false);
  const missing = change.why.trim() === "";

  return (
    <div className="flex flex-col gap-6">
      <Back label="Ajustes recientes" onBack={onBack} />
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} wrap-break-word outline-none`}>
        Cancelar ajuste
      </h1>
      {change.refusal ? <Notice tone="error">{change.refusal}</Notice> : null}

      <Card size="sm" role="region" aria-label="Ajuste">
        <CardContent className="flex flex-col gap-2">
          <Recorded adjustment={adjustment} />
        </CardContent>
      </Card>

      {adjustment.cancellation ? (
        <Notice tone="info">Este ajuste ya fue cancelado. No hay nada más que hacer.</Notice>
      ) : (
        <>
          <div>
            <p className="text-lg font-medium wrap-break-word">{cancellationEffect(adjustment, item)}</p>
            <p className={hint}>El ajuste queda en el historial, marcado como cancelado. No se puede deshacer.</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="motivo-cancelacion">Motivo de la cancelación</Label>
            <Input
              id="motivo-cancelacion"
              autoComplete="off"
              maxLength={80}
              value={change.why}
              onChange={(event) => onReason(event.target.value)}
              aria-invalid={insist && missing ? true : undefined}
              aria-describedby={insist && missing ? "motivo-cancelacion-error" : undefined}
            />
            {insist && missing ? (
              <p id="motivo-cancelacion-error" role="alert" className="font-medium text-destructive">
                {adjustmentProblems.whyMissing}
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            size="touch"
            onClick={() => {
              if (missing) setInsist(true);
              else onSend();
            }}
          >
            {`Cancelar ${adjustmentReasonNoun[adjustment.reason]} de ${adjustment.units}`}
          </Button>
        </>
      )}
    </div>
  );
}

/** What was sent, for as long as it is on screen. */
function Sent({ snapshot }: { readonly snapshot: StockChangeSnapshot }) {
  const rows: Array<readonly [string, string]> = [
    ["Producto", snapshot.itemName],
    ["Ajuste", `${adjustmentReasonLabel[snapshot.reason]} ${signedUnits(snapshot.reason, snapshot.units)}`],
  ];
  if (snapshot.kind === "cancellation") rows.push(["Motivo", snapshot.why]);
  else if (snapshot.note !== null) rows.push(["Nota", snapshot.note]);
  return <SentRows rows={rows} />;
}

/** What the server confirmed, kept until the Admin goes on. */
function Confirmed({
  change,
  heading,
  onStock,
  onAdjustments,
  onAnother,
}: {
  readonly change: Extract<StockChangeState, { phase: "confirmed" }>;
  readonly heading: Heading;
  readonly onStock: () => void;
  readonly onAdjustments: () => void;
  readonly onAnother: () => void;
}) {
  const { title, details } = stockChangeOutcome(change.snapshot, change.result);
  const cancelled = change.snapshot.kind === "cancellation";
  return (
    <div className="flex flex-col gap-6">
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} wrap-break-word outline-none`}>
        {title}
      </h1>
      <Notice tone="success">{details}</Notice>

      <div className="flex flex-col gap-3">
        <Button type="button" size="touch" onClick={onStock}>
          Volver a Inventario
        </Button>
        <Button type="button" variant="outline" size="touch" onClick={cancelled ? onAdjustments : onAnother}>
          {cancelled ? "Ver ajustes recientes" : "Registrar otro ajuste"}
        </Button>
      </div>

      <Sent snapshot={change.snapshot} />
    </div>
  );
}

export default function Inventario({ loaderData }: Route.ComponentProps) {
  const { lines, adjustments } = loaderData;
  const location = useLocation();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  const step = stockStepOf(new URLSearchParams(location.search));
  const [change, dispatch] = useReducer(stockChangeAfter, null, () => newStockChange(draftFor(step, lines)));
  // The search is this screen's own, kept while its steps come and go.
  const [query, setQuery] = useState("");

  // Another step, another change: what was typed for the one before is not
  // for this one. A change that was sent is not touched by the address.
  const opened = useRef(location.search);
  useEffect(() => {
    if (opened.current === location.search) return;
    opened.current = location.search;
    dispatch({ type: "opened", draft: draftFor(step, lines) });
  }, [location.search]);

  // A result stays until the Admin goes on: only a read they asked for makes
  // it give way to the Stock as it is now.
  const [goingOn, setGoingOn] = useState(false);
  const recordedAndLeft = useReadAgainSince(change.phase === "confirmed" && goingOn, loaderData);
  useEffect(() => {
    if (!recordedAndLeft) return;
    dispatch({ type: "started", draft: draftFor(step, lines) });
    setGoingOn(false);
  }, [recordedAndLeft]);

  // The Adjustment a cancellation step is about, while the recent ones hold it.
  const cancelling = step.name === "cancel" ? adjustments.find((known) => known.id === step.adjustmentId) : undefined;

  // What was sent stays on screen whatever the address says.
  const sent = change.phase !== "editing" && !recordedAndLeft;
  const view = sent
    ? change.phase
    : step.name === "adjust"
      ? "adjust"
      : cancelling
        ? "cancel"
        : step.name === "stock"
          ? "stock"
          : "adjustments";

  // A snapshot is sent once per attempt, and only its own answer is heard.
  const attempt = change.phase === "recording" ? change.attempt : 0;
  useEffect(() => {
    if (change.phase !== "recording") return;
    const { snapshot } = change;
    let heard = true;
    void sendForRecord<StockChangeAnswer>(STOCK_CHANGE_PATH, stockChangeBody(snapshot), isStockChangeAnswer).then(
      (outcome) => {
        if (!heard) return;
        dispatch({ type: "answered", key: snapshot.key, outcome });
        // Refused: the Stock or the Adjustment may not be what the screen
        // showed, so it is read again and what was typed is kept.
        if (outcome.outcome === "refused" && !outcome.answer.sessionEnded) void revalidate();
      },
    );
    return () => {
      heard = false;
    };
  }, [attempt]);

  // A new view takes the keyboard and the screen reader to its heading, which
  // says what happened. Coming back to the list keeps its place.
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    if (view !== "stock") window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [view]);

  // What is on its way is not left by accident (UI redesign §6.2).
  const guard = useLeaveGuard(change.phase === "recording" || change.phase === "unknown");

  // A step opened from this screen goes back in history, which keeps the
  // list's place; one opened by its address has no entry behind it.
  const cameWithin = (location.state as { readonly withinInventario?: unknown } | null)?.withinInventario === true;
  const back = (to: string) => {
    if (cameWithin) void navigate(-1);
    else void navigate(to, { replace: true });
  };
  // Reading again is what ends a result and starts the next change.
  const toStock = () => {
    setGoingOn(true);
    if (step.name === "stock") void revalidate();
    else if (step.name === "adjust") back(STOCK_PATH);
    else void navigate(STOCK_PATH);
  };
  const toAdjustments = () => {
    setGoingOn(true);
    if (step.name === "adjustments") void revalidate();
    else if (step.name === "cancel") back(ADJUSTMENTS_HREF);
    else void navigate(ADJUSTMENTS_HREF);
  };
  const toAnother = (reason: AdjustmentReason) => {
    setGoingOn(true);
    const another = adjustHref({ reason });
    if (`${location.pathname}${location.search}` === another) void revalidate();
    else void navigate(another, { replace: step.name === "adjust", state: step.name === "adjust" ? location.state : WITHIN });
  };

  function send() {
    if (change.phase !== "editing") return;
    // Frozen at the tap, with a key of its own: a second tap finds the change
    // already sent and changes nothing.
    const snapshot =
      view === "cancel" && cancelling
        ? cancellationSnapshot({ adjustment: cancelling, why: change.why, key: newId() })
        : adjustmentSnapshot({ draft: change.draft, items: lines, key: newId() });
    if (!("problem" in snapshot)) dispatch({ type: "submitted", snapshot });
  }

  // A refusal with no step to be said on: the step was left while the change was on its way.
  const error = change.phase === "editing" ? change.refusal : null;

  return (
    <>
      {sent && change.phase === "confirmed" ? (
        <Confirmed
          change={change}
          heading={heading}
          onStock={toStock}
          onAdjustments={toAdjustments}
          onAnother={() => toAnother(change.snapshot.reason)}
        />
      ) : sent && (change.phase === "recording" || change.phase === "unknown") ? (
        <Pending
          recording={change.phase === "recording"}
          title={stockChangeRecordingText(change.snapshot)}
          unknown={stockChangeUnknownText(change.snapshot)}
          ended="Tu sesión terminó antes de saberlo. Entra de nuevo y revisa Historial antes de repetirlo."
          sessionEnded={change.phase === "unknown" && change.sessionEnded}
          check={{ to: "/historial", label: "Revisar en Historial" }}
          heading={heading}
          onRetry={() => dispatch({ type: "retried" })}
        >
          <Sent snapshot={change.snapshot} />
        </Pending>
      ) : view === "adjust" && change.phase === "editing" ? (
        <Adjust
          lines={lines}
          change={change}
          heading={heading}
          onType={(draft) => dispatch({ type: "typed", draft })}
          onBack={() => back(STOCK_PATH)}
          onSend={send}
        />
      ) : view === "cancel" && cancelling && change.phase === "editing" ? (
        <Cancel
          adjustment={cancelling}
          item={lines.find((line) => line.id === cancelling.itemId) ?? null}
          change={change}
          heading={heading}
          onReason={(why) => dispatch({ type: "reasoned", why })}
          onBack={() => back(ADJUSTMENTS_HREF)}
          onSend={send}
        />
      ) : view === "adjustments" ? (
        <Adjustments adjustments={adjustments} heading={heading} error={error} onBack={() => back(STOCK_PATH)} />
      ) : (
        <Stock lines={lines} heading={heading} error={error} query={query} onQuery={setQuery} />
      )}

      <ConfirmDialog
        open={guard.asking}
        title="El ajuste puede estarse registrando"
        description="Salir no cancela el registro. Antes de repetirlo, revisa Historial."
        confirm="Salir"
        cancel="Quedarme aquí"
        onConfirm={guard.leave}
        onCancel={guard.stay}
      />
    </>
  );
}
