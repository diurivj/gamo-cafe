import type { BillState } from "./bill-state";
import { CORRECTION_INTENTS, type CorrectionIntent, correctionDone, correctionMessages } from "./correction-messages";
import { type Day, formatDay } from "./day";
import { type Centavos, formatMoney } from "./money";
import { paidByMethod, type PaymentMethod } from "./payment";
import type { Recorded, Refusal } from "./record-request";
import { trimToNull } from "./text";

/**
 * Cuenta's corrections (UI redesign §6, §7.2; spec §5.7): removing a Line,
 * removing a Payment and voiding the Bill. Each is a step of its own, which
 * names the record, says what would happen and has one action; then it is
 * sent as a frozen snapshot and ends confirmed, refused or of unknown outcome.
 *
 * `correctionPlan` is what the screen may offer and what it says would
 * happen; `correctionAfter` is every change the screen can make to a
 * correction once it is being typed:
 *
 *     const plan = correctionPlan(bill, target, isAdmin);   // null: not offered
 *     const [correction, dispatch] = useReducer(correctionAfter, NEW_CORRECTION);
 *
 * What the plan allows is a courtesy of the screen: the server decides again
 * (`~/backend/corrections`). A correction carries no submission key because
 * it needs none: every correction moves the Bill's revision, so the same
 * snapshot sent again can never be recorded a second time.
 *
 * Safe in the browser: no Effect import.
 */

/** What the screen knows of the Bill a correction is for. */
export interface CorrectableBill {
  readonly id: string;
  /** The revision the screen showed (spec §7.3): a Bill that moved since refuses the correction. */
  readonly revision: number;
  readonly total: Centavos;
  readonly paid: Centavos;
  readonly state: BillState;
  readonly day: Day;
}

/** The record a correction is about, as the screen has it. */
export type CorrectionTarget =
  | {
      readonly intent: "quitar-linea";
      readonly line: {
        readonly id: string;
        readonly itemName: string;
        readonly quantity: number;
        readonly unitPrice: Centavos;
        readonly day: Day;
        /** Whether the Line moved Stock when it was added: its units return (spec §5.7). */
        readonly movedStock: boolean;
        readonly removed: boolean;
      };
    }
  | {
      readonly intent: "quitar-pago";
      readonly payment: {
        readonly id: string;
        readonly amount: Centavos;
        readonly method: PaymentMethod;
        readonly day: Day;
        readonly removed: boolean;
      };
    }
  /** `movesStock`: whether a Line that still counts moved Stock. */
  | { readonly intent: "cancelar-cuenta"; readonly movesStock: boolean };

/** What a correction would do, in the words its step shows. */
export interface CorrectionPlan {
  /** The record, as the action and the result name it: "2 × Agua mineral". */
  readonly what: string;
  /** The one action of the step, by its effect: "Quitar 2 × Agua mineral". */
  readonly action: string;
  /** Whether a reason is owed (spec §5.7). */
  readonly needsReason: boolean;
  /** Why it cannot be done as the Bill stands, and what to do first; null when it can. */
  readonly blocked: string | null;
  /** What happens to the Bill, the figures and Stock, one sentence each. */
  readonly consequences: ReadonlyArray<string>;
}

/**
 * What `target`'s correction would do to `bill`, or null when this User is not
 * offered it: a Voided Bill accepts none, a record is removed once, a Worker
 * removes a Line only while the Bill has no Payment, and the rest is an
 * Admin's (spec §4.1, §5.7). Stock is said only to an Admin.
 */
