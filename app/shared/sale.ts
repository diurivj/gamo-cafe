import type { BillState } from "./bill-state";
import { type Centavos, changeFor, formatMoney } from "./money";
import { paidByMethod, type PaymentMethod } from "./payment";
import { NEW_PAYMENT, type PaymentDraft, readPaymentDraft } from "./payment-draft";
import { paymentMessages } from "./payment-messages";
import type { Recorded, Refusal } from "./record-request";

/**
 * Vender's one sale at a time (UI redesign §5, §6): a selection being edited,
 * then sent as a frozen snapshot, then confirmed, refused or of unknown
 * outcome. `step` is every change the screen can make to it, so what may be
 * edited, sent again or started over is decided here and nowhere else:
 *
 *     const [sale, dispatch] = useReducer(saleAfter, NEW_SALE);
 *     dispatch({ type: "changed", itemId, by: 1 });
 *
 * Which of the two steps is on screen is the address's business
 * (`app/routes/home.tsx`), not this state's.
 *
 * Safe in the browser: no Effect import.
 */

/** Units selected of each Item, by id. An Item with none is absent. */
export type Quantities = Readonly<Record<string, number>>;

export interface SaleItem {
  readonly id: string;
  readonly name: string;
  readonly price: Centavos;
}

export interface SaleCustomer {
  readonly id: string;
  readonly name: string;
}

/** What step 2 holds besides the selection. */
export interface SaleFields {
  readonly customer: SaleCustomer | null;
  readonly note: string;
  readonly payment: PaymentDraft;
}

export interface SaleDraft {
  readonly quantities: Quantities;
  readonly fields: SaleFields;
}

/** `cobrar` records a Payment with the selection; `dejar-abierta` records none. */
export type SaleIntent = "cobrar" | "dejar-abierta";

export interface SaleLine {
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPrice: Centavos;
}

/**
 * A sale as it was sent: its content and its identity, frozen at the tap. A
 * retry sends this very snapshot, so the server takes it for the same form
 * and records nothing twice.
 */
export interface SaleSnapshot {
  /** The submission key (README, "One submission per form"). */
  readonly key: string;
  readonly intent: SaleIntent;
  /** The Open Bill the Lines are added to, when Cuenta sent the User here. */
  readonly billId: string | null;
  readonly lines: ReadonlyArray<SaleLine>;
  readonly total: Centavos;
  readonly customer: SaleCustomer | null;
  readonly note: string;
  /** `handedOver` is for the change the screen shows; it is never sent. */
  readonly payment: {
    readonly method: PaymentMethod;
    readonly amount: Centavos;
    readonly handedOver: Centavos | null;
  } | null;
}

/** The Bill as the sale left it, in the server's answer. */
export interface SaleResult {
  readonly billId: string;
  readonly customerName: string | null;
  readonly total: Centavos;
  readonly owed: Centavos;
  readonly state: BillState;
  /** Whether this User may open the Bill: a Worker may not open a Paid one (spec §4.1). */
  readonly canOpen: boolean;
}

/** What the route answers a recorded sale with. */
export interface SaleAnswer {
  readonly sale: SaleResult;
}

export const isSaleAnswer = (answer: object): answer is SaleAnswer =>
  "sale" in answer && typeof answer.sale === "object" && answer.sale !== null;

/** A refused sale's answer: the reason, and what the screen has to do about it. */
export interface SaleRefusal extends Refusal {
  /** Items that are no longer sold: out of the selection, and not offered again. */
  readonly unavailable?: ReadonlyArray<string>;
  /** The Payment no longer fits the selection: a price changed, and the Items have to be read again. */
  readonly stalePrices?: true;
}

interface Phase {
  /** Items the server refused as retired: not offered again while the screen stays open. */
  readonly unavailable: ReadonlyArray<string>;
}

export type SaleState =
  | (Phase & { readonly phase: "editing"; readonly draft: SaleDraft; readonly refusal: string | null })
  /** Sent, not answered. `draft` is what comes back if it is refused. */
  | (Phase & { readonly phase: "recording"; readonly draft: SaleDraft; readonly snapshot: SaleSnapshot; readonly attempt: number })
  /**
   * No answer came: recorded or not, nobody knows yet. `sessionEnded` when a
   * retry was answered by Entrar: that attempt recorded nothing, an earlier
   * one may have, and no retry can tell until the User signs in again.
   */
  | (Phase & {
      readonly phase: "unknown";
      readonly draft: SaleDraft;
      readonly snapshot: SaleSnapshot;
      readonly attempt: number;
      readonly sessionEnded: boolean;
    })
  | (Phase & { readonly phase: "confirmed"; readonly snapshot: SaleSnapshot; readonly result: SaleResult });

