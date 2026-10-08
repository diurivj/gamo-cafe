import { data } from "react-router";
import { Effect } from "effect";

import type { ItemNotFound } from "~/backend/catalog";
import {
  type CountedInput,
  type InvalidCountUnits,
  type NoItemsCounted,
  previewCount,
  recordCountAndRead,
} from "~/backend/counts";
import { type AdminOnly, CurrentUser } from "~/backend/current-user";
import type { ItemNotStockTracked } from "~/backend/inventory";
import { run } from "~/backend/run.server";
import { requireAdminUser, text } from "~/catalog-forms.server";
import {
  COUNT_INTENTS,
  type CountAnswer,
  countProblems,
  type CountReviewAnswer,
  UNITS_FIELD,
} from "~/shared/count";
import type { Refusal } from "~/shared/record-request";
import { parseUnits } from "~/shared/units";

import type { Route } from "./+types/record-count";

// Where Conteo asks for the review of a Count and sends the Count itself (UI
// redesign §6, §7; spec §5.8, §7.3). It answers JSON to the browser's own
// `fetch` (`sendForRecord` in ~/shared/record-request). Admin only:
// `requireAdminUser` refuses a Worker before the form is read, and the
// operations refuse one again.
//
// "revisar" reads and records nothing: each counted Item with the Stock
// expected now. This is the only place the expected numbers leave the server
// for Conteo. "registrar" records the Count and answers it as it was
// recorded: what was expected is read again inside its batch, so it is the
// Stock of that moment and not what a review showed. Sent again with its key
// and content, it is answered as the first time and records nothing (README,
// "One submission per form").

type CountError = AdminOnly | ItemNotFound | ItemNotStockTracked | NoItemsCounted | InvalidCountUnits;

interface Refused extends Refusal {
  readonly status: 400 | 404;
}

/** What each rule violation of `~/backend/counts` answers, in Spanish. */
function answerCountError(error: CountError): Refused {
  switch (error._tag) {
    case "AdminOnly":
      throw new Response(null, { status: 403 });
    case "ItemNotFound":
      return { error: "Un producto del conteo ya no existe. Revisa la lista y vuelve a intentar.", status: 404 };
    case "ItemNotStockTracked":
      return { error: "Un producto del conteo ya no lleva inventario. Revisa la lista y vuelve a intentar.", status: 400 };
    case "NoItemsCounted":
      return { error: countProblems.nothingCounted, status: 400 };
    case "InvalidCountUnits":
      return { error: countProblems.unitsInvalid, status: 400 };
  }
}

const refuse = (error: string, status = 400) => data({ error } satisfies Refusal, { status });

/**
 * The units the Admin typed, one field per Item (`units.<itemId>`). An empty
 * field is an Item left out of the Count. What cannot be read is answered
 * here; what breaks a rule is left to the operation.
 */
function parseCounted(form: FormData): ReadonlyArray<CountedInput> | Refusal {
  const lines: Array<CountedInput> = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith(UNITS_FIELD) || typeof value !== "string" || value.trim() === "") continue;
    const found = parseUnits(value);
    if (found === undefined) return { error: countProblems.unitsInvalid };
    lines.push({ itemId: name.slice(UNITS_FIELD.length), found });
  }
  return lines.length === 0 ? { error: countProblems.nothingCounted } : lines;
}

export async function action({ context, request }: Route.ActionArgs) {
  const admin = requireAdminUser(context);
  const form = await request.formData();

  const intent = COUNT_INTENTS.find((known) => known === text(form, "intent"));
  if (!intent) return refuse("No entendimos esa acción. Recarga la página e intenta de nuevo.");

  const counted = parseCounted(form);
  if ("error" in counted) return refuse(counted.error);

  if (intent === "revisar") {
    const lines = await run(
      context,
      previewCount(counted).pipe(Effect.provideService(CurrentUser, admin)),
      answerCountError,
    );
    if ("error" in lines) return refuse(lines.error, lines.status);
    return { review: { lines } } satisfies CountReviewAnswer;
  }

  const recording = recordCountAndRead({
    lines: counted,
    note: text(form, "note"),
    submissionKey: text(form, "submissionKey") || null,
  }).pipe(Effect.provideService(CurrentUser, admin));
  const recorded = await run(context, recording, answerCountError);
  if ("error" in recorded) return refuse(recorded.error, recorded.status);
  return { count: { id: recorded.id, lines: recorded.lines } } satisfies CountAnswer;
}
