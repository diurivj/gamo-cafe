import type { SaleRefusal, SaleResult } from "~/shared/sale";

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