export type SaleEvent =
  | { readonly type: "changed"; readonly itemId: string; readonly by: number }
  | { readonly type: "cleared" }
  | { readonly type: "fields"; readonly fields: Partial<SaleFields> }
  | { readonly type: "submitted"; readonly snapshot: SaleSnapshot }
  | { readonly type: "answered"; readonly key: string; readonly outcome: Recorded<SaleAnswer, SaleRefusal> }
  | { readonly type: "retried" }
  /** Nueva venta. */
  | { readonly type: "started" };

const NEW_DRAFT: SaleDraft = { quantities: {}, fields: { customer: null, note: "", payment: NEW_PAYMENT } };

export const NEW_SALE: Extract<SaleState, { phase: "editing" }> = { phase: "editing", draft: NEW_DRAFT, refusal: null, unavailable: [] };

function without(quantities: Quantities, itemIds: ReadonlyArray<string>): Quantities {
  return Object.fromEntries(Object.entries(quantities).filter(([itemId]) => !itemIds.includes(itemId)));
}

/** The sale after `event`. An event the phase does not allow changes nothing. */
export function saleAfter(state: SaleState, event: SaleEvent): SaleState {
  switch (event.type) {
    case "changed": {
      if (state.phase !== "editing" || state.unavailable.includes(event.itemId)) return state;
      const quantity = (state.draft.quantities[event.itemId] ?? 0) + event.by;
      const quantities = { ...without(state.draft.quantities, [event.itemId]), ...(quantity > 0 ? { [event.itemId]: quantity } : {}) };
      // A refusal is about the sale as it was sent: a change answers it.
      return { ...state, refusal: null, draft: { ...state.draft, quantities } };
    }
    case "fields":
      if (state.phase !== "editing") return state;
      return { ...state, refusal: null, draft: { ...state.draft, fields: { ...state.draft.fields, ...event.fields } } };
    case "cleared":
      return state.phase === "editing" ? { ...NEW_SALE, unavailable: state.unavailable } : state;
    case "submitted":
      if (state.phase !== "editing") return state;
      return { phase: "recording", draft: state.draft, snapshot: event.snapshot, attempt: 1, unavailable: state.unavailable };
    case "answered": {
      if (state.phase !== "recording" || state.snapshot.key !== event.key) return state;
      const { outcome } = event;
      if (outcome.outcome === "unknown") return { ...state, phase: "unknown", sessionEnded: false };
      // Entrar answered a retry: an earlier attempt may have been recorded,
      // so this is no evidence that nothing was, and the snapshot is kept.
      if (outcome.outcome === "refused" && outcome.answer.sessionEnded && state.attempt > 1) {
        return { ...state, phase: "unknown", sessionEnded: true };
      }
      if (outcome.outcome === "confirmed") {
        return { phase: "confirmed", snapshot: state.snapshot, result: outcome.answer.sale, unavailable: state.unavailable };
      }
      const gone = outcome.answer.unavailable ?? [];
      return {
        phase: "editing",
        draft: { ...state.draft, quantities: without(state.draft.quantities, gone) },
        refusal: outcome.answer.error,
        unavailable: [...state.unavailable, ...gone],
      };
    }
    case "retried":
      if (state.phase !== "unknown") return state;
      return {
        phase: "recording",
        draft: state.draft,
        snapshot: state.snapshot,
        attempt: state.attempt + 1,
        unavailable: state.unavailable,
      };
    case "started":
      return state.phase === "confirmed" ? { ...NEW_SALE, unavailable: state.unavailable } : state;
  }
}

/** The selection's Lines, in the catalog's order, and what they add up to. */
export function linesOf(quantities: Quantities, items: ReadonlyArray<SaleItem>) {
  const lines: SaleLine[] = items
    .filter((item) => (quantities[item.id] ?? 0) > 0)
    .map((item) => ({ itemId: item.id, name: item.name, quantity: quantities[item.id]!, unitPrice: item.price }));
  // Integer centavos times a whole number of units.
  const total = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  return { lines, total, units };
}

