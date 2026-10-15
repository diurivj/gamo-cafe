import { type RefObject, useEffect, useReducer, useRef, useState } from "react";
import { Link, useRevalidator } from "react-router";

import { internalUseItems } from "~/backend/inventory";
import { run } from "~/backend/run.server";
import { ConfirmDialog } from "~/components/confirm-dialog";
import { Notice } from "~/components/notice";
import { Pending, SentRows, useLeaveGuard } from "~/components/recording";
import { hint, pageTitle } from "~/components/styles";
import { Button, buttonClasses } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
import { requireUser } from "~/session.server";
import { newId } from "~/shared/id";
import {
  type CountedItem,
  type InternalUseAnswer,
  internalUseAfter,
  internalUseBody,
  internalUseEffect,
  internalUseOutcome,
  internalUseRecordingText,
  type InternalUseSnapshot,
  internalUseSnapshot,
  type InternalUseState,
  INTERNAL_USE_RECORD_PATH,
  isInternalUseAnswer,
  NEW_INTERNAL_USE,
  readInternalUseDraft,
} from "~/shared/internal-use";
import { useRecorded } from "~/shared/recorded";
import { sendForRecord } from "~/shared/record-request";

import type { Route } from "./+types/consumo-interno";

export const meta: Route.MetaFunction = () => [{ title: "Consumo interno · Gamo Cafe" }];

// Consumo interno (spec §4.1, §5.8; UI redesign §7): the units of an Item
// that staff consumed or gave away, which any User records, a Worker
// included. One step, then its result, and no Stock anywhere: a Worker never
// sees it (spec §4.2), and an Admin has Inventario for that. Cancelling an
// Internal use is still an Admin's, on Inventario.
//
// An Internal use is `~/shared/internal-use`: typed, frozen at the tap, sent
// to `/consumo-interno/registrar` (`./resources/record-internal-use`) with
// the browser's own `fetch`, and kept on screen until the server's own answer
// says what happened.

export async function loader({ context }: Route.LoaderArgs) {
  const user = requireUser(context);
  return { items: await run(context, internalUseItems), isAdmin: user.role === "admin" };
}

type Heading = RefObject<HTMLHeadingElement | null>;
type Editing = Extract<InternalUseState, { phase: "editing" }>;

/** The step: the Item, the units, the note, what it will do, and the one action. */
function Step({
  items,
  use,
  isAdmin,
  heading,
  onType,
  onSend,
}: {
  readonly items: ReadonlyArray<CountedItem>;
  readonly use: Editing;
  readonly isAdmin: boolean;
  readonly heading: Heading;
  readonly onType: (draft: Editing["draft"]) => void;
  readonly onSend: () => void;
}) {
  // Whether a tap on the action found the Internal use could not be recorded yet.
  const [insist, setInsist] = useState(false);
  // An Item the list no longer has — it stopped counting its units, or was
  // retired, and the list was read again — is no Item chosen.
  const draft = items.some((known) => known.id === use.draft.itemId) ? use.draft : { ...use.draft, itemId: "" };
  const read = readInternalUseDraft(draft, items);
  const itemProblem = insist ? read.itemProblem : null;
  // An empty field is only a problem once the User tried to record it.
  const unitsProblem = draft.unitsText.trim() === "" && !insist ? null : read.unitsProblem;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
          Consumo interno
        </h1>
        <p className={hint}>Lo que tomó el personal o se regaló. No es una venta.</p>
      </div>
      {use.refusal ? <Notice tone="error">{use.refusal}</Notice> : null}

      {items.length === 0 ? (
        <p className={hint}>Todavía no hay productos con inventario.</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="producto">Producto</Label>
            <NativeSelect
              id="producto"
              value={draft.itemId}
              onChange={(event) => onType({ ...draft, itemId: event.target.value })}
              aria-invalid={itemProblem ? true : undefined}
              aria-describedby={itemProblem ? "producto-error" : undefined}
            >
              <NativeSelectOption value="" disabled>
                Elige un producto
              </NativeSelectOption>
              {items.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {itemProblem ? (
              <p id="producto-error" role="alert" className="font-medium text-destructive">
                {itemProblem}
              </p>
            ) : null}
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
            <p
              id="unidades-hint"
              role={unitsProblem ? "alert" : undefined}
              className={unitsProblem ? "font-medium text-destructive" : hint}
            >
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
          <div className="flex flex-col gap-1">
            <p aria-live="polite" className="text-lg font-medium wrap-break-word">
              {read.item !== null && read.units !== null ? internalUseEffect(read.units, read.item) : ""}
            </p>
            {/* A Worker cannot take it back: cancelling an Adjustment is an Admin's (spec §4.1). */}
            {isAdmin ? null : <p className={hint}>Si te equivocas, solo un administrador puede cancelarlo.</p>}
          </div>

          <Button
            type="button"
            size="touch"
            onClick={() => {
              // The fields say what is missing, and the first of them takes
              // the keyboard; nothing is sent until it can be read.
              if (read.item === null || read.units === null) {
                setInsist(true);
                document.getElementById(read.item === null ? "producto" : "unidades")?.focus();
              } else onSend();
            }}
          >
            {read.units === null ? "Registrar consumo interno" : `Registrar consumo interno de ${read.units}`}
          </Button>
        </>
      )}
    </div>
  );
}

