/**
 * One sale's fields as Vender's form sends them:
 *
 *     await beto.fetch("/?index", { method: "POST", body: saleForm({ itemId }) });
 *
 * `intent` defaults to `dejar-abierta`; `cobrar` adds the Payment fields its
 * action reads. `submissionKey` is the key of the rendered form (ticket 28),
 * which a browser makes; a test that sends the same form twice passes one.
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
