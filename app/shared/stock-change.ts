import { ADJUSTMENT_REASONS, type AdjustmentReason, adjustmentReasonLabel, adjustmentSign } from "./adjustment";
import type { Recorded } from "./record-request";
import { trimToNull } from "./text";
import { parseUnits } from "./units";

/**
 * Inventario's two ways of moving Stock by hand (UI redesign §6, §7): an
 * Adjustment, typed, and the cancellation of one, with its reason. Either is
 * sent as a frozen snapshot, then confirmed, refused or of unknown outcome.
 * `stockChangeAfter` is every change the screen can make to it, so what may
 * be typed, sent again or started over is decided here and nowhere else:
 *
 *     const [change, dispatch] = useReducer(stockChangeAfter, newStockChange(draft));
 *     dispatch({ type: "typed", draft });
 *
 * Which of Inventario's steps is on screen is the address's business
 * (`stockStepOf`), not this state's.
 *
 * Safe in the browser: no Effect import.
 */

/** What the screen knows of an Item whose Stock it shows. */
export interface StockedItem {
  readonly id: string;
  readonly name: string;
  /** The Stock the screen read. The server decides again. */
  readonly stock: number;
}

/** An Adjustment while it is typed. */
export interface AdjustmentDraft {
  /** `""` while no Item is chosen. */
  readonly itemId: string;
  readonly reason: AdjustmentReason;
  readonly unitsText: string;
  readonly note: string;
}

/** How every Adjustment starts: nothing typed, an Entrada unless the link said otherwise. */
export const newAdjustmentDraft = (itemId = "", reason: AdjustmentReason = "restock"): AdjustmentDraft => ({
  itemId,
  reason,
  unitsText: "",
  note: "",
});

/** What each reason is called inside a sentence: "Registrar merma de 2". */
export const adjustmentReasonNoun: Record<AdjustmentReason, string> = {
  restock: "entrada",
  waste: "merma",
  internal_use: "consumo interno",
};

/** An Adjustment with its sign, as the lists say it: "Entrada +4", "Merma -2". */
export const signedUnits = (reason: AdjustmentReason, units: number) =>
  `${adjustmentSign(reason) === 1 ? "+" : "-"}${units}`;

export const adjustmentProblems = {
  itemMissing: "Elige un producto.",
  unitsMissing: "Escribe cuántas unidades.",
  unitsInvalid: "Las unidades deben ser un número entero, uno o más.",
  whyMissing: "Escribe el motivo de la cancelación.",
} as const;

/** What a draft would record, and what keeps it from being sent. */
export function readAdjustmentDraft(draft: AdjustmentDraft, items: ReadonlyArray<StockedItem>) {
  const item = items.find((known) => known.id === draft.itemId) ?? null;
  const parsed = parseUnits(draft.unitsText);
  const units = parsed !== undefined && parsed >= 1 ? parsed : null;
  const unitsProblem =
    units !== null
      ? null
      : draft.unitsText.trim() === ""
        ? adjustmentProblems.unitsMissing
        : adjustmentProblems.unitsInvalid;
  return {
    item,
    units,
    itemProblem: item === null ? adjustmentProblems.itemMissing : null,
    unitsProblem,
  };
}

/** What an Adjustment would do, said before its action (UI redesign §7.2). */
export function adjustmentEffect(reason: AdjustmentReason, units: number, item: StockedItem): string {
  const after = item.stock + adjustmentSign(reason) * units;
  const moves = `${adjustmentSign(reason) === 1 ? "Suma" : "Resta"} ${units}: ${item.name} pasa de ${item.stock} a ${after} en existencias.`;
  return after < 0 ? `${moves} Queda bajo cero.` : moves;
}

/** An Adjustment the screen offers to cancel, as it was recorded. */
export interface RecordedAdjustment {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly reason: AdjustmentReason;
  readonly units: number;
}

/**
 * What cancelling an Adjustment would do: the reverse of what it did. `item`
 * is null when the screen has no Stock for it (it stopped being
 * stock-tracked); the cancellation reverses it all the same.
 */
export function cancellationEffect(adjustment: RecordedAdjustment, item: StockedItem | null): string {
  const back = -adjustmentSign(adjustment.reason) * adjustment.units;
  const verb = back > 0 ? "Suma" : "Resta";
  if (item === null) return `${verb} ${adjustment.units} a las existencias de ${adjustment.itemName}.`;
  return `${verb} ${adjustment.units}: ${item.name} pasa de ${item.stock} a ${item.stock + back} en existencias.`;
}

/**
 * A change as it was sent: its content and its identity, frozen at the tap.
 * A retry sends this very snapshot. An Adjustment's `key` is its submission
 * key (README, "One submission per form"); a cancellation's only tells its
 * answer from another's, because an Adjustment is cancelled once.
 */
