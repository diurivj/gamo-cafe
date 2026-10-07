import { data } from "react-router";
import { Effect, Result, Schema } from "effect";

import {
  type BillNotFound,
  type BillNotOpen,
  type CustomerUnavailable,
  type EmptySelection,
  type InvalidQuantity,
  type ItemUnavailable,
  type NewSelection,
  type NewSelectionPayment,
  type NoteTooLong,
  recordSelection,
  type TargetConflict,
} from "~/backend/bills";
import { CurrentUser } from "~/backend/current-user";
import { type PaymentExceedsOwed, type PaymentNotPositive } from "~/backend/payments";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";
import { isOpenBill } from "~/shared/bill-state";
import { parsePesos } from "~/shared/money";
import { PAYMENT_METHODS, type PaymentMethod } from "~/shared/payment";
import { paymentMessages } from "~/shared/payment-messages";
import type { SaleAnswer, SaleRefusal } from "~/shared/sale";

import type { Route } from "./+types/record-sale";

// Where Vender sends a sale (UI redesign §6): the selection, and with
// `intent=cobrar` a Payment, recorded in the one batch of `recordSelection`
// (spec §7.3.1). It answers JSON to the browser's own `fetch`
// (`sendForRecord` in ~/shared/record-request): the Bill as the sale left it,
// or 400 with the Spanish reason. A sale sent again with its key and content
// is answered as the first time and records nothing (README, "One submission
// per form"), which is what makes Vender's retry safe.

/** The selection as the browser sends it, in the `selection` form field. */
const SelectionField = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ itemId: Schema.String, quantity: Schema.Int })),
);

/** The sale's fields as `recordSelection` takes them. */
function readSelection(form: FormData): NewSelection | SaleRefusal {
  const parsed = Schema.decodeUnknownResult(SelectionField)(String(form.get("selection") ?? ""));
  if (!Result.isSuccess(parsed)) return { error: "No pudimos leer la selección. Recarga la página." };
  return {
    items: parsed.success,
    customerId: String(form.get("customerId") ?? "") || null,
    note: String(form.get("note") ?? "") || null,
    billId: String(form.get("billId") ?? "") || null,
    submissionKey: String(form.get("submissionKey") ?? "") || null,
  };
}

/** What `cobrar` sends besides the selection: a method and an optional amount. */
function readPayment(form: FormData): NewSelectionPayment | SaleRefusal {
  const decoded = Schema.decodeUnknownResult(Schema.Literals(PAYMENT_METHODS))(
    String(form.get("method") ?? ""),
  );
  if (!Result.isSuccess(decoded)) return { error: paymentMessages.MethodMissing };

  const method: PaymentMethod = decoded.success;
  const typed = String(form.get("amount") ?? "").trim();
  if (typed === "") return { method, amount: null };
  const amount = parsePesos(typed);
  if (amount === undefined) return { error: paymentMessages.InvalidAmount };
  return { method, amount };
}

type SelectionError =
  | BillNotFound
  | BillNotOpen
  | CustomerUnavailable
  | EmptySelection
  | InvalidQuantity
  | ItemUnavailable
  | NoteTooLong
  | PaymentExceedsOwed
  | PaymentNotPositive
  | TargetConflict;

/** What each rule violation of `recordSelection` answers, in Spanish. */
function answerSelectionError(error: SelectionError): SaleRefusal {
  switch (error._tag) {
    case "BillNotFound":
      return { error: "Esa cuenta ya no existe. Registra los productos en una cuenta nueva." };
    case "EmptySelection":
      return { error: "Agrega al menos un producto." };
    case "InvalidQuantity":
      return { error: "Las cantidades deben ser números enteros mayores a cero." };
    case "NoteTooLong":
      return { error: "La nota no puede pasar de 80 caracteres." };
    case "ItemUnavailable":
      // The screen takes them out of the selection and stops offering them.
      return {
        error: "Un producto ya no está disponible y se quitó de la selección. Revísala y vuelve a registrar.",
        unavailable: error.itemIds,
      };
    case "CustomerUnavailable":
      return { error: "Ese cliente no existe o está retirado." };
    case "TargetConflict":
      return { error: "No se puede elegir cliente ni nota al agregar a una cuenta abierta." };
    case "BillNotOpen":
      return { error: "Esta cuenta ya no está abierta. Registra los productos en una cuenta nueva." };
    case "PaymentNotPositive":
      return { error: paymentMessages.PaymentNotPositive };
    case "PaymentExceedsOwed":
      // Vender never sends more than the total it shows, so the total it
      // showed may not be today's: the screen reads the Items again.
      return { error: paymentMessages.PaymentExceedsSelection, stalePrices: true };
  }
}

export async function action({ context, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "dejar-abierta" && intent !== "cobrar") {
    return data({ error: "No entendimos esa acción. Recarga la página e intenta de nuevo." }, { status: 400 });
  }

  const selection = readSelection(form);
  if ("error" in selection) return data(selection, { status: 400 });

  let payment: NewSelectionPayment | null = null;
  if (intent === "cobrar") {
    const read = readPayment(form);
    if ("error" in read) return data(read, { status: 400 });
    payment = read;
  }

  const program = recordSelection({ ...selection, payment }).pipe(Effect.provideService(CurrentUser, user));
  const bill = await run(context, program, answerSelectionError);
  if ("error" in bill) return data(bill, { status: 400 });

  return {
    sale: {
      billId: bill.id,
      customerName: bill.customer?.name ?? null,
      total: bill.total,
      owed: bill.owed,
      state: bill.state,
      // The gate of `getBill`: a Worker opens only Open Bills (spec §4.1).
      canOpen: user.role === "admin" || isOpenBill(bill.state),
    },
  } satisfies SaleAnswer;
}
