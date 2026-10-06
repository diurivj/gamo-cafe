import { Effect } from "effect";
import { Form, Link, useNavigation } from "react-router";

import type { ItemNotFound } from "~/backend/catalog";
import type { AdminOnly } from "~/backend/current-user";
import { CurrentUser } from "~/backend/current-user";
import type { Db, DbError } from "~/backend/db";
import {
  type AdjustmentAlreadyCancelled,
  type AdjustmentNotFound,
  cancelAdjustment,
  type InvalidAdjustmentUnits,
  type ItemNotStockTracked,
  listInventory,
  listRecentAdjustments,
  type ReasonMissing,
  recordAdjustment,
} from "~/backend/inventory";
import { run } from "~/backend/run.server";
import { type Refusal, refuseRead, refused, requireAdminUser, text } from "~/catalog-forms.server";
import { ADJUSTMENT_REASONS, adjustmentReasonLabel, adjustmentSign } from "~/shared/adjustment";
import { formatDay } from "~/shared/day";
import { newId } from "~/shared/id";
import { parseUnits } from "~/shared/units";

import type { Route } from "./+types/inventario";

export const meta: Route.MetaFunction = () => [{ title: "Inventario · Gamo Cafe" }];

export async function loader({ context }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const inventory = await run(
    context,
    Effect.all({ lines: listInventory, adjustments: listRecentAdjustments() }).pipe(
      Effect.provideService(CurrentUser, admin),
    ),
    refuseRead,
  );
  return inventory;
}

type InventoryError =
  | AdminOnly
  | ItemNotFound
  | InvalidAdjustmentUnits
  | ItemNotStockTracked
  | AdjustmentNotFound
  | AdjustmentAlreadyCancelled
  | ReasonMissing;

/** The operation a submitted form asks for, or why the form cannot be read. */
function operation(form: FormData): Effect.Effect<unknown, InventoryError | DbError, Db | CurrentUser> | Refusal {
  switch (text(form, "intent")) {
    case "record-adjustment": {
      const reason = ADJUSTMENT_REASONS.find((known) => known === text(form, "reason"));
      if (!reason) return { error: "Elige un motivo." };
      const units = parseUnits(text(form, "units"));
      if (units === undefined) return { error: "Las unidades deben ser un número entero, uno o más." };
      return recordAdjustment({ itemId: text(form, "itemId"), reason, units, note: text(form, "note") });
    }
    case "cancel-adjustment":
      return cancelAdjustment(text(form, "adjustmentId"), text(form, "reason"));
    default:
      return { error: "No entendimos esa acción. Recarga la página e intenta de nuevo." };
  }
}

/** The answer to each rule violation of `~/backend/inventory`, for `run`. */
function answerInventoryError(error: InventoryError): Refusal {
  switch (error._tag) {
    case "AdminOnly":
      throw new Response(null, { status: 403 });
    case "ItemNotFound":
    case "AdjustmentNotFound":
      throw new Response(null, { status: 404 });
    case "InvalidAdjustmentUnits":
      return { error: "Las unidades deben ser un número entero, uno o más." };
    case "ItemNotStockTracked":
      return { error: "Este producto no lleva inventario." };
    case "AdjustmentAlreadyCancelled":
      return { error: "Este ajuste ya fue cancelado." };
    case "ReasonMissing":
      return { error: "Escribe el motivo de la cancelación." };
  }
}

export async function action({ context, request }: Route.ActionArgs) {
  const admin = requireAdminUser(context);
  const form = await request.formData();
  // Which form on the page this is, so a refusal is shown on it.
  const formKey = `${text(form, "intent")}:${text(form, "adjustmentId")}`;

  const asked = operation(form);
  if (!Effect.isEffect(asked)) return refused(asked, formKey);

  const result = await run(
    context,
    // `done` is new on every success: the page uses it to empty the form.
    asked.pipe(Effect.as({ done: newId() }), Effect.provideService(CurrentUser, admin)),
    answerInventoryError,
  );
  return "error" in result ? refused(result, formKey) : { ...result, form: formKey };
}

const field = "w-full rounded-xl border border-stone-300 bg-white px-4 py-3";
const button = "rounded-xl border border-stone-300 bg-white px-4 py-3 font-medium disabled:opacity-60";
const primaryButton = "rounded-xl bg-stone-900 px-4 py-3 font-semibold text-white disabled:opacity-60";

function Refused({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-red-700">
      {message}
    </p>
  ) : null;
}

