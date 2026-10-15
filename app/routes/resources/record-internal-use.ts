import { data } from "react-router";
import { Effect } from "effect";

import { CurrentUser } from "~/backend/current-user";
import { recordInternalUse } from "~/backend/inventory";
import { run } from "~/backend/run.server";
import { text } from "~/catalog-forms.server";
import { requireUser } from "~/session.server";
import type { InternalUseAnswer } from "~/shared/internal-use";
import type { Refusal } from "~/shared/record-request";
import { adjustmentProblems } from "~/shared/stock-change";
import { parseUnits } from "~/shared/units";

import type { Route } from "./+types/record-internal-use";

// Where Consumo interno sends an Internal use (spec §4.1, §5.8; UI redesign
// §6): `recordInternalUse`, as any User, a Worker included. It answers JSON
// to the browser's own `fetch` (`sendForRecord` in ~/shared/record-request):
// that it was recorded, and nothing of the Item's Stock, which a Worker never
// sees (spec §4.2); or the Spanish reason it was refused. Sent again with its
// key and content it is answered as the first time and records nothing
// (README, "One submission per form").

/** A refusal and its status. */
interface Refused extends Refusal {
  readonly status: 400 | 404;
}

const refuse = (error: string, status = 400) => data({ error } satisfies Refusal, { status });

export async function action({ context, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();

  const itemId = text(form, "itemId");
  if (itemId === "") return refuse(adjustmentProblems.itemMissing);
  const units = parseUnits(text(form, "units"));
  if (units === undefined) return refuse(adjustmentProblems.unitsInvalid);

  const program = recordInternalUse({
    itemId,
    units,
    note: text(form, "note"),
    submissionKey: text(form, "submissionKey") || null,
  }).pipe(Effect.provideService(CurrentUser, user));
  const recorded = await run(context, program, (error): Refused => {
    switch (error._tag) {
      case "ItemNotFound":
        return { error: "Ese producto ya no existe.", status: 404 };
      case "ItemNotStockTracked":
        return { error: "Ese producto ya no lleva inventario: su consumo no se registra aquí.", status: 400 };
      case "InvalidAdjustmentUnits":
        return { error: adjustmentProblems.unitsInvalid, status: 400 };
    }
  });

  if ("error" in recorded) return refuse(recorded.error, recorded.status);
  return { internalUse: { id: recorded.id } } satisfies InternalUseAnswer;
}
