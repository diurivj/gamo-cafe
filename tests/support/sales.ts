import type { BillPaymentRefusal, BillPaymentResult } from "~/shared/bill-payment";
import type { CorrectionRefusal, CorrectionResult } from "~/shared/correction";
import { COUNT_RECORD_PATH, type CountAnswer, type CountReviewAnswer, UNITS_FIELD } from "~/shared/count";
import type { CustomerPaymentRefusal, CustomerPaymentResult } from "~/shared/customer-payment";
import { INTERNAL_USE_RECORD_PATH, type InternalUseAnswer } from "~/shared/internal-use";
import type { Refusal } from "~/shared/record-request";
import type { SaleRefusal, SaleResult } from "~/shared/sale";
import { STOCK_CHANGE_PATH, type StockChangeResult } from "~/shared/stock-change";

import type { SignedIn } from "./auth";

/** Where Vender sends a sale (`app/routes/resources/record-sale.ts`). */
export const SALE_PATH = "/vender/registrar";

/**
 * Sends one sale as Vender does and reads the route's JSON answer: the Bill
 * as the sale left it, or the refusal.
 *
 *     const { sale } = await recordSale(beto, saleForm({ itemId }));
 *     const { response, error } = await recordSale(beto, { intent: "cobrar" });
 */
export async function recordSale(
  who: Pick<SignedIn, "fetch">,
  fields: URLSearchParams | Record<string, string>,
  init: RequestInit = {},
) {
  const response = await who.fetch(SALE_PATH, { ...init, method: "POST", body: new URLSearchParams(fields) });
  const answer = (await response.clone().json()) as Partial<{ sale: SaleResult } & SaleRefusal>;
  return { response, sale: answer.sale, error: answer.error, unavailable: answer.unavailable };
}

/**
 * One sale's fields as Vender sends them:
 *
 *     await recordSale(beto, saleForm({ itemId }));
 *
 * `intent` defaults to `dejar-abierta`; `cobrar` adds the Payment fields the
 * action reads. `submissionKey` is the key of the sale (ticket 28), which the
 * browser makes at the tap; a test that sends the same sale twice passes one.
 */
export function saleForm(sale: {
  readonly itemId: string;
  /** Defaults to 1. */
  readonly quantity?: number;
  /** Defaults to `dejar-abierta`. */
  readonly intent?: "dejar-abierta" | "cobrar";
  readonly submissionKey?: string;
}): URLSearchParams {
  const intent = sale.intent ?? "dejar-abierta";
  const form = new URLSearchParams({
    intent,
    selection: JSON.stringify([{ itemId: sale.itemId, quantity: sale.quantity ?? 1 }]),
    customerId: "",
    note: "",
    billId: "",
  });
  if (sale.submissionKey) form.set("submissionKey", sale.submissionKey);
  if (intent === "cobrar") {
    form.set("method", "cash");
    form.set("amount", "");
  }
  return form;
}

/** Where Cuenta sends a Payment (`app/routes/resources/record-payment.ts`). */
export const paymentPath = (billId: string) => `/cuentas/${billId}/cobrar`;

/**
 * Sends one Payment as Cuenta does and reads the route's JSON answer: the
 * Bill as the Payment left it, or the refusal. An empty `amount` pays
 * everything the Bill owes.
 *
 *     const { payment } = await recordPayment(beto, bill.id, { method: "cash", amount: "5.00", revision: "0" });
 */
export async function recordPayment(
  who: Pick<SignedIn, "fetch">,
  billId: string,
  fields: { readonly method: string; readonly amount: string; readonly revision: string; readonly submissionKey?: string },
) {
  const response = await who.fetch(paymentPath(billId), { method: "POST", body: new URLSearchParams(fields) });
  const answer = (await response.clone().json()) as Partial<{ payment: BillPaymentResult } & BillPaymentRefusal>;
  return { response, payment: answer.payment, error: answer.error, changed: answer.changed };
}

/** Where Cuenta sends a correction (`app/routes/resources/record-correction.ts`). */
export const correctionPath = (billId: string) => `/cuentas/${billId}/corregir`;

/**
 * Sends one correction as Cuenta does and reads the route's JSON answer: the
 * Bill as the correction left it, or the refusal.
 *
 *     const { correction } = await recordCorrection(ana, bill.id, { intent: "quitar-linea", lineId, revision: "3", reason: "De más" });
 */