export default function Inventario({ loaderData, actionData }: Route.ComponentProps) {
  const { lines, adjustments } = loaderData;
  const busy = useNavigation().state !== "idle";
  const errorOn = (form: string) =>
    actionData && "error" in actionData && actionData.form === form ? actionData.error : undefined;
  // A form that was just recorded starts over, empty.
  const fresh = (form: string) =>
    actionData && "done" in actionData && actionData.form === form ? actionData.done : form;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">Inventario</h1>

      <section aria-labelledby="conteo" className="rounded-2xl border border-stone-200 bg-white p-4">
        <h2 id="conteo" className="text-xl font-semibold">
          Conteo
        </h2>
        <p className="mt-1 text-stone-600">
          Cuenta las unidades que hay en el estante y registra las diferencias contra las existencias.
        </p>
        <Link
          to="/inventario/conteo"
          className="mt-4 inline-block rounded-xl border border-stone-300 bg-white px-4 py-3 font-medium"
        >
          Iniciar conteo
        </Link>
      </section>

      <section aria-labelledby="registrar-ajuste" className="rounded-2xl border border-stone-200 bg-white p-4">
        <h2 id="registrar-ajuste" className="text-xl font-semibold">
          Registrar ajuste
        </h2>
        <p className="mt-1 text-stone-600">
          Un ajuste cambia las existencias sin venta: Entrada suma; Merma y Consumo interno restan.
        </p>
        <Form method="post" key={fresh("record-adjustment:")} className="mt-4 flex flex-col gap-4">
          <input type="hidden" name="intent" value="record-adjustment" />
          <label className="flex flex-col gap-1">
            <span className="font-medium">Producto</span>
            <select name="itemId" required defaultValue="" className={field}>
              <option value="" disabled>
                Elige un producto
              </option>
              {lines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Motivo</span>
            <select name="reason" defaultValue="restock" className={field}>
              {ADJUSTMENT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {adjustmentReasonLabel[reason]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Unidades</span>
            <input name="units" inputMode="numeric" required autoComplete="off" className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Nota (opcional)</span>
            <input name="note" autoComplete="off" className={field} />
          </label>
          <Refused message={errorOn("record-adjustment:")} />
          <button type="submit" disabled={busy} className={primaryButton}>
            Registrar ajuste
          </button>
        </Form>
      </section>

      <section aria-labelledby="existencias">
        <h2 id="existencias" className="text-xl font-semibold">
          Existencias
        </h2>
        {lines.length === 0 ? (
          <p className="mt-3 text-stone-600">Todavía no hay productos con inventario.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white px-4">
            {lines.map((line) => (
              <li key={line.id} aria-label={line.name} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words font-medium">
                    {line.name}
                    {line.retired ? <span className="text-stone-600"> (retirado)</span> : null}
                  </p>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {line.needsRestock ? (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium">Reponer</span>
                    ) : null}
                    {line.belowZero ? (
                      <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-800">
                        Bajo cero
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="text-stone-600">{`Existencias: ${line.stock} · Mínimo: ${line.minimum ?? "—"}`}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ajustes-recientes">
        <h2 id="ajustes-recientes" className="text-xl font-semibold">
          Ajustes recientes
        </h2>
        {adjustments.length === 0 ? (
          <p className="mt-3 text-stone-600">Todavía no hay ajustes.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {adjustments.map((adjustment) => (
              <li
                key={adjustment.id}
                aria-label={`${adjustmentReasonLabel[adjustment.reason]} de ${adjustment.units} de ${adjustment.itemName}`}
                className="rounded-2xl border border-stone-200 bg-white p-4"
              >
                <p className="font-medium">{`${adjustmentReasonLabel[adjustment.reason]} ${
                  adjustmentSign(adjustment.reason) === 1 ? "+" : "-"
                }${adjustment.units} · ${adjustment.itemName}`}</p>
                <p className="break-words text-stone-600">{`${formatDay(adjustment.day)} · ${adjustment.byName}${
                  adjustment.note ? ` · ${adjustment.note}` : ""
                }`}</p>
                {adjustment.cancellation ? (
                  <p className="mt-2 text-stone-600">{`Cancelado: ${adjustment.cancellation.reason} · ${adjustment.cancellation.byName}`}</p>
                ) : (
                  <Form method="post" className="mt-3 flex flex-col gap-2">
                    <input type="hidden" name="intent" value="cancel-adjustment" />
                    <input type="hidden" name="adjustmentId" value={adjustment.id} />
                    <label className="flex flex-col gap-1">
                      <span className="font-medium">Motivo de la cancelación</span>
                      <input name="reason" required maxLength={80} autoComplete="off" className={field} />
                    </label>
                    <Refused message={errorOn(`cancel-adjustment:${adjustment.id}`)} />
                    <button type="submit" disabled={busy} className={button}>
                      Cancelar ajuste
                    </button>
                  </Form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
