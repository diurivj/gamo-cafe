import type { ReactNode } from "react";
import { Effect } from "effect";
import { Link } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { homeSummary } from "~/backend/home";
import { run } from "~/backend/run.server";
import { today } from "~/backend/time";
import { ChevronDrawing, NavigationDrawing } from "~/components/icons";
import { hint, outlined, pageTitle, press } from "~/components/styles";
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
  const program = Effect.gen(function* () {
    return { name: user.name, day: yield* today, summary: yield* homeSummary };
  }).pipe(Effect.provideService(CurrentUser, user));

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
  tint = "bg-raised",
  className = "",
  children,
}: {
  readonly to: string;
  readonly label: string;
  readonly icon: NavigationIcon;
  /** The card's fill: one of the tints of `app/app.css`. White without one. */
  readonly tint?: string;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <Link to={to} className={`${outlined} ${press} ${tint} flex flex-col justify-between gap-3 p-4 ${className}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="leading-tight font-bold">{label}</span>
        <NavigationDrawing icon={icon} />
      </span>
      {children}
    </Link>
  );
}

const figure = "block text-3xl leading-none font-black tracking-tight tabular-nums";

export default function Inicio({ loaderData }: Route.ComponentProps) {
  const { name, day, summary } = loaderData;
  const { openBills, mine, everyone, toRestock } = summary;
  // An Admin's large card is the Day of everyone; a Worker's is their own.
  const collected = everyone ?? mine;

  return (
    <>
      <p className={hint}>{formatDay(day)}</p>
      <h1 className={pageTitle}>Hola, {name}</h1>

      {/* Two columns where two fit: one on a narrow phone, or with large text. */}
      <div className="mt-5 grid gap-4 min-[22rem]:grid-cols-2">
        <Link to="/" className={`${outlined} ${press} flex min-h-32 min-[22rem]:col-span-2 flex-col justify-between gap-4 bg-action p-5`}>
          <NavigationDrawing icon="bag" className="size-9" />
          <span className="flex items-end justify-between gap-3">
            <span>
              <span className="block text-2xl leading-tight font-black tracking-tight">Nueva venta</span>
              <span>Hoy llevas vendido {formatMoney(mine.sold)}</span>
            </span>
            <ChevronDrawing className="size-8" />
          </span>
        </Link>

        <Tile
          to={everyone ? "/dia" : "/mi-dia"}
          label={everyone ? "Cobrado hoy" : "Cobraste hoy"}
          icon={everyone ? "calendar" : "person"}
          tint="bg-sun"
          className="min-[22rem]:row-span-2"
        >
          <span>
            <span className={figure}>{formatMoney(collected.collected)}</span>
            <span className="mt-3 block">
              Efectivo <b className="tabular-nums">{formatMoney(collected.cash)}</b>
            </span>
            <span className="block">
              Transferencia <b className="tabular-nums">{formatMoney(collected.transfer)}</b>
            </span>
          </span>
        </Tile>

        <Tile to="/cuentas-abiertas" label="Cuentas abiertas" icon="receipt" tint="bg-mint">
          <span>
            <span className={figure}>{openBills.count}</span>
            {openBills.count > 0 ? <span className="mt-1 block">Deben {formatMoney(openBills.owed)}</span> : null}
          </span>
        </Tile>

        {toRestock === null ? (
          <Tile to="/clientes" label="Clientes" icon="people" tint="bg-peach" />
        ) : (
          <>
            <Tile to="/inventario" label="Inventario" icon="box" tint="bg-lilac">
              <span>
                <span className={figure}>{toRestock}</span>
                <span className="mt-1 block">{toRestock === 1 ? "producto por reponer" : "productos por reponer"}</span>
              </span>
            </Tile>
            <Tile to="/clientes" label="Clientes" icon="people" tint="bg-peach" />
            <Tile to="/mi-dia" label="Mi día" icon="person">
              <span>
                Cobraste <b className="tabular-nums">{formatMoney(mine.collected)}</b>
              </span>
            </Tile>
          </>
        )}
      </div>
    </>
  );
}
