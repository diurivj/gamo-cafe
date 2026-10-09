import type { ReactNode } from "react";
import { Effect } from "effect";
import { Link } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { homeSummary } from "~/backend/home";
import { run } from "~/backend/run.server";
import { ChevronDrawing, NavigationDrawing } from "~/components/icons";
import { hint, pageTitle } from "~/components/styles";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { requireUser } from "~/session.server";
import { formatDay } from "~/shared/day";
import { formatMoney } from "~/shared/money";
import type { NavigationIcon } from "~/shared/navigation";

import type { Route } from "./+types/inicio";

// Inicio (UI redesign §4): where a User lands. Large cards, each one a figure
// worth knowing and the way into the screen it is about; the first is a new
// sale. A Worker's cards hold their own Day and the Open Bills; the Day of
// everyone and Stock are an Admin's, and `homeSummary` reads them for no one
// else (spec §4.1, §4.2). Every figure is about Bills, Payments or Stock, so
// the loader runs again like any other.

export const meta: Route.MetaFunction = () => [{ title: "Inicio · Gamo Cafe" }];

export async function loader({ context }: Route.LoaderArgs) {
  const user = requireUser(context);
  const program = Effect.map(homeSummary, (summary) => ({ name: user.name, summary })).pipe(
    Effect.provideService(CurrentUser, user),
  );

  return run(context, program, (error) => {
    switch (error._tag) {
      // `homeSummary` asks for an Admin's reads only as an Admin.
      case "AdminOnly":
        throw new Response(null, { status: 403 });
    }
  });
}

/** One card of the home screen: a link, as large as what it says deserves. */
function Tile({
  to,
  label,
  icon,
  className = "",
  children,
}: {
  readonly to: string;
  readonly label: string;
  readonly icon: NavigationIcon;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <Link to={to} className={`rounded-2xl ${className}`}>
      <Card size="sm" className="h-full justify-between transition-colors hover:bg-muted/60 active:bg-muted">
        <CardHeader>
          <CardTitle>{label}</CardTitle>
          <CardAction>
            <NavigationDrawing icon={icon} className="size-6 text-muted-foreground" />
          </CardAction>
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
      </Card>
    </Link>
  );
}

const figure = "block font-heading text-3xl leading-none font-semibold tracking-tight tabular-nums";

export default function Inicio({ loaderData }: Route.ComponentProps) {
  const { name, summary } = loaderData;
  const { day, openBills, mine, everyone, toRestock } = summary;
  // An Admin's large card is the Day of everyone; a Worker's is their own.
  const collected = everyone ?? mine;

  return (
    <>
      <p className={hint}>{formatDay(day)}</p>
      <h1 className={pageTitle}>Hola, {name}</h1>

      {/* Two columns where two fit: one on a narrow phone, or with large text. */}
      <div className="mt-5 grid gap-4 min-[22rem]:grid-cols-2">
        <Link to="/" className="min-w-0 rounded-2xl min-[22rem]:col-span-2">
          <Card className="min-h-32 justify-between bg-primary text-primary-foreground transition-colors hover:bg-primary/90">
            <CardHeader>
              <NavigationDrawing icon="bag" className="size-8" />
            </CardHeader>
            <CardContent className="flex items-end justify-between gap-3">
              <span className="min-w-0 wrap-anywhere">
                <span className="block font-heading text-2xl leading-tight font-semibold tracking-tight">Nueva venta</span>
                <span className="text-primary-foreground/90">Hoy llevas vendido {formatMoney(mine.sold)}</span>
              </span>
              <ChevronDrawing className="size-7" />
            </CardContent>
          </Card>
        </Link>

        <Tile
          to={everyone ? "/dia" : "/mi-dia"}
          label={everyone ? "Cobrado hoy" : "Cobraste hoy"}
          icon={everyone ? "calendar" : "person"}
          className="min-[22rem]:row-span-2"
        >
          <span className={figure}>{formatMoney(collected.collected)}</span>
          <span className="mt-3 block text-muted-foreground">
            Efectivo <b className="font-medium text-foreground tabular-nums">{formatMoney(collected.cash)}</b>
          </span>
          <span className="block text-muted-foreground">
            Transferencia <b className="font-medium text-foreground tabular-nums">{formatMoney(collected.transfer)}</b>
          </span>
        </Tile>

        <Tile to="/cuentas-abiertas" label="Cuentas abiertas" icon="receipt">
          <span className={figure}>{openBills.count}</span>
          {openBills.count > 0 ? (
            <span className="mt-1 block text-muted-foreground">Deben {formatMoney(openBills.owed)}</span>
          ) : null}
        </Tile>

        {toRestock === null ? (
          <Tile to="/clientes" label="Clientes" icon="people" />
        ) : (
          <>
            <Tile to="/inventario" label="Inventario" icon="box">
              <span className={figure}>{toRestock}</span>
              <span className="mt-1 block text-muted-foreground">
                {toRestock === 1 ? "producto por reponer" : "productos por reponer"}
              </span>
            </Tile>
            <Tile to="/clientes" label="Clientes" icon="people" />
            <Tile to="/mi-dia" label="Mi día" icon="person">
              <span className="text-muted-foreground">
                Cobraste <b className="font-medium text-foreground tabular-nums">{formatMoney(mine.collected)}</b>
              </span>
            </Tile>
          </>
        )}
      </div>
    </>
  );
}
