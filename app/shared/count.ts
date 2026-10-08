import type { Recorded } from "./record-request";
import { trimToNull } from "./text";
import { parseUnits } from "./units";

/**
 * Conteo's one Count at a time (UI redesign §6, §7): the units found are
 * typed, the review reads what was expected, and the Count is sent as a frozen
 * snapshot, then confirmed, refused or of unknown outcome. `countAfter` is
 * every change the screen can make to it, so what may be typed, reviewed, sent
 * again or left is decided here and nowhere else:
 *
 *     const [count, dispatch] = useReducer(countAfter, NEW_COUNT);
 *     dispatch({ type: "typed", draft });
 *
 * Which of Conteo's two steps is on screen is the address's business
 * (`countStepOf`), not this state's.
 *
 * Safe in the browser: no Effect import.
 */

/** An Item as the entry step knows it: its name and nothing about Stock. */
export interface CountableItem {
  readonly id: string;
  readonly name: string;
}

/** One line of a Count: the Stock expected when it was read, and the difference. */
export interface CountLine {
  readonly itemId: string;
  readonly itemName: string;
  readonly expected: number;
  readonly found: number;
  /** Found minus expected: negative is Faltante, positive Sobrante (spec §5.8). */
  readonly difference: number;
}

/** A Count while it is typed: what each field holds, by Item. A field left empty is an Item left out. */
export interface CountDraft {
  readonly units: Readonly<Record<string, string>>;
  readonly note: string;
}

export const NEW_COUNT_DRAFT: CountDraft = { units: {}, note: "" };

/** What was found of one Item, as typed and read. */
export interface CountedItem {
  readonly itemId: string;
  readonly itemName: string;
  /** Zero or more. Zero is a count; an empty field is not. */
  readonly found: number;
}

export const countProblems = {
  unitsInvalid: "Escribe un número entero, cero o más.",
  nothingCounted: "Escribe lo que contaste de al menos un producto.",
} as const;

/**
 * What a draft counts, in the order of `items`, and the Items whose field
 * cannot be read. An empty field is neither: that Item is not in the Count.
 * What was typed for an Item the list no longer has is not read.
 */
export function readCountDraft(draft: CountDraft, items: ReadonlyArray<CountableItem>) {
  const counted: Array<CountedItem> = [];
  const invalid: Array<string> = [];
  for (const item of items) {
    const typed = draft.units[item.id] ?? "";
    if (typed.trim() === "") continue;
    const found = parseUnits(typed);
    if (found === undefined) invalid.push(item.id);
    else counted.push({ itemId: item.id, itemName: item.name, found });
  }
  return { counted, invalid };
}

/** How many Items, in words: "1 producto", "3 productos". */
export const itemsText = (items: number) => (items === 1 ? "1 producto" : `${items} productos`);

/** What a Count's lines add up to: "3 productos: 1 con faltante, 1 con sobrante, 1 sin diferencia". */
export function countSummary(lines: ReadonlyArray<Pick<CountLine, "difference">>): string {
  const missing = lines.filter((line) => line.difference < 0).length;
  const extra = lines.filter((line) => line.difference > 0).length;
  const even = lines.length - missing - extra;
  const parts = [
    missing > 0 ? `${missing} con faltante` : null,
    extra > 0 ? `${extra} con sobrante` : null,
    even > 0 ? `${even} sin diferencia` : null,
  ].filter((part) => part !== null);
  return `${itemsText(lines.length)}: ${parts.join(", ")}`;
}

/**
 * The review of what was typed: the Stock expected, read from the server when
 * the Admin asks and never before. `key` tells its answer from another's.
 */
export interface CountReview {
  readonly key: string;
  readonly counted: ReadonlyArray<CountedItem>;
  readonly note: string | null;
  readonly attempt: number;
  /** `failed`: no answer came. Nothing was recorded either way: a review only reads. */
  readonly read: "reading" | "failed" | { readonly lines: ReadonlyArray<CountLine> };
}

/** A Count as it was sent: its content and its submission key, frozen at the tap. A retry sends this very snapshot. */
export interface CountSnapshot {
  readonly key: string;
  readonly counted: ReadonlyArray<CountedItem>;
  readonly note: string | null;
  /** What the review showed, to say so when the record differs from it. */
  readonly reviewed: ReadonlyArray<CountLine>;
}