/** What was sent, for as long as it is on screen. */
function Sent({ snapshot }: { readonly snapshot: InternalUseSnapshot }) {
  const rows: Array<readonly [string, string]> = [
    ["Producto", snapshot.itemName],
    ["Unidades", String(snapshot.units)],
  ];
  if (snapshot.note !== null) rows.push(["Nota", snapshot.note]);
  return <SentRows rows={rows} />;
}

/** What the server confirmed, kept until the User goes on. */
function Confirmed({
  snapshot,
  isAdmin,
  heading,
  onAnother,
}: {
  readonly snapshot: InternalUseSnapshot;
  readonly isAdmin: boolean;
  readonly heading: Heading;
  readonly onAnother: () => void;
}) {
  const { title, details } = internalUseOutcome(snapshot);
  useRecorded(title, details);
  return (
    <div className="flex flex-col gap-6">
      <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
        {title}
      </h1>
      <Notice tone="success">{details}</Notice>
      {isAdmin ? null : <p className={hint}>Si te equivocaste, pide a un administrador que lo cancele.</p>}

      <div className="flex flex-col gap-3">
        <Button type="button" size="touch" onClick={onAnother}>
          Registrar otro consumo
        </Button>
        <Link to="/inicio" className={buttonClasses({ variant: "outline", size: "touch" })}>
          Ir a Inicio
        </Link>
      </div>

      <Sent snapshot={snapshot} />
    </div>
  );
}

export default function ConsumoInterno({ loaderData }: Route.ComponentProps) {
  const { items, isAdmin } = loaderData;
  const [use, dispatch] = useReducer(internalUseAfter, NEW_INTERNAL_USE);
  const { revalidate } = useRevalidator();

  // A snapshot is sent once per attempt, and only its own answer is heard.
  const attempt = use.phase === "recording" ? use.attempt : 0;
  useEffect(() => {
    if (use.phase !== "recording") return;
    const { snapshot } = use;
    let heard = true;
    void sendForRecord<InternalUseAnswer>(INTERNAL_USE_RECORD_PATH, internalUseBody(snapshot), isInternalUseAnswer).then(
      (outcome) => {
        if (!heard) return;
        dispatch({ type: "answered", key: snapshot.key, outcome });
        // Refused: the Item may no longer be one to offer, so the list is
        // read again and what was typed is kept.
        if (outcome.outcome === "refused" && !outcome.answer.sessionEnded) void revalidate();
      },
    );
    return () => {
      heard = false;
    };
  }, [attempt]);

  // A new view takes the keyboard and the screen reader to its heading, which
  // says what happened: the step, that something is on its way, how it ended.
  const heading = useRef<HTMLHeadingElement>(null);
  const view = use.phase;
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [view]);

  // What is on its way is not left by accident (UI redesign §6.2).
  const guard = useLeaveGuard(use.phase === "recording" || use.phase === "unknown");

  function send() {
    if (use.phase !== "editing") return;
    // Frozen at the tap, with a key of its own: a second tap finds the
    // Internal use already sent and changes nothing.
    const snapshot = internalUseSnapshot({ draft: use.draft, items, key: newId() });
    if (!("problem" in snapshot)) dispatch({ type: "submitted", snapshot });
  }

  return (
    <>
      {use.phase === "confirmed" ? (
        <Confirmed
          snapshot={use.snapshot}
          isAdmin={isAdmin}
          heading={heading}
          onAnother={() => dispatch({ type: "started" })}
        />
      ) : use.phase === "recording" || use.phase === "unknown" ? (
        <Pending
          recording={use.phase === "recording"}
          title={internalUseRecordingText(use.snapshot)}
          // A Worker has no Historial to look in (spec §4.1): an Admin does.
          unknown={`El consumo interno pudo registrarse o no. Volver a intentar no lo registra dos veces.${
            isAdmin ? "" : " Si sigue sin saberse, pide a un administrador que lo revise."
          }`}
          ended={
            isAdmin
              ? "Tu sesión terminó antes de saberlo. Entra de nuevo y revisa Historial antes de repetirlo."
              : "Tu sesión terminó antes de saberlo. Entra de nuevo y pide a un administrador que lo revise antes de repetirlo."
          }
          sessionEnded={use.phase === "unknown" && use.sessionEnded}
          check={isAdmin ? { to: "/historial", label: "Revisar en Historial" } : null}
          heading={heading}
          onRetry={() => dispatch({ type: "retried" })}
        >
          <Sent snapshot={use.snapshot} />
        </Pending>
      ) : (
        <Step
          items={items}
          use={use}
          isAdmin={isAdmin}
          heading={heading}
          onType={(draft) => dispatch({ type: "typed", draft })}
          onSend={send}
        />
      )}

      <ConfirmDialog
        open={guard.asking}
        title="El consumo interno puede estarse registrando"
        description={
          isAdmin
            ? "Salir no cancela el registro. Antes de repetirlo, revisa Historial."
            : "Salir no cancela el registro. Antes de repetirlo, pregunta a un administrador."
        }
        confirm="Salir"
        cancel="Quedarme aquí"
        onConfirm={guard.leave}
        onCancel={guard.stay}
      />
    </>
  );
}
