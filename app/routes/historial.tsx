import { Effect } from "effect";
import { Link } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { type HistoryEntry, listHistory } from "~/backend/history";
import { run } from "~/backend/run.server";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
import { ChevronDrawing } from "~/components/icons";
import { LoadMore, usePagedList } from "~/components/paged-list";
import { hint, pageTitle } from "~/components/styles";
import { Card, CardContent } from "~/components/ui/card";
import { adjustmentReasonLabel, adjustmentSign, type AdjustmentReason } from "~/shared/adjustment";
import { CURSOR_PARAM, cursorOf, nextText } from "~/shared/cursor";
import { type Day, dayOf, formatDay, formatTime, type Instant } from "~/shared/day";
import { formatMoney } from "~/shared/money";
import { paymentMethodLabel } from "~/shared/payment";

import type { Route } from "./+types/historial";

// Historial (spec §6.2, UI redesign §7): the corrections and Adjustments,
// newest first, 50 per page. Each entry says what was done, to which record as
// it was made, by whom, when and why, and leads to the Bill or the Item, where
// the record itself is still on file. Admin only: a Worker never sees History
// (spec §4.1, §4.2). The page is a keyset over the fact tables, so it stays
// cheap at any history size (§2.4).

export const meta: Route.MetaFunction = () => [{ title: "Historial · Gamo Cafe" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const page = await run(
    context,
    listHistory(cursorOf(request.url)).pipe(Effect.provideService(CurrentUser, admin)),
    refuseRead,
  );
  return { entries: page.entries, next: nextText(page.next) };
}

type Data = Route.ComponentProps["loaderData"];
const pageOf = (data: Data) => ({ rows: data.entries, next: data.next });
const hrefFor = (cursor: string) => `/historial?${CURSOR_PARAM}=${encodeURIComponent(cursor)}`;

/**
 * Everything one entry shows, from the entry alone: what was done, the record
 * it was done to as it was made, who did it and when, and the reason an Admin
 * owed. One switch per kind, so a kind the entry union gains cannot be
 * forgotten.
 */
interface EntryView {
  /** What was done: "Producto quitado". */
  readonly title: string;
  /** The record it was done to: "2 × Agua mineral — $37.00". */
  readonly what: string;
  /** Where that record is: the Bill, or an Adjustment's note. */
  readonly where: string | null;
  /** The record as it was made, which no correction changes: "Agregado por Beto · 10:00". */
  readonly original: string | null;
  /** The verb of who did it: "Quitado por". */
  readonly done: string;
  readonly reason: string | null;
  readonly target: { readonly to: string; readonly label: string };
}

const billTarget = (entry: { readonly billId: string }) => ({
  to: `/cuentas/${entry.billId}`,
  label: "Ver cuenta",
});

const itemTarget = (entry: { readonly itemId: string }) => ({
  to: `/productos/${entry.itemId}`,
  label: "Ver producto",
});

/** Which Bill: whose it is, and its Day. */
const billText = (entry: { readonly billLabel: string | null; readonly billDay: Day }) =>
  `Cuenta ${entry.billLabel === null ? "sin cliente" : `de ${entry.billLabel}`} · ${formatDay(entry.billDay)}`;

/** When something was done, in full: the Day and the time. */
const when = (at: Instant) => `${formatDay(dayOf(at))} · ${formatTime(at)}`;

/** An Adjustment's line, with the sign its reason gives it (spec §5.8). */
const adjustmentText = (reason: AdjustmentReason, units: number, itemName: string) =>
  `${adjustmentReasonLabel[reason]} ${adjustmentSign(reason) === 1 ? "+" : "-"}${units} · ${itemName}`;

function viewOf(entry: HistoryEntry): EntryView {
  switch (entry.kind) {
    case "line_removal":
      return {
        title: "Producto quitado",
        what: `${entry.quantity} × ${entry.itemName} — ${formatMoney(entry.amount)}`,
        where: billText(entry),
        original: `Agregado por ${entry.addedByName} · ${when(entry.addedAt)}`,
        done: "Quitado por",
        reason: entry.reason,
        target: billTarget(entry),
      };
    case "payment_removal":
      return {
        title: "Pago quitado",
        what: `${formatMoney(entry.amount)} · ${paymentMethodLabel[entry.method]}`,
        where: billText(entry),
        original: `Recibido por ${entry.receivedByName} · ${when(entry.receivedAt)}`,
        done: "Quitado por",
        reason: entry.reason,
        target: billTarget(entry),
      };
    case "bill_void":
      return {
        title: "Cuenta cancelada",
        what: `Total ${formatMoney(entry.total)} · Pagado ${formatMoney(entry.paid)}`,
        where: billText(entry),
        original: null,
        done: "Cancelada por",
        reason: entry.reason,
        target: billTarget(entry),
      };
    case "bill_edit":
      return entry.field === "customer"
        ? {
            title: "Cliente cambiado",
            what: `${entry.previous ?? "Sin cliente"} → ${entry.next ?? "Sin cliente"}`,
            where: `Cuenta del ${formatDay(entry.billDay)}`,
            original: null,
            done: "Cambiado por",
            reason: null,
            target: billTarget(entry),
          }
        : {
            title: "Nota cambiada",
            what: `${entry.previous === null ? "Sin nota" : `«${entry.previous}»`} → ${
              entry.next === null ? "Sin nota" : `«${entry.next}»`
            }`,
            where: `Cuenta del ${formatDay(entry.billDay)}`,
            original: null,
            done: "Cambiada por",
            reason: null,
            target: billTarget(entry),
          };
    case "adjustment":
      return {
        title: "Ajuste de existencias",
        what: adjustmentText(entry.reason, entry.units, entry.itemName),
        where: entry.note,
        original: null,
        done: "Registrado por",
        reason: null,
        target: itemTarget(entry),
      };
    case "adjustment_cancellation":
      return {
        title: "Ajuste cancelado",
        what: adjustmentText(entry.adjustmentReason, entry.units, entry.itemName),
        where: entry.note,
        original: `Registrado por ${entry.recordedByName} · ${when(entry.recordedAt)}`,
        done: "Cancelado por",
        reason: entry.reason,
        target: itemTarget(entry),
      };
  }
}

function Entry({ entry }: { readonly entry: HistoryEntry }) {
  const view = viewOf(entry);
  return (
    <li data-history-id={entry.id}>
      <Card size="sm">
        <CardContent className="flex flex-col gap-1">
          <p className="text-xl font-semibold">{view.title}</p>
          <p className="font-medium wrap-break-word">{view.what}</p>
          {view.where === null ? null : <p className="wrap-break-word">{view.where}</p>}
          {view.original === null ? null : <p className={`${hint} wrap-break-word`}>{view.original}</p>}
          <p className={`${hint} wrap-break-word`}>{`${view.done} ${entry.byName} · ${when(entry.at)}`}</p>
          {view.reason === null ? null : <p className="font-medium wrap-break-word">{`Motivo: ${view.reason}`}</p>}
          {/* Cuenta goes back to this entry, not on to a new list; an Item's screen does not read it. */}
          <Link
            to={view.target.to}
            state={{ fromList: "/historial" }}
            aria-label={`${view.target.label}: ${view.title}, ${view.what}`}
            className="mt-1 inline-flex min-h-12 items-center gap-1 self-start font-medium underline underline-offset-4"
          >
            {view.target.label}
            <ChevronDrawing className="size-5" />
          </Link>
        </CardContent>
      </Card>
    </li>
  );
}

export default function Historial({ loaderData }: Route.ComponentProps) {
  const { rows: entries, more } = usePagedList({ id: "historial", data: loaderData, pageOf, hrefFor });

  return (
    <div className="flex flex-col gap-5">
      <h1 className={pageTitle}>Historial</h1>
      <p className={hint}>
        Cada corrección y cada ajuste, del más reciente al más antiguo. Nada se borra: lo corregido sigue en su cuenta.
      </p>

      {entries.length === 0 ? (
        <p>Todavía no hay correcciones ni ajustes.</p>
      ) : (
        <ul aria-label="Movimientos" className="flex flex-col gap-3">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      <LoadMore more={more} />
    </div>
  );
}