export type StockChangeSnapshot =
  | {
      readonly kind: "adjustment";
      readonly key: string;
      readonly itemId: string;
      readonly itemName: string;
      readonly reason: AdjustmentReason;
      readonly units: number;
      readonly note: string | null;
    }
  | {
      readonly kind: "cancellation";
      readonly key: string;
      readonly adjustmentId: string;
      readonly itemName: string;
      readonly reason: AdjustmentReason;
      readonly units: number;
      /** Why it is cancelled. */
      readonly why: string;
    };

/** The Item as the change left it, in the server's answer. */
export interface StockChangeResult {
  /** The Item's Stock when the server answered. */
  readonly stock: number;
}

/** What the route answers a recorded change with. */
export interface StockChangeAnswer {
  readonly change: StockChangeResult;
}

export const isStockChangeAnswer = (answer: object): answer is StockChangeAnswer =>
  "change" in answer &&
  typeof answer.change === "object" &&
  answer.change !== null &&
  "stock" in answer.change &&
  typeof answer.change.stock === "number";

/** What is being typed: the Adjustment, and the reason of the cancellation on screen. */
interface Typed {
  readonly draft: AdjustmentDraft;
  readonly why: string;
}

export type StockChangeState =
  | ({ readonly phase: "editing"; readonly refusal: string | null } & Typed)
  /** Sent, not answered. What was typed comes back if it is refused. */
  | ({ readonly phase: "recording"; readonly snapshot: StockChangeSnapshot; readonly attempt: number } & Typed)
  /**
   * No answer came: recorded or not, nobody knows yet. `sessionEnded` when a
   * retry was answered by Entrar: that attempt recorded nothing, an earlier
   * one may have, and no retry can tell until the Admin signs in again.
   */
  | ({
      readonly phase: "unknown";
      readonly snapshot: StockChangeSnapshot;
      readonly attempt: number;
      readonly sessionEnded: boolean;
    } & Typed)
  | { readonly phase: "confirmed"; readonly snapshot: StockChangeSnapshot; readonly result: StockChangeResult };

export type StockChangeEvent =
  /** Another step was opened: what was typed for the one before is not for this one. */
  | { readonly type: "opened"; readonly draft: AdjustmentDraft }
  | { readonly type: "typed"; readonly draft: AdjustmentDraft }
  | { readonly type: "reasoned"; readonly why: string }
  | { readonly type: "submitted"; readonly snapshot: StockChangeSnapshot }
  | { readonly type: "answered"; readonly key: string; readonly outcome: Recorded<StockChangeAnswer> }
  | { readonly type: "retried" }
  /** The confirmed result was left: the next change starts from `draft`. */
  | { readonly type: "started"; readonly draft: AdjustmentDraft };

export const newStockChange = (draft: AdjustmentDraft): Extract<StockChangeState, { phase: "editing" }> => ({
  phase: "editing",
  draft,
  why: "",
  refusal: null,
});

/** The change after `event`. An event the phase does not allow changes nothing. */
export function stockChangeAfter(state: StockChangeState, event: StockChangeEvent): StockChangeState {
  switch (event.type) {
    case "opened":
      return state.phase === "editing" ? newStockChange(event.draft) : state;
    case "typed":
      // A refusal is about the change as it was sent: typing answers it.
      return state.phase === "editing" ? { ...state, draft: event.draft, refusal: null } : state;
    case "reasoned":
      return state.phase === "editing" ? { ...state, why: event.why, refusal: null } : state;
    case "submitted":
      if (state.phase !== "editing") return state;
      return { phase: "recording", draft: state.draft, why: state.why, snapshot: event.snapshot, attempt: 1 };
    case "answered": {
      if (state.phase !== "recording" || state.snapshot.key !== event.key) return state;
      const { outcome } = event;
      if (outcome.outcome === "unknown") return { ...state, phase: "unknown", sessionEnded: false };
      if (outcome.outcome === "confirmed") {
        return { phase: "confirmed", snapshot: state.snapshot, result: outcome.answer.change };
      }
      // Entrar answered a retry: an earlier attempt may have been recorded,
      // so this is no evidence that nothing was, and the snapshot is kept.
      if (outcome.answer.sessionEnded && state.attempt > 1) return { ...state, phase: "unknown", sessionEnded: true };
      return { phase: "editing", draft: state.draft, why: state.why, refusal: outcome.answer.error };
    }
    case "retried":
      if (state.phase !== "unknown") return state;
      return {
        phase: "recording",
        draft: state.draft,
        why: state.why,
        snapshot: state.snapshot,
        attempt: state.attempt + 1,
      };
    case "started":
      return state.phase === "confirmed" ? newStockChange(event.draft) : state;
  }
}

/** The snapshot an Adjustment is sent as, or why it cannot be sent yet. `key` is `newId()` at the tap. */
export function adjustmentSnapshot(change: {
  readonly draft: AdjustmentDraft;
  readonly items: ReadonlyArray<StockedItem>;
  readonly key: string;
}): StockChangeSnapshot | { readonly problem: string } {
  const read = readAdjustmentDraft(change.draft, change.items);
  if (read.item === null) return { problem: read.itemProblem! };
  if (read.units === null) return { problem: read.unitsProblem! };
  return {
    kind: "adjustment",
    key: change.key,
    itemId: read.item.id,
    itemName: read.item.name,
    reason: change.draft.reason,
    units: read.units,
    note: trimToNull(change.draft.note),
  };
}