export function correctionPlan(bill: CorrectableBill, target: CorrectionTarget, isAdmin: boolean): CorrectionPlan | null {
  if (bill.state === "voided") return null;
  const owed = bill.total - bill.paid;

  switch (target.intent) {
    case "quitar-linea": {
      const { line } = target;
      if (line.removed || (bill.paid > 0 && !isAdmin)) return null;
      const what = `${line.quantity} × ${line.itemName}`;
      const plan = { what, action: `Quitar ${what}`, needsReason: bill.paid > 0 };
      const after = bill.total - line.quantity * line.unitPrice;
      if (after < bill.paid) {
        return {
          ...plan,
          blocked: `No se puede quitar: la cuenta quedaría en ${formatMoney(after)} y ya tiene ${formatMoney(bill.paid)} pagados. Primero quita un pago.`,
          consequences: [],
        };
      }
      return {
        ...plan,
        blocked: null,
        consequences: [
          `El total de la cuenta baja de ${formatMoney(bill.total)} a ${formatMoney(after)}.`,
          ...(after === 0
            ? ["La cuenta queda sin productos y sale de Cuentas abiertas."]
            : after === bill.paid
              ? ["Con lo ya pagado, la cuenta queda pagada."]
              : bill.paid > 0
                ? [`Quedará debiendo ${formatMoney(after - bill.paid)}.`]
                : []),
          `Deja de contar en lo vendido del ${formatDay(line.day)}.`,
          ...(isAdmin && line.movedStock
            ? [line.quantity === 1 ? "Su unidad regresa a existencias." : `Sus ${line.quantity} unidades regresan a existencias.`]
            : []),
          "El producto sigue en la cuenta, marcado como quitado.",
        ],
      };
    }
    case "quitar-pago": {
      const { payment } = target;
      if (payment.removed || !isAdmin) return null;
      return {
        what: `${formatMoney(payment.amount)} ${paidByMethod[payment.method]}`,
        action: `Quitar pago de ${formatMoney(payment.amount)}`,
        needsReason: true,
        blocked: null,
        consequences: [
          `La cuenta vuelve a deber ${formatMoney(owed + payment.amount)}.`,
          `Deja de contar en lo cobrado del ${formatDay(payment.day)}.`,
          "El pago sigue en la cuenta, marcado como quitado.",
        ],
      };
    }
    case "cancelar-cuenta":
      if (!isAdmin) return null;
      return {
        what: `Cuenta de ${formatMoney(bill.total)}`,
        action: "Cancelar cuenta",
        needsReason: true,
        blocked: null,
        consequences: [
          "No se puede deshacer.",
          bill.paid > 0
            ? `Sus productos dejan de contar en lo vendido, y sus pagos (${formatMoney(bill.paid)}) en lo cobrado, de los días en que se registraron.`
            : "Sus productos dejan de contar en lo vendido de los días en que se registraron.",
          ...(owed > 0 ? [`Ya no se podrá cobrar lo que debe: ${formatMoney(owed)}.`] : []),
          ...(target.movesStock ? ["Las unidades de sus productos regresan a existencias."] : []),
          "La cuenta se conserva, marcada como cancelada.",
        ],
      };
  }
}

/** The address's parameters that say a correction's step is on screen: `?paso=quitar-linea&id=<line>`. */
const STEP_PARAM = "paso";
const TARGET_PARAM = "id";

/** Where the step of a correction is. */
export function correctionHref(billId: string, intent: CorrectionIntent, targetId: string | null): string {
  const search = new URLSearchParams({ [STEP_PARAM]: intent });
  if (targetId !== null) search.set(TARGET_PARAM, targetId);
  return `/cuentas/${billId}?${search}`;
}

/** The correction the address asks for, or null when it asks for none. */
export function correctionAt(
  search: URLSearchParams,
): { readonly intent: CorrectionIntent; readonly targetId: string | null } | null {
  const intent = CORRECTION_INTENTS.find((known) => known === search.get(STEP_PARAM));
  if (intent === undefined) return null;
  if (intent === "cancelar-cuenta") return { intent, targetId: null };
  const targetId = search.get(TARGET_PARAM);
  return targetId ? { intent, targetId } : null;
}

/** One correction of one record: what a typed reason belongs to. */
export const correctionKey = (intent: CorrectionIntent, targetId: string | null) => `${intent}:${targetId ?? ""}`;

/** The correction a key is of, as the address would ask for it. */
export function correctionOfKey(key: string): ReturnType<typeof correctionAt> {
  const at = key.indexOf(":");
  const search = new URLSearchParams({ [STEP_PARAM]: key.slice(0, at) });
  if (at + 1 < key.length) search.set(TARGET_PARAM, key.slice(at + 1));
  return correctionAt(search);
}