/**
 * The snapshot the draft is sent as, or why it cannot be sent yet. `key` is
 * new for every snapshot: `newId()` at the tap.
 */
export function snapshotOf(sale: {
  readonly draft: SaleDraft;
  readonly items: ReadonlyArray<SaleItem>;
  readonly billId: string | null;
  readonly intent: SaleIntent;
  readonly key: string;
}): SaleSnapshot | { readonly problem: string } {
  const { draft, intent, billId, key } = sale;
  const { lines, total } = linesOf(draft.quantities, sale.items);
  if (lines.length === 0) return { problem: "Agrega al menos un producto." };

  let payment: SaleSnapshot["payment"] = null;
  if (intent === "cobrar") {
    const read = readPaymentDraft(draft.fields.payment, total, paymentMessages.PaymentExceedsSelection);
    if (read.amount === null) return { problem: read.amountProblem! };
    payment = { method: draft.fields.payment.method, amount: read.amount, handedOver: read.handedOver };
  }
  // A Bill's Customer and note are set when it is opened or on Cuenta: a
  // selection added to one carries neither.
  const { customer, note } = billId === null ? draft.fields : { customer: null, note: "" };
  return { key, intent, billId, lines, total, customer, note: note.trim(), payment };
}

/** The form a snapshot is sent as: the same fields, in the same order, every time. */
export function saleBody(snapshot: SaleSnapshot): URLSearchParams {
  const body = new URLSearchParams({
    intent: snapshot.intent,
    selection: JSON.stringify(snapshot.lines.map(({ itemId, quantity }) => ({ itemId, quantity }))),
    customerId: snapshot.customer?.id ?? "",
    note: snapshot.note,
    billId: snapshot.billId ?? "",
    submissionKey: snapshot.key,
  });
  if (snapshot.payment) {
    body.set("method", snapshot.payment.method);
    body.set("amount", formatMoney(snapshot.payment.amount));
  }
  return body;
}

/** What the screen says while a snapshot is on its way. */
export function recordingText(snapshot: SaleSnapshot): string {
  if (snapshot.payment) return `Registrando pago de ${formatMoney(snapshot.payment.amount)}…`;
  return snapshot.billId ? "Agregando a la cuenta…" : "Dejando la cuenta abierta…";
}

/**
 * What a confirmed sale says (UI redesign §5.4): the Payment that was
 * recorded, if any, and what the Bill still owes. A Bill is called Paid only
 * when the server says nothing is owed: a Payment covers its own selection,
 * never a Customer's earlier debt on the same Bill.
 */
export function saleOutcome(snapshot: SaleSnapshot, result: SaleResult) {
  const { payment } = snapshot;
  const bill = result.customerName ? `La cuenta de ${result.customerName}` : "La cuenta";
  const title = payment ? "Pago registrado" : snapshot.billId ? "Productos agregados" : "Cuenta abierta";
  const paid = payment ? `${formatMoney(payment.amount)} ${paidByMethod[payment.method]}.` : "No se registró ningún pago.";
  const owed =
    result.owed === 0
      ? "Cuenta pagada."
      : `${bill} ${payment ? "todavía debe" : "debe"} ${formatMoney(result.owed)}.`;
  const change = payment?.handedOver != null ? formatMoney(changeFor(payment.handedOver, payment.amount)) : null;
  return { title, details: `${paid} ${owed}`, change };
}

/** The address's parameter that says the review step is on screen: `/?paso=cobrar`. */
export const STEP_PARAM = "paso";
export const REVIEW_STEP = "cobrar";

/** The same address with the step taken out: what the two steps of one sale share. */
function withoutStep(url: { readonly pathname: string; readonly search: string }): string {
  const search = new URLSearchParams(url.search);
  search.delete(STEP_PARAM);
  return `${url.pathname}?${search}`;
}

/** Whether going from one address to the other stays in the same sale: the same screen and target Bill. */
export function sameSale(
  from: { readonly pathname: string; readonly search: string },
  to: { readonly pathname: string; readonly search: string },
): boolean {
  return withoutStep(from) === withoutStep(to);
}

/** Whether a navigation only moved between the two steps, so no loader has anything new to read. */
export function onlyStepChanged(from: URL, to: URL): boolean {
  return from.search !== to.search && sameSale(from, to);
}

/** "1 producto", "3 productos": how many units a selection holds. */
export const unitsText = (units: number) => (units === 1 ? "1 producto" : `${units} productos`);
