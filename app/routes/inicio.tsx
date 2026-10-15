import type { CSSProperties, ReactNode } from "react";
import { Effect } from "effect";
import { Link } from "react-router";

import { CurrentUser } from "~/backend/current-user";
import { homeSummary } from "~/backend/home";
import { run } from "~/backend/run.server";
import { ArrowDrawing, NavigationDrawing } from "~/components/icons";
import { amount, bigFigure, eyebrow, figureRow, hint, pageTitle, rowCard } from "~/components/styles";
import { buttonClasses } from "~/components/ui/button";
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
  stagger,
  children,
}: {
  readonly to: string;
  readonly label: string;
  readonly icon: NavigationIcon;
  readonly className?: string;
  /** Its place among the cards, for the order they arrive in. */
  readonly stagger: number;
  readonly children?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`group min-w-0 animate-enter rounded-2xl stagger ${className}`}
      style={{ "--stagger": stagger } as CSSProperties}
    >
      <Card size="sm" className={`h-full justify-between gap-5 ${rowCard}`}>
        <CardHeader>
          <CardTitle className="wrap-anywhere">{label}</CardTitle>
          {/* Only a drawing: left out where the title needs the room, with large text. */}
          <CardAction className="hidden @[8rem]/card-header:block">
            <span className="grid size-10 place-items-center rounded-xl bg-muted text-foreground transition-colors group-hover:bg-background">
              <NavigationDrawing icon={icon} className="size-[1.375rem]" />
            </span>
          </CardAction>
        </CardHeader>
        {children ? <CardContent className="flex flex-col gap-1">{children}</CardContent> : null}
      </Card>
    </Link>
  );
}

/** A label and its amount, one under the other where both do not fit side by side. */
function Split({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <span className={`${figureRow} text-muted-foreground`}>
      {/* A long word breaks rather than be cut, with text twice as large. */}
      <span className="min-w-0 wrap-anywhere">{label}</span> <b className={`font-semibold text-foreground ${amount}`}>{children}</b>
    </span>
  );
}

export default function Inicio({ loaderData }: Route.ComponentProps) {
  const { name, summary } = loaderData;
  const { day, openBills, mine, everyone, toRestock, menuIsEmpty } = summary;
  // An Admin's large card is the Day of everyone; a Worker's is their own.
  const collected = everyone ?? mine;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex animate-enter flex-col gap-2">
        <p className={eyebrow}>{formatDay(day)}</p>
        <h1 className={pageTitle}>Hola, {name}</h1>
      </div>

      {menuIsEmpty ? (
        // Nothing can be sold until there is something to sell: the first thing an Admin does.
        <Card className="animate-enter border-brand/30 bg-[color-mix(in_oklch,var(--card),var(--brand)_7%)] ring-brand/25">
          <CardContent className="flex flex-col gap-4 wrap-anywhere">
            <p className={eyebrow}>Para empezar</p>
            <p className="font-display text-[1.875rem] leading-tight">Agrega lo que vende la cafetería</p>
            <p className={hint}>
              Crea una categoría, como Bebidas, y después sus productos con su precio. Con eso ya se puede vender.
            </p>
            <Link to="/productos?paso=nuevo" className={buttonClasses({ size: "touch", className: "self-start" })}>
              Agregar productos
              <ArrowDrawing className="size-5" />
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {/* Two columns where two fit: one on a narrow phone, or with large text. */}
      <div className="grid gap-4 min-[22rem]:grid-cols-2">
        <Link
          to="/"
          className="group min-w-0 animate-enter rounded-3xl stagger min-[22rem]:col-span-2"
          style={{ "--stagger": 1 } as CSSProperties}
        >
          {/* A warm light in the corner of the espresso: a background, so it takes no room. */}
          <Card className="min-h-40 justify-between rounded-3xl bg-primary bg-[radial-gradient(circle_7rem_at_calc(100%_-_4rem)_3rem,rgb(214_150_96/0.38),transparent)] text-primary-foreground shadow-raised ring-0 transition-[background-color,scale] duration-150 ease-out group-hover:bg-primary/92 group-active:scale-[0.99]">
            <CardHeader>
              <span className="grid size-12 place-items-center rounded-2xl bg-primary-foreground/12 ring-1 ring-primary-foreground/15">
                <NavigationDrawing icon="bag" className="size-7" />
              </span>
            </CardHeader>
            <CardContent className="flex items-end justify-between gap-3">
              <span className="min-w-0 wrap-anywhere">
                <span className="block font-display text-[2.25rem] leading-none">Nueva venta</span>
                <span className="mt-2 block text-primary-foreground/85">Hoy llevas vendido {formatMoney(mine.sold)}</span>
              </span>
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary-foreground text-primary transition-transform duration-200 ease-out group-hover:translate-x-0.5">
                <ArrowDrawing className="size-6" />
              </span>
            </CardContent>
          </Card>
        </Link>

        <Tile
          to={everyone ? "/dia" : "/mi-dia"}
          label={everyone ? "Cobrado hoy" : "Cobraste hoy"}
          icon={everyone ? "calendar" : "person"}
          className="min-[22rem]:col-span-2"
          stagger={2}
        >
          <span className={`${bigFigure} ${amount}`}>{formatMoney(collected.collected)}</span>
          <span className="mt-3 flex flex-col gap-1 border-t pt-3">
            <Split label="Efectivo">{formatMoney(collected.cash)}</Split>
            <Split label="Transferencia">{formatMoney(collected.transfer)}</Split>
          </span>
        </Tile>

        <Tile to="/cuentas-abiertas" label="Cuentas abiertas" icon="receipt" stagger={3}>
          <span className={bigFigure}>{openBills.count}</span>
          {openBills.count > 0 ? (
            <span className={`mt-1 ${hint} ${amount}`}>Deben {formatMoney(openBills.owed)}</span>
          ) : null}
        </Tile>

        {toRestock === null ? (
          <Tile to="/clientes" label="Clientes" icon="people" stagger={4} />
        ) : (
          <>
            <Tile to="/inventario" label="Inventario" icon="box" stagger={4}>
              <span className={`${bigFigure} ${toRestock > 0 ? "text-warning" : ""}`}>{toRestock}</span>
              <span className={`mt-1 ${hint}`}>{toRestock === 1 ? "producto por reponer" : "productos por reponer"}</span>
            </Tile>
            <Tile to="/clientes" label="Clientes" icon="people" stagger={5} />
            <Tile to="/mi-dia" label="Mi día" icon="person" stagger={6}>
              <Split label="Cobraste">{formatMoney(mine.collected)}</Split>
            </Tile>
          </>
        )}
      </div>
    </div>
  );
}
