import type { Recorded } from "./record-request";
import { readAdjustmentDraft, signedUnits } from "./stock-change";
import { trimToNull } from "./text";

/**
 * Consumo interno (spec §4.1, §5.8): the units of an Item that staff consumed
 * or gave away, which any User records, a Worker included. It is an
 * Adjustment of Internal use, and nothing about it shows Stock (spec §4.2).
 * Typed, then sent as a frozen snapshot, then confirmed, refused or of
 * unknown outcome, as Inventario's Adjustment is (`~/shared/stock-change`).
 * `internalUseAfter` is every change the screen can make to it:
 *
 *     const [use, dispatch] = useReducer(internalUseAfter, NEW_INTERNAL_USE);
 *     dispatch({ type: "typed", draft });
 *
 * Safe in the browser: no Effect import.
 */

/** An Item the screen offers: active, and counting its units. Its Stock is not the screen's. */
export interface CountedItem {
  readonly id: string;
  readonly name: string;
}

/** An Internal use while it is typed. */
export interface InternalUseDraft {
  /** `""` while no Item is chosen. */
  readonly itemId: string;
  readonly unitsText: string;
  readonly note: string;
}

/** What a draft would record, and what keeps it from being sent: Inventario's rules for an Adjustment. */
export const readInternalUseDraft = (draft: InternalUseDraft, items: ReadonlyArray<CountedItem>) =>
  readAdjustmentDraft(draft, items);

/**
 * An Internal use as it was sent: its content and its identity, frozen at
 * the tap. A retry sends this very snapshot, so the server takes it for the
 * same form and records nothing twice.
 */
export interface InternalUseSnapshot {
  /** The submission key (README, "One submission per form"). */
  readonly key: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly units: number;
  readonly note: string | null;
}

/** What the route answers a recorded Internal use with: that it is recorded, and nothing of Stock. */
export interface InternalUseAnswer {
  readonly internalUse: { readonly id: string };
}

export const isInternalUseAnswer = (answer: object): answer is InternalUseAnswer =>
  "internalUse" in answer &&
  typeof answer.internalUse === "object" &&
  answer.internalUse !== null &&
  "id" in answer.internalUse &&
  typeof answer.internalUse.id === "string";

export type InternalUseState =
  | { readonly phase: "editing"; readonly draft: InternalUseDraft; readonly refusal: string | null }
  /** Sent, not answered. `draft` is what comes back if it is refused. */
  | {
      readonly phase: "recording";
      readonly draft: InternalUseDraft;
      readonly snapshot: InternalUseSnapshot;
      readonly attempt: number;
    }
  /**
   * No answer came: recorded or not, nobody knows yet. `sessionEnded` when a
   * retry was answered by Entrar: that attempt recorded nothing, an earlier
   * one may have, and no retry can tell until the User signs in again.
   */
  | {
      readonly phase: "unknown";
      readonly draft: InternalUseDraft;
      readonly snapshot: InternalUseSnapshot;
      readonly attempt: number;
      readonly sessionEnded: boolean;
    }
  | { readonly phase: "confirmed"; readonly snapshot: InternalUseSnapshot };

export type InternalUseEvent =
  | { readonly type: "typed"; readonly draft: InternalUseDraft }
  | { readonly type: "submitted"; readonly snapshot: InternalUseSnapshot }
  | { readonly type: "answered"; readonly key: string; readonly outcome: Recorded<InternalUseAnswer> }
  | { readonly type: "retried" }
  /** The confirmed result was left: the next one starts from nothing. */
  | { readonly type: "started" };

/** How every Internal use starts: no Item, no units, no note. */
export const NEW_INTERNAL_USE: Extract<InternalUseState, { phase: "editing" }> = {
  phase: "editing",
  draft: { itemId: "", unitsText: "", note: "" },
  refusal: null,
};

/** The Internal use after `event`. An event the phase does not allow changes nothing. */
export function internalUseAfter(state: InternalUseState, event: InternalUseEvent): InternalUseState {
  switch (event.type) {
    case "typed":
      // A refusal is about what was sent: typing answers it.
      return state.phase === "editing" ? { phase: "editing", draft: event.draft, refusal: null } : state;
    case "submitted":
      if (state.phase !== "editing") return state;
      return { phase: "recording", draft: state.draft, snapshot: event.snapshot, attempt: 1 };
    case "answered": {
      if (state.phase !== "recording" || state.snapshot.key !== event.key) return state;
      const { outcome } = event;
      if (outcome.outcome === "unknown") return { ...state, phase: "unknown", sessionEnded: false };
      if (outcome.outcome === "confirmed") return { phase: "confirmed", snapshot: state.snapshot };
      // Entrar answered a retry: an earlier attempt may have been recorded,
      // so this is no evidence that nothing was, and the snapshot is kept.
      if (outcome.answer.sessionEnded && state.attempt > 1) return { ...state, phase: "unknown", sessionEnded: true };
      return { phase: "editing", draft: state.draft, refusal: outcome.answer.error };
    }
    case "retried":
      if (state.phase !== "unknown") return state;
      return { phase: "recording", draft: state.draft, snapshot: state.snapshot, attempt: state.attempt + 1 };
    case "started":
      return state.phase === "confirmed" ? NEW_INTERNAL_USE : state;
  }
}

/** The snapshot a draft is sent as, or why it cannot be sent yet. `key` is `newId()` at the tap. */
export function internalUseSnapshot(use: {
  readonly draft: InternalUseDraft;
  readonly items: ReadonlyArray<CountedItem>;
  readonly key: string;
}): InternalUseSnapshot | { readonly problem: string } {
  const read = readInternalUseDraft(use.draft, use.items);
  if (read.item === null) return { problem: read.itemProblem! };
  if (read.units === null) return { problem: read.unitsProblem! };
  return {
    key: use.key,
    itemId: read.item.id,
    itemName: read.item.name,
    units: read.units,
    note: trimToNull(use.draft.note),
  };
}

/** The form a snapshot is sent as: the same fields, in the same order, every time. */
export function internalUseBody(snapshot: InternalUseSnapshot): URLSearchParams {
  return new URLSearchParams({
    itemId: snapshot.itemId,
    units: String(snapshot.units),
    note: snapshot.note ?? "",
    submissionKey: snapshot.key,
  });
}

/**
 * What the action will do, said before it (UI redesign §7.2): the units that
 * leave, and that nobody pays for them. No Stock: it is not this screen's.
 */
export const internalUseEffect = (units: number, item: CountedItem) =>
  `Resta ${units} de ${item.name} del inventario. No se cobra.`;

/** What the screen says while a snapshot is on its way. */
export const internalUseRecordingText = (snapshot: InternalUseSnapshot) =>
  `Registrando consumo interno de ${snapshot.units}…`;

/** What a confirmed Internal use says: what the server recorded, and no Stock. */
export const internalUseOutcome = (snapshot: InternalUseSnapshot) => ({
  title: "Consumo interno registrado",
  details: `${signedUnits("internal_use", snapshot.units)} de ${snapshot.itemName}.`,
});

/** Where the screen is (`app/routes/consumo-interno.tsx`). */
export const INTERNAL_USE_PATH = "/consumo-interno";
/** Where an Internal use is sent (`app/routes/resources/record-internal-use.ts`). */
export const INTERNAL_USE_RECORD_PATH = `${INTERNAL_USE_PATH}/registrar`;