export async function recordCorrection(
  who: Pick<SignedIn, "fetch">,
  billId: string,
  fields: Record<string, string>,
) {
  const response = await who.fetch(correctionPath(billId), { method: "POST", body: new URLSearchParams(fields) });
  const answer = (await response.clone().json()) as Partial<{ correction: CorrectionResult } & CorrectionRefusal>;
  return { response, correction: answer.correction, error: answer.error, changed: answer.changed };
}

/** Where a Customer's page sends an Abonar (`app/routes/resources/record-handover.ts`). */
export const handoverPath = (customerId: string) => `/clientes/${customerId}/abonar`;

/**
 * Sends one Abonar as the Customer's page does and reads the route's JSON
 * answer: what the handover recorded, or the refusal. `bills` is every Open
 * Bill the page showed, as `billId:revision`.
 *
 *     const { handover } = await recordHandover(beto, ruiz.id, { amount: "60.00", bills: ["vieja:0", "nueva:0"] });
 */
export async function recordHandover(
  who: Pick<SignedIn, "fetch">,
  customerId: string,
  fields: {
    /** Defaults to cash. */
    readonly method?: string;
    readonly amount: string;
    readonly bills: ReadonlyArray<string>;
    readonly submissionKey?: string;
  },
) {
  const body = new URLSearchParams({ method: fields.method ?? "cash", amount: fields.amount });
  if (fields.submissionKey) body.set("submissionKey", fields.submissionKey);
  for (const bill of fields.bills) body.append("bill", bill);
  const response = await who.fetch(handoverPath(customerId), { method: "POST", body });
  const answer = (await response.clone().json()) as Partial<{ handover: CustomerPaymentResult } & CustomerPaymentRefusal>;
  return { response, handover: answer.handover, error: answer.error, changed: answer.changed };
}

/**
 * Sends one change of Stock as Inventario does and reads the route's JSON
 * answer: the Item's Stock as the change left it, or the refusal. A Worker is
 * answered 403 with no JSON, so `change` and `error` are both undefined.
 *
 *     const { change } = await recordStockChange(ana, { intent: "registrar", itemId, reason: "restock", units: "4" });
 *     await recordStockChange(ana, { intent: "cancelar", adjustmentId, reason: "Se contó dos veces" });
 */
export async function recordStockChange(who: Pick<SignedIn, "fetch">, fields: Record<string, string>) {
  const response = await who.fetch(STOCK_CHANGE_PATH, { method: "POST", body: new URLSearchParams(fields) });
  const answer = (await response
    .clone()
    .json()
    .catch(() => ({}))) as Partial<{ change: StockChangeResult } & Refusal>;
  return { response, change: answer.change, error: answer.error };
}

/**
 * Sends what Conteo sends — the review of a Count, or the Count itself — and
 * reads the route's JSON answer. `counted` is the units found by Item id. A
 * Worker is answered 403 with no JSON, so everything but `response` is
 * undefined.
 *
 *     const { review } = await sendCount(ana, "revisar", { [cafe.id]: "45" });
 *     const { count } = await sendCount(ana, "registrar", { [cafe.id]: "45" }, { note: "De la tarde", submissionKey });
 */
export async function sendCount(
  who: Pick<SignedIn, "fetch">,
  intent: string,
  counted: Readonly<Record<string, string>>,
  fields: Readonly<Record<string, string>> = {},
) {
  const body = new URLSearchParams({ intent, ...fields });
  for (const [itemId, found] of Object.entries(counted)) body.set(`${UNITS_FIELD}${itemId}`, found);
  const response = await who.fetch(COUNT_RECORD_PATH, { method: "POST", body });
  const answer = (await response
    .clone()
    .json()
    .catch(() => ({}))) as Partial<CountReviewAnswer & CountAnswer & Refusal>;
  return { response, review: answer.review, count: answer.count, error: answer.error };
}

/**
 * Sends one Internal use as Consumo interno does and reads the route's JSON
 * answer: that it was recorded, or the refusal.
 *
 *     const { internalUse } = await sendInternalUse(beto, { itemId, units: "2", submissionKey });
 */
export async function sendInternalUse(who: Pick<SignedIn, "fetch">, fields: Record<string, string>) {
  const response = await who.fetch(INTERNAL_USE_RECORD_PATH, { method: "POST", body: new URLSearchParams(fields) });
  const answer = (await response
    .clone()
    .json()
    .catch(() => ({}))) as Partial<InternalUseAnswer & Refusal>;
  return { response, internalUse: answer.internalUse, error: answer.error };
}
