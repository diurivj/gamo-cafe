import { Effect } from "effect";
import { Link } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { type HistoryCursor, type HistoryEntry, listHistory } from "~/backend/history";
import { run } from "~/backend/run.server";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
import { adjustmentReasonLabel, adjustmentSign, type AdjustmentReason } from "~/shared/adjustment";
import { dayOf, formatDay, formatTime } from "~/shared/day";
import { formatMoney } from "~/shared/money";
import { paymentMethodLabel } from "~/shared/payment";

import type { Route } from "./+types/historial";

// Historial (spec §6.2): the corrections and Adjustments, newest first, with
// who, when and why, 50 per page. Admin only: a Worker never sees History
// (spec §4.1, §4.2). The page is a keyset over the fact tables, so it stays
// cheap at any history size (§2.4).

export const meta: Route.MetaFunction = () => [{ title: "Historial · Gamo Cafe" }];

/** The keyset the URL carries, or the first page when it is unreadable. */
function cursorFrom(url: URL): HistoryCursor | null {
  const at = Number(url.searchParams.get("antes"));
  const id = url.searchParams.get("id") ?? "";
  return Number.isSafeInteger(at) && at >= 0 && id !== "" ? { at, id } : null;
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const page = await run(
    context,
    listHistory(cursorFrom(new URL(request.url))).pipe(Effect.provideService(CurrentUser, admin)),
    refuseRead,
  );
  return page;
}

/**
 * Everything one row shows, from the entry alone: its line, its link, the
 * note under it and the reason an Admin owed. One switch per kind, so a kind
 * the entry union gains cannot be forgotten.
 */
interface EntryView {
  readonly headline: string;
  readonly target: { readonly to: string; readonly label: string };
  readonly detail: string | null;
  readonly reason: string | null;
}

const billTarget = (entry: { readonly billId: string }) => ({
  to: `/cuentas/${entry.billId}`,
  label: "Ver cuenta",
});

const billDetail = (entry: { readonly billLabel: string | null }) =>
  `Cuenta ${entry.billLabel === null ? "sin cliente" : `de ${entry.billLabel}`}`;

/** An Adjustment's line, with the sign its reason gives it (spec §5.8). */
const adjustmentText = (reason: AdjustmentReason, units: number, itemName: string) =>
  `${adjustmentReasonLabel[reason]} ${adjustmentSign(reason) === 1 ? "+" : "-"}${units} · ${itemName}`;

function viewOf(entry: HistoryEntry): EntryView {
  switch (entry.kind) {
    case "line_removal":
      return {
        headline: `Producto quitado: ${entry.quantity} × ${entry.itemName} — ${formatMoney(entry.amount)}`,
        target: billTarget(entry),
        detail: billDetail(entry),
        reason: entry.reason,
      };
    case "payment_removal":
      return {
        headline: `Pago quitado: ${formatMoney(entry.amount)} · ${paymentMethodLabel[entry.method]}`,
        target: billTarget(entry),
        detail: billDetail(entry),
        reason: entry.reason,
      };
    case "bill_void":
      return {
        headline: `Cuenta cancelada: ${formatMoney(entry.total)}`,
        target: billTarget(entry),
        detail: billDetail(entry),
        reason: entry.reason,
      };
    case "bill_edit":
      return {
        headline:
          entry.field === "customer"
            ? `Cliente: ${entry.previous ?? "Sin cliente"} → ${entry.next ?? "Sin cliente"}`
            : `Nota: ${entry.previous === null ? "Sin nota" : `«${entry.previous}»`} → ${
                entry.next === null ? "Sin nota" : `«${entry.next}»`
              }`,
        target: billTarget(entry),
        detail: "Cuenta",
        reason: null,
      };
    case "adjustment":
      return {
        headline: adjustmentText(entry.reason, entry.units, entry.itemName),
        target: { to: `/productos/${entry.itemId}`, label: "Ver producto" },
        detail: entry.note,
        reason: null,
      };
    case "adjustment_cancellation":
      return {
        headline: `Ajuste cancelado: ${adjustmentText(entry.adjustmentReason, entry.units, entry.itemName)}`,
        target: { to: `/productos/${entry.itemId}`, label: "Ver producto" },
        detail: null,
        reason: entry.reason,
      };
  }
}

function Entry({ entry }: { entry: HistoryEntry }) {
  const view = viewOf(entry);
  return (
    <li data-history-id={entry.id} className="rounded-2xl border border-stone-200 bg-white p-4">
      <p className="break-words font-medium">{view.headline}</p>
      {view.detail === null ? null : <p className="mt-1 break-words text-stone-600">{view.detail}</p>}
      <p className="mt-1 text-stone-600">{`${formatDay(dayOf(entry.at))} · ${formatTime(entry.at)} · ${
        entry.byName
      }`}</p>
      {view.reason === null ? null : <p className="mt-1 break-words">Motivo: {view.reason}</p>}
      <p className="mt-2">
        <Link to={view.target.to} className="font-medium underline">
          {view.target.label}
        </Link>
      </p>
    </li>
  );
}

export default function Historial({ loaderData }: Route.ComponentProps) {
  const { entries, next } = loaderData;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Historial</h1>
      <p className="text-stone-600">
        Correcciones y ajustes, del más reciente al más antiguo, con quién, cuándo y por qué.
      </p>

      {entries.length === 0 ? (
        <p className="text-stone-600">Todavía no hay movimientos.</p>
      ) : (
        <ul aria-label="Movimientos" className="flex flex-col gap-3">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      {next === null ? null : (
        <Link
          to={`/historial?antes=${next.at}&id=${encodeURIComponent(next.id)}`}
          className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-center font-medium"
        >
          Más movimientos
        </Link>
      )}
    </div>
  );
}