/** The snapshot a cancellation is sent as, or why it cannot be sent yet. */
export function cancellationSnapshot(change: {
  readonly adjustment: RecordedAdjustment;
  readonly why: string;
  readonly key: string;
}): StockChangeSnapshot | { readonly problem: string } {
  const why = trimToNull(change.why);
  if (why === null) return { problem: adjustmentProblems.whyMissing };
  const { id, itemName, reason, units } = change.adjustment;
  return { kind: "cancellation", key: change.key, adjustmentId: id, itemName, reason, units, why };
}

/** What the route reads to tell the two apart. */
export const STOCK_CHANGE_INTENTS = ["registrar", "cancelar"] as const;

/** The form a snapshot is sent as: the same fields, in the same order, every time. */
export function stockChangeBody(snapshot: StockChangeSnapshot): URLSearchParams {
  if (snapshot.kind === "cancellation") {
    return new URLSearchParams({ intent: "cancelar", adjustmentId: snapshot.adjustmentId, reason: snapshot.why });
  }
  return new URLSearchParams({
    intent: "registrar",
    itemId: snapshot.itemId,
    reason: snapshot.reason,
    units: String(snapshot.units),
    note: snapshot.note ?? "",
    submissionKey: snapshot.key,
  });
}

/** What the screen says while a snapshot is on its way. */
export const stockChangeRecordingText = (snapshot: StockChangeSnapshot) =>
  snapshot.kind === "adjustment"
    ? `Registrando ${adjustmentReasonNoun[snapshot.reason]} de ${snapshot.units}…`
    : "Cancelando ajuste…";

const recordedTitle: Record<AdjustmentReason, string> = {
  restock: "Entrada registrada",
  waste: "Merma registrada",
  internal_use: "Consumo interno registrado",
};

/** What a confirmed change says: what the server recorded and the Stock it answered. */
export function stockChangeOutcome(snapshot: StockChangeSnapshot, result: StockChangeResult) {
  const stock = `Existencias: ${result.stock}.`;
  if (snapshot.kind === "adjustment") {
    return {
      title: recordedTitle[snapshot.reason],
      details: `${signedUnits(snapshot.reason, snapshot.units)} de ${snapshot.itemName}. ${stock}`,
    };
  }
  return {
    title: "Ajuste cancelado",
    details: `Ya no cuenta: ${adjustmentReasonLabel[snapshot.reason]} ${signedUnits(snapshot.reason, snapshot.units)} de ${snapshot.itemName}. ${stock}`,
  };
}

/** What is said when no answer came, by what was sent. */
export const stockChangeUnknownText = (snapshot: StockChangeSnapshot) =>
  snapshot.kind === "adjustment"
    ? "El ajuste pudo registrarse o no. Volver a intentar no lo registra dos veces."
    : "La cancelación pudo registrarse o no. Volver a intentar no la registra dos veces.";

/** Which of Inventario's steps an address asks for (`/inventario?paso=…`). */
export type StockStep =
  | { readonly name: "stock" }
  | { readonly name: "adjust"; readonly itemId: string; readonly reason: AdjustmentReason }
  | { readonly name: "adjustments" }
  | { readonly name: "cancel"; readonly adjustmentId: string };

export function stockStepOf(params: URLSearchParams): StockStep {
  switch (params.get("paso")) {
    case "ajustar": {
      const asked = params.get("motivo");
      return {
        name: "adjust",
        itemId: params.get("producto") ?? "",
        reason: ADJUSTMENT_REASONS.find((known) => known === asked) ?? "restock",
      };
    }
    case "ajustes":
      return { name: "adjustments" };
    case "cancelar": {
      const adjustmentId = params.get("ajuste");
      return adjustmentId ? { name: "cancel", adjustmentId } : { name: "adjustments" };
    }
    default:
      return { name: "stock" };
  }
}

export const STOCK_PATH = "/inventario";
/** Where a change of Stock is sent (`app/routes/resources/record-stock-change.ts`). */
export const STOCK_CHANGE_PATH = `${STOCK_PATH}/ajustar`;
export const ADJUSTMENTS_HREF = `${STOCK_PATH}?paso=ajustes`;

/** The step that records an Adjustment, for an Item or a reason when the link knows them. */
export function adjustHref(open: { readonly itemId?: string; readonly reason?: AdjustmentReason } = {}): string {
  const params = new URLSearchParams({ paso: "ajustar" });
  if (open.itemId) params.set("producto", open.itemId);
  if (open.reason) params.set("motivo", open.reason);
  return `${STOCK_PATH}?${params}`;
}

/** The step that cancels one Adjustment. */
export const cancelHref = (adjustmentId: string) =>
  `${STOCK_PATH}?${new URLSearchParams({ paso: "cancelar", ajuste: adjustmentId })}`;