/** The Count as the server recorded it: what was expected at that moment, not at the review. */
export interface CountResult {
  readonly id: string;
  readonly lines: ReadonlyArray<CountLine>;
}

/** What the route answers a review with. */
export interface CountReviewAnswer {
  readonly review: { readonly lines: ReadonlyArray<CountLine> };
}

/** What the route answers a recorded Count with. */
export interface CountAnswer {
  readonly count: CountResult;
}

const hasLines = (value: unknown): value is { readonly lines: ReadonlyArray<CountLine> } =>
  typeof value === "object" && value !== null && "lines" in value && Array.isArray(value.lines);

export const isCountReviewAnswer = (answer: object): answer is CountReviewAnswer =>
  "review" in answer && hasLines(answer.review);

export const isCountAnswer = (answer: object): answer is CountAnswer =>
  "count" in answer && hasLines(answer.count) && "id" in answer.count && typeof answer.count.id === "string";

export type CountState =
  | {
      readonly phase: "editing";
      readonly draft: CountDraft;
      readonly review: CountReview | null;
      readonly refusal: string | null;
    }
  /** Sent, not answered. What was typed comes back if it is refused. */
  | { readonly phase: "recording"; readonly draft: CountDraft; readonly snapshot: CountSnapshot; readonly attempt: number }
  /**
   * No answer came: recorded or not, nobody knows yet. `sessionEnded` when a
   * retry was answered by Entrar: that attempt recorded nothing, an earlier
   * one may have, and no retry can tell until the Admin signs in again.
   */
  | {
      readonly phase: "unknown";
      readonly draft: CountDraft;
      readonly snapshot: CountSnapshot;
      readonly attempt: number;
      readonly sessionEnded: boolean;
    }
  | { readonly phase: "confirmed"; readonly snapshot: CountSnapshot; readonly result: CountResult };

export type CountEvent =
  | { readonly type: "typed"; readonly draft: CountDraft }
  /** The review of what is typed was asked for. `key` is `newId()` at the tap. */
  | { readonly type: "reviewAsked"; readonly key: string; readonly items: ReadonlyArray<CountableItem> }
  | { readonly type: "reviewAnswered"; readonly key: string; readonly outcome: Recorded<CountReviewAnswer> }
  | { readonly type: "reviewRetried" }
  | { readonly type: "submitted"; readonly snapshot: CountSnapshot }
  | { readonly type: "answered"; readonly key: string; readonly outcome: Recorded<CountAnswer> }
  | { readonly type: "retried" };

export const NEW_COUNT: CountState = { phase: "editing", draft: NEW_COUNT_DRAFT, review: null, refusal: null };

/** The Count after `event`. An event the phase does not allow changes nothing. */
export function countAfter(state: CountState, event: CountEvent): CountState {
  switch (event.type) {
    case "typed":
      // A review is of what was typed then, and a refusal of what was sent: typing answers both.
      return state.phase === "editing" ? { ...state, draft: event.draft, review: null, refusal: null } : state;
    case "reviewAsked": {
      if (state.phase !== "editing") return state;
      const { counted, invalid } = readCountDraft(state.draft, event.items);
      // The fields say what cannot be read; there is nothing to review until they can.
      if (invalid.length > 0 || counted.length === 0) return state;
      const review: CountReview = {
        key: event.key,
        counted,
        note: trimToNull(state.draft.note),
        attempt: 1,
        read: "reading",
      };
      return { ...state, review, refusal: null };
    }
    case "reviewAnswered": {
      if (state.phase !== "editing" || state.review?.key !== event.key || state.review.read !== "reading") return state;
      const { outcome } = event;
      if (outcome.outcome === "unknown") return { ...state, review: { ...state.review, read: "failed" } };
      if (outcome.outcome === "refused") return { ...state, review: null, refusal: outcome.answer.error };
      return { ...state, review: { ...state.review, read: { lines: outcome.answer.review.lines } } };
    }
    case "reviewRetried":
      if (state.phase !== "editing" || state.review?.read !== "failed") return state;
      return { ...state, review: { ...state.review, read: "reading", attempt: state.review.attempt + 1 } };
    case "submitted":
      if (state.phase !== "editing") return state;
      return { phase: "recording", draft: state.draft, snapshot: event.snapshot, attempt: 1 };
    case "answered": {
      if (state.phase !== "recording" || state.snapshot.key !== event.key) return state;
      const { outcome } = event;
      if (outcome.outcome === "unknown") return { ...state, phase: "unknown", sessionEnded: false };
      if (outcome.outcome === "confirmed") {
        return { phase: "confirmed", snapshot: state.snapshot, result: outcome.answer.count };
      }
      // Entrar answered a retry: an earlier attempt may have been recorded,
      // so this is no evidence that nothing was, and the snapshot is kept.
      if (outcome.answer.sessionEnded && state.attempt > 1) return { ...state, phase: "unknown", sessionEnded: true };
      // Refused: the Items are not what the review read, so it is no review any more.
      return { phase: "editing", draft: state.draft, review: null, refusal: outcome.answer.error };
    }
    case "retried":
      if (state.phase !== "unknown") return state;
      return { phase: "recording", draft: state.draft, snapshot: state.snapshot, attempt: state.attempt + 1 };
  }
}

