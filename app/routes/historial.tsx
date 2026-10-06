import { Effect } from "effect";
import { Link } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { type HistoryCursor, type HistoryEntry, listHistory } from "~/backend/history";
import { run } from "~/backend/run.server";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
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

const adjustmentLabel = {
  restock: "Entrada",
  waste: "Merma",
  internal_use: "Consumo interno",
} as const;

/** Entrada adds; Merma and Consumo interno subtract (spec §5.8). */
const sign = (reason: keyof typeof adjustmentLabel) => (reason === "restock" ? "+" : "-");

/** What happened, in one line. */
function headline(entry: HistoryEntry): string {
  switch (entry.kind) {
    case "line_removal":
      return `Producto quitado: ${entry.quantity} × ${entry.itemName} — ${formatMoney(entry.amount)}`;
    case "payment_removal":
      return `Pago quitado: ${formatMoney(entry.amount)} · ${paymentMethodLabel[entry.method]}`;
    case "bill_void":
      return `Cuenta cancelada: ${formatMoney(entry.total)}`;
    case "bill_edit":
      return entry.field === "customer"
        ? `Cliente: ${entry.previous ?? "Sin cliente"} → ${entry.next ?? "Sin cliente"}`
        : `Nota: ${entry.previous === null ? "Sin nota" : `«${entry.previous}»`} → ${
            entry.next === null ? "Sin nota" : `«${entry.next}»`
          }`;
    case "adjustment":
      return `${adjustmentLabel[entry.reason]} ${sign(entry.reason)}${entry.units} · ${entry.itemName}`;
    case "adjustment_cancellation":
      return `Ajuste cancelado: ${adjustmentLabel[entry.adjustmentReason]} ${sign(entry.adjustmentReason)}${
        entry.units
      } · ${entry.itemName}`;
  }
}

/** The Bill an entry belongs to, or the Item an Adjustment touched. */
function target(entry: HistoryEntry): { readonly to: string; readonly label: string } {
  switch (entry.kind) {
    case "adjustment":
    case "adjustment_cancellation":
      return { to: `/productos/${entry.itemId}`, label: "Ver producto" };
    default:
      return { to: `/cuentas/${entry.billId}`, label: "Ver cuenta" };
  }
}

/** The Bill the entry corrected, and any note the Adjustment carries. */
function detail(entry: HistoryEntry): string | null {
  switch (entry.kind) {
    case "line_removal":
    case "payment_removal":
    case "bill_void":
      return `Cuenta ${entry.billLabel === null ? "sin cliente" : `de ${entry.billLabel}`}`;
    case "bill_edit":
      return "Cuenta";
    case "adjustment":
      return entry.note;
    case "adjustment_cancellation":
      return null;
  }
}

/** The reason an Admin owed, where there is one. */
function reasonOf(entry: HistoryEntry): string | null {
  switch (entry.kind) {
    case "line_removal":
    case "payment_removal":
    case "bill_void":
    case "adjustment_cancellation":
      return entry.reason;
    default:
      return null;
  }
}

function Entry({ entry }: { entry: HistoryEntry }) {
  const link = target(entry);
  const detailText = detail(entry);
  const reason = reasonOf(entry);
  return (
    <li data-history-id={entry.id} className="rounded-2xl border border-stone-200 bg-white p-4">
      <p className="break-words font-medium">{headline(entry)}</p>
      {detailText === null ? null : <p className="mt-1 break-words text-stone-600">{detailText}</p>}
      <p className="mt-1 text-stone-600">{`${formatDay(dayOf(entry.at))} · ${formatTime(entry.at)} · ${
        entry.byName
      }`}</p>
      {reason === null ? null : <p className="mt-1 break-words">Motivo: {reason}</p>}
      <p className="mt-2">
        <Link to={link.to} className="font-medium underline">
          {link.label}
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
