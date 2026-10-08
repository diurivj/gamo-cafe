import { Effect } from "effect";
import { Form, Link, useLocation, useNavigation } from "react-router";

import { type BillFilter, listBills } from "~/backend/bills";
import { getCustomer } from "~/backend/customers";
import { CurrentUser } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import { refuseRead, requireAdminUser } from "~/catalog-forms.server";
import { BillStateBadge } from "~/components/bill-state-badge";
import { CustomerPicker } from "~/components/customer-picker";
import { ChevronDrawing } from "~/components/icons";
import { LoadMore, usePagedList } from "~/components/paged-list";
import { hint, pageTitle } from "~/components/styles";
import { SubmitButton } from "~/components/submit-button";
import { buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
import { BILL_STATES, billStateLabel, isOpenBill } from "~/shared/bill-state";
import { CURSOR_PARAM, cursorOf, nextText } from "~/shared/cursor";
import { formatDay, parseDay } from "~/shared/day";
import { useListReturn } from "~/shared/list-return";
import { formatMoney } from "~/shared/money";

import type { Route } from "./+types/cuentas";

// Cuentas (spec §6.2, UI redesign §7): every Bill with its state, the Paid
// and the Voided too, filtered by Day, state or Customer, 50 per page. An
// Admin screen: `requireAdminUser` refuses a Worker before the filters are
// read, and `listBills` refuses one again. The filters are in the address,
// and a row leads to its Bill as a new history entry: coming back finds the
// filters, the pages and the place as they were.

export const meta: Route.MetaFunction = () => [{ title: "Cuentas · Gamo Cafe" }];

/** The filters the URL asked for, keeping only what can be applied. */
function filtersOf(params: URLSearchParams): Required<Omit<BillFilter, "settledOnly">> {
  const day = params.get("dia");
  const state = params.get("estado");
  return {
    day: day === null ? null : parseDay(day),
    state: BILL_STATES.find((known) => known === state) ?? null,
    customerId: params.get("cliente") || null,
  };
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const filter = filtersOf(new URL(request.url).searchParams);

  const { listed, customer } = await run(
    context,
    Effect.gen(function* () {
      const listed = yield* listBills(filter, cursorOf(request.url));
      // The chosen Customer's name, so the picker shows the filter that is on.
      const customer =
        filter.customerId === null
          ? null
          : yield* getCustomer(filter.customerId).pipe(
              Effect.catchTag("CustomerNotFound", () => Effect.succeed(null)),
            );
      return { listed, customer };
    }).pipe(Effect.provideService(CurrentUser, admin)),
    refuseRead,
  );

  return {
    ...filter,
    bills: listed.bills,
    next: nextText(listed.next),
    customer: customer === null ? null : { id: customer.id, name: customer.name },
  };
}

/** This list's URL for the page after a cursor, the filters kept. */
function filtersUrl(filters: ReturnType<typeof filtersOf>, cursor: string) {
  const params = new URLSearchParams();
  if (filters.day !== null) params.set("dia", filters.day);
  if (filters.state !== null) params.set("estado", filters.state);
  if (filters.customerId !== null) params.set("cliente", filters.customerId);
  params.set(CURSOR_PARAM, cursor);
  return `/cuentas?${params}`;
}

type Data = Route.ComponentProps["loaderData"];
const pageOf = (data: Data) => ({ rows: data.bills, next: data.next });

export default function Cuentas({ loaderData }: Route.ComponentProps) {
  const { day, state, customerId, customer } = loaderData;
  const { rows: bills, more } = usePagedList({
    id: "cuentas",
    data: loaderData,
    pageOf,
    hrefFor: (cursor) => filtersUrl({ day, state, customerId }, cursor),
  });
  const filtered = day !== null || state !== null || customerId !== null;
  // For the way back from a Bill that this list is no longer right behind.
  useListReturn("/cuentas", useLocation().search);
  // Other filters are a round trip away. Until their Bills are here the ones
  // below are still the ones of the filters before: say so.
  const navigation = useNavigation();
  const reading = navigation.state === "loading" && navigation.location.pathname === "/cuentas";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className={pageTitle}>Cuentas</h1>
        <p className={hint}>Todas las cuentas, también las pagadas y las canceladas.</p>
      </div>

      {/* Each field is keyed by the filter that was read, so it says what the list below is. The form
          itself stays, and the keyboard with it on Filtrar. */}
      <Form method="get" className="flex flex-col gap-3">
        <div className="@container">
          <div className="flex flex-col gap-3 @[30rem]:flex-row">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="dia">Día</Label>
              <Input key={day} id="dia" type="date" name="dia" defaultValue={day ?? ""} />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="estado">Estado</Label>
              <NativeSelect key={state} id="estado" name="estado" defaultValue={state ?? ""}>
                <NativeSelectOption value="">Todos</NativeSelectOption>
                {BILL_STATES.map((known) => (
                  <NativeSelectOption key={known} value={known}>
                    {billStateLabel[known]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
        </div>

        <CustomerPicker key={customerId} name="cliente" defaultValue={customer} label="Cliente" />

        <SubmitButton pendingLabel="Filtrando…" className={buttonClasses({ variant: "outline", size: "touch" })}>
          Filtrar
        </SubmitButton>
        {filtered ? (
          <Link
            to="/cuentas"
            className="inline-flex min-h-12 items-center self-start font-medium underline underline-offset-4"
          >
            Quitar filtros
          </Link>
        ) : null}
        {/* Its room is kept, so the list does not move when it speaks. */}
        <p aria-live="polite" className={`min-h-7 ${hint}`}>
          {reading ? "Buscando las cuentas que pediste…" : ""}
        </p>
      </Form>

      <div className={`flex flex-col gap-5 ${reading ? "opacity-60" : ""}`} aria-busy={reading}>
        {bills.length === 0 ? (
          <p className={hint}>
            {filtered
              ? "No hay cuentas con esos filtros."
              : "No hay cuentas todavía. Cada venta que se registra aparece aquí."}
          </p>
        ) : (
          <ul aria-label="Cuentas" className="flex flex-col gap-3">
            {bills.map((bill) => (
              <li key={bill.id} data-bill-id={bill.id}>
                {/* Cuenta goes back to this entry, not on to a new list. */}
                <Link to={`/cuentas/${bill.id}`} state={{ fromList: "/cuentas" }} className="block rounded-2xl">
                  <Card size="sm" className="transition-colors hover:bg-muted/60 active:bg-muted">
                    <CardContent className="flex flex-col gap-2">
                      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <span className="max-w-full min-w-0 text-xl font-semibold wrap-anywhere">
                          {bill.customer?.name ?? bill.note ?? "Sin cliente"}
                        </span>
                        <BillStateBadge state={bill.state} />
                      </span>
                      {bill.customer && bill.note ? <span className="wrap-anywhere">{bill.note}</span> : null}
                      <span className={hint}>{formatDay(bill.day)}</span>
                      {/* Only a Bill that is still Open owes: a Paid one owes nothing, a Voided one is not collected. */}
                      {isOpenBill(bill.state) ? (
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3 border-t pt-2">
                          <span className="font-medium">Debe</span>{" "}
                          <span className="max-w-full min-w-0 font-heading text-2xl font-semibold wrap-anywhere tabular-nums">
                            {formatMoney(bill.owed)}
                          </span>
                        </span>
                      ) : null}
                      <span className="flex flex-wrap items-center justify-between gap-x-3">
                        <span className={`max-w-full min-w-0 wrap-anywhere tabular-nums ${hint}`}>
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
    </div>
  );
}
