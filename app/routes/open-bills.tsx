import { Form, Link, useLocation, useNavigation, useSubmit } from "react-router";

import { listOpenBills } from "~/backend/bills";
import { run } from "~/backend/run.server";
import { BillStateBadge } from "~/components/bill-state-badge";
import { ChevronDrawing } from "~/components/icons";
import { LoadMore, usePagedList } from "~/components/paged-list";
import { hint, pageTitle } from "~/components/styles";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { requireUser } from "~/session.server";
import { CURSOR_PARAM, cursorOf, nextText } from "~/shared/cursor";
import { formatDay } from "~/shared/day";
import { useListReturn } from "~/shared/list-return";
import { formatMoney } from "~/shared/money";

import type { Route } from "./+types/open-bills";

// Cuentas abiertas (spec §6.1, UI redesign §7): every Open Bill, newest
// first, with its Customer or note, Day, state and what it owes, and a search
// by Customer. One index-driven read of a page of 50, so it stays cheap with
// any number of Open Bills; the search is over all of them, not over the page.
// The search is in the address, and a row leads to its Bill as a new history
// entry: coming back finds the search, the pages and the place as they were.

export const meta: Route.MetaFunction = () => [{ title: "Cuentas abiertas · Gamo Cafe" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  requireUser(context);
  const typed = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const page = await run(context, listOpenBills(typed, cursorOf(request.url)));
  return { typed, bills: page.bills, next: nextText(page.next) };
}

type Data = Route.ComponentProps["loaderData"];
const pageOf = (data: Data) => ({ rows: data.bills, next: data.next });

export default function OpenBills({ loaderData }: Route.ComponentProps) {
  const { typed } = loaderData;
  const { rows: bills, more } = usePagedList({
    id: "cuentas-abiertas",
    data: loaderData,
    pageOf,
    hrefFor: (cursor) => {
      const params = new URLSearchParams();
      if (typed !== "") params.set("q", typed);
      params.set(CURSOR_PARAM, cursor);
      return `/cuentas-abiertas?${params}`;
    },
  });
  const submit = useSubmit();
  // For the way back from a Bill that this list is no longer right behind.
  useListReturn("/cuentas-abiertas", useLocation().search);
  // The results are a round trip away; say so at once, so no tap looks lost.
  const searching = useNavigation().state !== "idle";

  return (
    <div className="flex flex-col gap-5">
      <h1 className={pageTitle}>Cuentas abiertas</h1>

      <Form
        method="get"
        role="search"
        className="flex flex-col gap-2"
        onChange={(event) => submit(event.currentTarget, { replace: true, preventScrollReset: true })}
      >
        <Label htmlFor="q">Buscar por cliente</Label>
        <Input
          id="q"
          name="q"
          type="search"
          defaultValue={typed}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={80}
        />
        {/* Its room is kept, so the list does not move when it speaks. */}
        <p aria-live="polite" className={`min-h-7 ${hint}`}>
          {searching ? "Buscando…" : ""}
        </p>
      </Form>

      {bills.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className={hint}>
            {typed
              ? `Ninguna cuenta abierta es de un cliente que empiece con «${typed}».`
              : "No hay cuentas abiertas. Una venta que se deja abierta aparece aquí."}
          </p>
          {typed ? (
            <Link
              to="/cuentas-abiertas"
              replace
              className="inline-flex min-h-12 items-center self-start font-medium underline underline-offset-4"
            >
              Ver todas las cuentas abiertas
            </Link>
          ) : null}
        </div>
      ) : (
        <ul aria-label="Cuentas abiertas" className="flex flex-col gap-3">
          {bills.map((bill) => (
            <li key={bill.id} data-bill-id={bill.id}>
              {/* Cuenta goes back to this entry, not on to a new list. */}
              <Link to={`/cuentas/${bill.id}`} state={{ fromList: "/cuentas-abiertas" }} className="block rounded-2xl">
                <Card size="sm" className="transition-colors hover:bg-muted/60 active:bg-muted">
                  <CardContent className="flex flex-col gap-2">
                    <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0 text-xl font-semibold wrap-break-word">
                        {bill.customer?.name ?? bill.note ?? "Sin cliente"}
                      </span>
                      <BillStateBadge state={bill.state} />
                    </span>
                    {bill.customer && bill.note ? <span className="wrap-break-word">{bill.note}</span> : null}
                    <span className={hint}>{formatDay(bill.day)}</span>
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3 border-t pt-2">
                      <span className="font-medium">Debe</span>{" "}
                      <span className="font-heading text-2xl font-semibold tabular-nums">{formatMoney(bill.owed)}</span>
                    </span>
                    <span className="flex flex-wrap items-center justify-between gap-x-3">
                      <span className={`tabular-nums ${hint}`}>
                        {`Total ${formatMoney(bill.total)} · Pagado ${formatMoney(bill.paid)}`}
                      </span>
                      <span className="inline-flex items-center gap-1 font-medium">
                        Ver cuenta
                        <ChevronDrawing className="size-5" />
                      </span>
                    </span>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <LoadMore more={more} />
    </div>
  );
}
