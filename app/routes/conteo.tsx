import { Effect } from "effect";
import { Form, Link, redirect, useNavigation } from "react-router";

import type { ItemNotFound } from "~/backend/catalog";
import {
  type CountedInput,
  type InvalidCountUnits,
  listCountItems,
  type NoItemsCounted,
  previewCount,
  recordCount,
} from "~/backend/counts";
import type { AdminOnly } from "~/backend/current-user";
import { CurrentUser } from "~/backend/current-user";
import type { ItemNotStockTracked } from "~/backend/inventory";
import { run } from "~/backend/run.server";
import { type Refusal, refuseRead, refused, requireAdminUser, text } from "~/catalog-forms.server";
import { CountLineItem } from "~/components/count-line";
import { parseUnits } from "~/shared/units";

import type { Route } from "./+types/conteo";

export const meta: Route.MetaFunction = () => [{ title: "Conteo · Gamo Cafe" }];

export async function loader({ context }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const lines = await run(
    context,
    listCountItems.pipe(Effect.provideService(CurrentUser, admin)),
    refuseRead,
  );
  return { lines };
}

type CountError = AdminOnly | ItemNotFound | ItemNotStockTracked | NoItemsCounted | InvalidCountUnits;

/**
 * The units the Admin typed, one field per Item (`units.<itemId>`). An empty
 * field is an Item left out of the Count. What cannot be read is answered
 * here; what breaks a rule is left to the operation.
 */
function parseCounted(form: FormData): { readonly lines: ReadonlyArray<CountedInput> } | Refusal {
  const lines: Array<CountedInput> = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith("units.") || typeof value !== "string" || value.trim() === "") continue;
    const found = parseUnits(value);
    if (found === undefined) return { error: "Las unidades contadas deben ser un número entero, cero o más." };
    lines.push({ itemId: name.slice("units.".length), found });
  }
  if (lines.length === 0) return { error: "Escribe las unidades de al menos un producto." };
  return { lines };
}

/** The answer to each rule violation of `~/backend/counts`, for `run`. */
function answerCountError(error: CountError): Refusal {
  switch (error._tag) {
    case "AdminOnly":
      throw new Response(null, { status: 403 });
    case "ItemNotFound":
      throw new Response(null, { status: 404 });
    case "ItemNotStockTracked":
      return { error: "Este producto no lleva inventario." };
    case "NoItemsCounted":
      return { error: "Escribe las unidades de al menos un producto." };
    case "InvalidCountUnits":
      return { error: "Las unidades contadas deben ser un número entero, cero o más." };
  }
}

export async function action({ context, request }: Route.ActionArgs) {
  const admin = requireAdminUser(context);
  const form = await request.formData();
  const intent = text(form, "intent");

  if (intent !== "review" && intent !== "confirm") {
    return refused({ error: "No entendimos esa acción. Recarga la página e intenta de nuevo." }, "review");
  }

  const counted = parseCounted(form);
  if ("error" in counted) return refused(counted, intent === "confirm" ? "confirm" : "review");

  if (intent === "review") {
    const lines = await run(
      context,
      previewCount(counted.lines).pipe(Effect.provideService(CurrentUser, admin)),
      answerCountError,
    );
    if ("error" in lines) return refused(lines, "review");
    return { review: { lines, note: text(form, "note").trim() }, form: "review" };
  }

  // The only intent left is confirming.
  const result = await run(
    context,
    recordCount({ lines: counted.lines, note: text(form, "note") }).pipe(
      Effect.provideService(CurrentUser, admin),
    ),
    answerCountError,
  );
  if ("error" in result) return refused(result, "confirm");
  return redirect("/diferencias");
}

const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3";
const primaryButton = "rounded-xl bg-stone-900 px-4 py-3 font-semibold text-white disabled:opacity-60";

function Refused({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-red-700">
      {message}
    </p>
  ) : null;
}

export default function Conteo({ loaderData, actionData }: Route.ComponentProps) {
  const { lines } = loaderData;
  const busy = useNavigation().state !== "idle";
  const review = actionData && "review" in actionData ? actionData.review : undefined;
  const errorOn = (form: string) =>
    actionData && "error" in actionData && actionData.form === form ? actionData.error : undefined;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">Conteo</h1>

      {review ? (
        <section aria-labelledby="revision" className="rounded-2xl border border-stone-200 bg-white p-4">
          <h2 id="revision" className="text-xl font-semibold">
            Revisión del conteo
          </h2>
          <p className="mt-1 text-stone-600">
            Al confirmar, las existencias de cada producto quedarán con las unidades contadas.
          </p>
          <ul className="mt-4 flex flex-col divide-y divide-stone-200">
            {review.lines.map((line) => (
              <CountLineItem key={line.itemId} line={line} />
            ))}
          </ul>
          <Form method="post" className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="intent" value="confirm" />
            <input type="hidden" name="note" value={review.note} />
            {review.lines.map((line) => (
              <input key={line.itemId} type="hidden" name={`units.${line.itemId}`} value={line.found} />
            ))}
            <Refused message={errorOn("confirm")} />
            <button type="submit" disabled={busy} className={primaryButton}>
              Confirmar conteo
            </button>
          </Form>
          <Link to="/inventario/conteo" className="mt-4 inline-block font-medium underline">
            Volver a contar
          </Link>
        </section>
      ) : (
        <section aria-labelledby="contar" className="rounded-2xl border border-stone-200 bg-white p-4">
          <h2 id="contar" className="text-xl font-semibold">
            Contar existencias
          </h2>
          <p className="mt-1 text-stone-600">
            Escribe las unidades que encontraste. Las existencias esperadas no se ven hasta la revisión.
          </p>
          {lines.length === 0 ? (
            <p className="mt-3 text-stone-600">Todavía no hay productos con inventario.</p>
          ) : (
            <Form method="post" className="mt-4 flex flex-col gap-4">
              <input type="hidden" name="intent" value="review" />
              <ul className="flex flex-col divide-y divide-stone-200">
                {lines.map((line) => (
                  <li key={line.id} className="flex items-center justify-between gap-3 py-3">
                    <label htmlFor={`contar-${line.id}`} className="min-w-0 break-words font-medium">
                      {line.name}
                      {line.retired ? <span className="text-stone-600"> (retirado)</span> : null}
                    </label>
                    <input
                      id={`contar-${line.id}`}
                      name={`units.${line.id}`}
                      inputMode="numeric"
                      autoComplete="off"
                      className="w-24 rounded-xl border border-stone-300 bg-white px-4 py-3"
                    />
                  </li>
                ))}
              </ul>
              <label className="flex flex-col gap-1">
                <span className="font-medium">Nota (opcional)</span>
                <input name="note" autoComplete="off" className={field} />
              </label>
              <Refused message={errorOn("review")} />
              <button type="submit" disabled={busy} className={primaryButton}>
                Revisar conteo
              </button>
            </Form>
          )}
        </section>
      )}
    </div>
  );
}
