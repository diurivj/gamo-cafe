import { data } from "react-router";
import { Effect } from "effect";

import type { ItemNotFound } from "~/backend/catalog";
import { type AdminOnly, CurrentUser } from "~/backend/current-user";
import {
  type AdjustmentAlreadyCancelled,
  type AdjustmentNotFound,
  adjustmentStanding,
  cancelAdjustment,
  type InvalidAdjustmentUnits,
  type ItemNotStockTracked,
  type ReasonMissing,
  recordAdjustment,
} from "~/backend/inventory";
import { run } from "~/backend/run.server";
import { requireAdminUser, text } from "~/catalog-forms.server";
import { ADJUSTMENT_REASONS } from "~/shared/adjustment";
import type { Refusal } from "~/shared/record-request";
import { adjustmentProblems, type StockChangeAnswer, STOCK_CHANGE_INTENTS } from "~/shared/stock-change";
import { trimToNull } from "~/shared/text";
import { parseUnits } from "~/shared/units";

import type { Route } from "./+types/record-stock-change";

// Where Inventario sends an Adjustment or the cancellation of one (UI
// redesign §6, §7; spec §5.8, §7.3). It answers JSON to the browser's own
// `fetch` (`sendForRecord` in ~/shared/record-request): the Item's Stock as
// the change left it, or the Spanish reason it was refused. Admin only:
// `requireAdminUser` refuses a Worker before the form is read, and the
// operations refuse one again.
//
// An Adjustment sent again with its key and content is answered as the first
// time and records nothing (README, "One submission per form"). A
// cancellation needs no key: an Adjustment is cancelled once, so the same one
// sent again after its answer was lost is refused and writes nothing. When
// the Adjustment already carries this Admin's own cancellation, with the
// reason that was sent, the answer is that cancellation.

type StockChangeError =
  | AdminOnly
  | ItemNotFound
  | InvalidAdjustmentUnits
  | ItemNotStockTracked
  | AdjustmentNotFound
  | AdjustmentAlreadyCancelled
  | ReasonMissing;

/** A refusal and its status. `cancelled`: somebody already cancelled this Adjustment. */
interface Refused extends Refusal {
  readonly status: 400 | 404;
  readonly cancelled?: true;
}

/** What each rule violation of `~/backend/inventory` answers, in Spanish. */
function answerStockChangeError(error: StockChangeError): Refused {
  switch (error._tag) {
    case "AdminOnly":
      throw new Response(null, { status: 403 });
    case "ItemNotFound":
      return { error: "Ese producto ya no existe.", status: 404 };
    case "AdjustmentNotFound":
      return { error: "Ese ajuste ya no existe.", status: 404 };
    case "InvalidAdjustmentUnits":
      return { error: adjustmentProblems.unitsInvalid, status: 400 };
    case "ItemNotStockTracked":
      return { error: "Este producto no lleva inventario.", status: 400 };
    case "AdjustmentAlreadyCancelled":
      return { error: "Este ajuste ya fue cancelado.", status: 400, cancelled: true };
    case "ReasonMissing":
      return { error: adjustmentProblems.whyMissing, status: 400 };
  }
}

const refuse = (error: string, status = 400) => data({ error } satisfies Refusal, { status });

export async function action({ context, request }: Route.ActionArgs) {
  const admin = requireAdminUser(context);
  const form = await request.formData();

  const intent = STOCK_CHANGE_INTENTS.find((known) => known === text(form, "intent"));
  if (!intent) return refuse("No entendimos esa acción. Recarga la página e intenta de nuevo.");

  // What a "registrar" carries; a "cancelar" carries the Adjustment and why.
  const reason = ADJUSTMENT_REASONS.find((known) => known === text(form, "reason"));
  const units = parseUnits(text(form, "units"));
  if (intent === "registrar") {
    if (!reason) return refuse("Elige un motivo.");
    if (units === undefined) return refuse(adjustmentProblems.unitsInvalid);
  }
  const adjustmentId = text(form, "adjustmentId");
  const why = text(form, "reason");

  const standing = Effect.gen(function* () {
    if (intent === "cancelar") {
      yield* cancelAdjustment(adjustmentId, why);
      return yield* adjustmentStanding(adjustmentId);
    }
    const { id } = yield* recordAdjustment({
      itemId: text(form, "itemId"),
      reason: reason!,
      units: units!,
      note: text(form, "note"),
      submissionKey: text(form, "submissionKey") || null,
    });
    return yield* adjustmentStanding(id);
  }).pipe(Effect.provideService(CurrentUser, admin));
  const recorded = await run(context, standing, answerStockChangeError);
  if (!("error" in recorded)) return { change: { stock: recorded.stock } } satisfies StockChangeAnswer;
  if (!recorded.cancelled) return refuse(recorded.error, recorded.status);

  // Refused as a second cancellation: the same one, sent again after its
  // answer was lost, when the Adjustment carries this Admin's own with the
  // reason that was sent.
  const already = await run(
    context,
    adjustmentStanding(adjustmentId).pipe(Effect.provideService(CurrentUser, admin)),
    answerStockChangeError,
  );
  const mine =
    !("error" in already) && already.cancellation?.by === admin.id && already.cancellation.reason === trimToNull(why);
  if (!mine) return refuse(recorded.error, recorded.status);
  return { change: { stock: already.stock } } satisfies StockChangeAnswer;
}
