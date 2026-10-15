import { Form, Link } from "react-router";

import { ChevronDrawing, LeaveDrawing, NavigationDrawing } from "~/components/icons";
import { hint, pageTitle, sectionTitle } from "~/components/styles";
import { buttonClasses } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { SubmitButton } from "~/components/submit-button";
import { moreGroupsFor } from "~/navigation.server";
import { requireUser } from "~/session.server";
import { roleLabel } from "~/shared/role";

import type { Route } from "./+types/mas";

// Más (UI redesign §4.2): every screen of the role that is not one of its
// four destinations, grouped by task, and the session with its way out. The
// groups come from the loader, so a Worker's phone is sent no Admin link.

export const meta: Route.MetaFunction = () => [{ title: "Más · Gamo Cafe" }];

export function loader({ context }: Route.LoaderArgs) {
  const user = requireUser(context);
  return { user: { name: user.name, role: user.role }, groups: moreGroupsFor(user.role) };
}

export default function Mas({ loaderData }: Route.ComponentProps) {
  const { user, groups } = loaderData;

  return (
    <div className="flex animate-enter flex-col gap-9">
      <h1 className={pageTitle}>Más</h1>

      {groups.map((group, index) => (
        <section key={group.title} aria-labelledby={`grupo-${index}`} className="flex flex-col gap-3">
          <h2 id={`grupo-${index}`} className={`${sectionTitle} px-1`}>
            {group.title}
          </h2>
          <Card className="py-0">
            <ul className="divide-y">
              {group.links.map(({ label, to, icon }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="group flex min-h-16 items-center gap-4 px-4 py-3 font-medium -outline-offset-2 transition-colors @container hover:bg-muted/60 active:bg-muted"
                  >
                    {/* What the link is recognized by before it is read; left out where its words need the room. */}
                    <span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground transition-colors group-hover:bg-background @[15rem]:grid">
                      <NavigationDrawing icon={icon} className="size-[1.375rem]" />
                    </span>
                    <span className="min-w-0 flex-1 wrap-anywhere">{label}</span>
                    <ChevronDrawing className="size-5 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}

      <section aria-labelledby="sesion" className="flex flex-col gap-3">
        <h2 id="sesion" className={`${sectionTitle} px-1`}>
          Tu sesión
        </h2>
        <Card>
          <div className="flex items-center gap-4 px-(--card-spacing) @container">
            {/* The User's initial, as a face would be: only a drawing, left out where the words need the room. */}
            <span
              aria-hidden="true"
              className="hidden size-12 shrink-0 place-items-center rounded-full bg-primary font-display text-[1.625rem] leading-none text-primary-foreground @[14rem]:grid"
            >
              {user.name.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 wrap-anywhere">
              <p className="font-semibold">{user.name}</p>
              <p className={hint}>{roleLabel[user.role]}</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t px-(--card-spacing) pt-(--card-spacing)">
            <p className={hint}>Para volver a entrar necesitarás un código nuevo.</p>
            <Form method="post" action="/salir">
              <SubmitButton
                pendingLabel="Saliendo…"
                className={buttonClasses({ size: "touch", variant: "outline", className: "w-full sm:w-auto" })}
              >
                <LeaveDrawing className="size-5" />
                Salir
              </SubmitButton>
            </Form>
          </div>
        </Card>
      </section>
    </div>
  );
}