/**
 * A correction as it was sent: frozen at the tap. A retry sends this very
 * snapshot, and the revision in it is what keeps it from being recorded twice.
 */
export interface CorrectionSnapshot {
  readonly intent: CorrectionIntent;
  readonly billId: string;
  readonly revision: number;
  /** The Line or the Payment; null when the Bill itself is voided. */
  readonly targetId: string | null;
  readonly reason: string | null;
  /** The record in words, for as long as the correction is on screen. */
  readonly what: string;
}

/** The Bill as the correction left it, in the server's answer. */
export interface CorrectionResult {
  readonly total: Centavos;
  readonly owed: Centavos;
  /** Whether this User may open the Bill: a Worker may not open one that is no longer Open (spec §4.1). */
  readonly canOpen: boolean;
}

/** What the route answers a recorded correction with. */
export interface CorrectionAnswer {
  readonly correction: CorrectionResult;
}

export const isCorrectionAnswer = (answer: object): answer is CorrectionAnswer =>
  "correction" in answer && typeof answer.correction === "object" && answer.correction !== null;

/** A refused correction's answer: the reason, and what the screen has to do about it. */
export interface CorrectionRefusal extends Refusal {
  /**
   * The Bill is not what the screen showed. With `canOpen` the screen reads
   * it again; without, this User may not open it any more (spec §4.1).
   */
  readonly changed?: { readonly canOpen: boolean };
}

/** A reason while it is typed, and the correction it is for. */
interface Typed {
  readonly target: string | null;
  readonly reason: string;
}

export type CorrectionState =
  | ({ readonly phase: "editing"; readonly refusal: string | null } & Typed)
  /** Sent, not answered. What was typed comes back if it is refused. */
  | ({ readonly phase: "recording"; readonly snapshot: CorrectionSnapshot; readonly attempt: number } & Typed)
  /**
   * No answer came: recorded or not, nobody knows yet. `sessionEnded` when a
   * retry was answered by Entrar: that attempt recorded nothing, an earlier
   * one may have.
   */
  | ({
      readonly phase: "unknown";
      readonly snapshot: CorrectionSnapshot;
      readonly attempt: number;
      readonly sessionEnded: boolean;
    } & Typed)
  | { readonly phase: "confirmed"; readonly snapshot: CorrectionSnapshot; readonly result: CorrectionResult }
  /** Refused, and the Bill is no longer this User's to open: nothing was recorded. */
  | { readonly phase: "gone"; readonly snapshot: CorrectionSnapshot };

export type CorrectionEvent =
  | { readonly type: "typed"; readonly target: string; readonly reason: string }
  | { readonly type: "submitted"; readonly snapshot: CorrectionSnapshot }
  | { readonly type: "answered"; readonly attempt: number; readonly outcome: Recorded<CorrectionAnswer, CorrectionRefusal> }
  | { readonly type: "retried" }
  /** The confirmed result was left: the next correction starts from nothing. */
  | { readonly type: "started" };

export const NEW_CORRECTION: Extract<CorrectionState, { phase: "editing" }> = {
  phase: "editing",
  target: null,
  reason: "",
  refusal: null,
};