/** The snapshot a reviewed Count is sent as, or null while there is no review to confirm. `key` is `newId()` at the tap. */
export function countSnapshot(review: CountReview | null, key: string): CountSnapshot | null {
  if (review === null || typeof review.read === "string") return null;
  return { key, counted: review.counted, note: review.note, reviewed: review.read.lines };
}

/** What the route reads to tell a review from a Count to record. */
export const COUNT_INTENTS = ["revisar", "registrar"] as const;

/** The field that carries what was found of one Item. */
export const UNITS_FIELD = "units.";

const countedFields = (counted: ReadonlyArray<CountedItem>) =>
  counted.map((line): [string, string] => [`${UNITS_FIELD}${line.itemId}`, String(line.found)]);

/** The form a review is asked with. */
export const countReviewBody = (review: CountReview) =>
  new URLSearchParams([["intent", "revisar"], ...countedFields(review.counted)]);

/** The form a snapshot is sent as: the same fields, in the same order, every time. */
export const countBody = (snapshot: CountSnapshot) =>
  new URLSearchParams([
    ["intent", "registrar"],
    ...countedFields(snapshot.counted),
    ["note", snapshot.note ?? ""],
    ["submissionKey", snapshot.key],
  ]);

/** The action that records a Count, named by its effect, and what is said while it is on its way. */
export const countActionText = (counted: ReadonlyArray<CountedItem>) => `Registrar conteo de ${itemsText(counted.length)}`;
export const countRecordingText = (snapshot: CountSnapshot) => `Registrando conteo de ${itemsText(snapshot.counted.length)}…`;

export const COUNT_UNKNOWN_TEXT = "El conteo pudo registrarse o no. Volver a intentar no lo registra dos veces.";

/**
 * What a confirmed Count says: what the server recorded. `moved` when what
 * was expected at that moment is not what the review showed: Stock moved in
 * between, and the record holds the later number (spec §5.8).
 */
export function countOutcome(snapshot: CountSnapshot, result: CountResult) {
  const reviewed = new Map(snapshot.reviewed.map((line) => [line.itemId, line.expected]));
  return {
    title: "Conteo registrado",
    details: `${countSummary(result.lines)}. Al registrarlo, las existencias quedaron en lo contado.`,
    moved: result.lines.some((line) => reviewed.get(line.itemId) !== line.expected),
  };
}

/** Which of Conteo's steps an address asks for (`/inventario/conteo?paso=revisar`). */
export type CountStep = "entry" | "review";

export const countStepOf = (params: URLSearchParams): CountStep => (params.get("paso") === "revisar" ? "review" : "entry");

export const COUNT_PATH = "/inventario/conteo";
export const COUNT_REVIEW_HREF = `${COUNT_PATH}?paso=revisar`;
/** Where a review is asked and a Count is sent (`app/routes/resources/record-count.ts`). */
export const COUNT_RECORD_PATH = `${COUNT_PATH}/registrar`;
export const DISCREPANCIES_PATH = "/diferencias";