/** The correction after `event`. An event the phase does not allow changes nothing. */
export function correctionAfter(state: CorrectionState, event: CorrectionEvent): CorrectionState {
  switch (event.type) {
    case "typed":
      // A refusal is about the correction as it was sent: a change answers it.
      return state.phase === "editing"
        ? { phase: "editing", target: event.target, reason: event.reason, refusal: null }
        : state;
    case "submitted": {
      if (state.phase !== "editing") return state;
      const { intent, targetId } = event.snapshot;
      const target = correctionKey(intent, targetId);
      return { phase: "recording", target, reason: reasonFor(state, target), snapshot: event.snapshot, attempt: 1 };
    }
    case "answered": {
      if (state.phase !== "recording" || state.attempt !== event.attempt) return state;
      const { outcome } = event;
      if (outcome.outcome === "unknown") return { ...state, phase: "unknown", sessionEnded: false };
      if (outcome.outcome === "confirmed") {
        return { phase: "confirmed", snapshot: state.snapshot, result: outcome.answer.correction };
      }
      // Entrar answered a retry: an earlier attempt may have been recorded,
      // so this is no evidence that nothing was, and the snapshot is kept.
      if (outcome.answer.sessionEnded && state.attempt > 1) return { ...state, phase: "unknown", sessionEnded: true };
      if (outcome.answer.changed?.canOpen === false) return { phase: "gone", snapshot: state.snapshot };
      return { phase: "editing", target: state.target, reason: state.reason, refusal: outcome.answer.error };
    }
    case "retried":
      if (state.phase !== "unknown") return state;
      return { ...state, phase: "recording", attempt: state.attempt + 1 };
    case "started":
      return state.phase === "confirmed" ? NEW_CORRECTION : state;
  }
}

/** The reason typed for this correction; one typed for another record is not it. */
export const reasonFor = (state: CorrectionState, target: string): string =>
  "reason" in state && state.target === target ? state.reason : "";

/** The snapshot a correction is sent as, or why it cannot be sent yet. */
export function correctionSnapshot(correction: {
  readonly bill: CorrectableBill;
  readonly target: CorrectionTarget;
  readonly plan: CorrectionPlan;
  readonly reason: string;
}): CorrectionSnapshot | { readonly problem: string } {
  const { bill, target, plan } = correction;
  if (plan.blocked !== null) return { problem: plan.blocked };
  const reason = trimToNull(correction.reason);
  if (plan.needsReason && reason === null) return { problem: correctionMessages.ReasonRequired };
  return {
    intent: target.intent,
    billId: bill.id,
    revision: bill.revision,
    targetId:
      target.intent === "quitar-linea" ? target.line.id : target.intent === "quitar-pago" ? target.payment.id : null,
    reason,
    what: plan.what,
  };
}

/** The form a snapshot is sent as: the same fields, in the same order, every time. */
export function correctionBody(snapshot: CorrectionSnapshot): URLSearchParams {
  const body = new URLSearchParams({ intent: snapshot.intent, revision: String(snapshot.revision) });
  if (snapshot.reason !== null) body.set("reason", snapshot.reason);
  if (snapshot.intent === "quitar-linea") body.set("lineId", snapshot.targetId ?? "");
  if (snapshot.intent === "quitar-pago") body.set("paymentId", snapshot.targetId ?? "");
  return body;
}

/** What the screen says while a snapshot is on its way. */
export function correctionRecordingText(snapshot: CorrectionSnapshot): string {
  switch (snapshot.intent) {
    case "quitar-linea":
      return `Quitando ${snapshot.what}…`;
    case "quitar-pago":
      return `Quitando pago de ${snapshot.what}…`;
    case "cancelar-cuenta":
      return "Cancelando cuenta…";
  }
}

/** What a confirmed correction says: what the server recorded and how it left the Bill. */
export function correctionOutcome(snapshot: CorrectionSnapshot, result: CorrectionResult) {
  const title = correctionDone[snapshot.intent];
  switch (snapshot.intent) {
    case "quitar-linea": {
      const bill =
        result.total === 0
          ? "La cuenta quedó sin productos."
          : `La cuenta suma ${formatMoney(result.total)} y ${result.owed === 0 ? "quedó pagada" : `debe ${formatMoney(result.owed)}`}.`;
      return { title, details: `${snapshot.what}. ${bill}` };
    }
    case "quitar-pago":
      return { title, details: `${snapshot.what}. La cuenta debe ${formatMoney(result.owed)}.` };
    case "cancelar-cuenta":
      return {
        title,
        // A Voided Bill keeps its figures: what it had been paid is its total less what it owed.
        details: `${result.total > result.owed ? "Sus productos y sus pagos" : "Sus productos"} ya no cuentan. La cuenta se conserva, marcada como cancelada.`,
      };
  }
}
