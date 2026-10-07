import { Form, Link } from "react-router";

import { ChevronDrawing } from "~/components/icons";
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
    <div className="flex flex-col gap-8">
      <h1 className={pageTitle}>Más</h1>

      {groups.map((group, index) => (
        <section key={group.title} aria-labelledby={`grupo-${index}`}>
          <h2 id={`grupo-${index}`} className={sectionTitle}>
            {group.title}
          </h2>
          <Card className="mt-3 py-0">
            <ul className="divide-y">
              {group.links.map(({ label, to }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 font-medium -outline-offset-2 hover:bg-muted/60"
                  >
                    {label}
                    <ChevronDrawing className="size-5 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}

      <section aria-labelledby="sesion">
        <h2 id="sesion" className={sectionTitle}>
          Tu sesión
        </h2>
        <p className="mt-2 font-medium">{user.name}</p>
        <p className={hint}>{roleLabel[user.role]}</p>
        <p className={`mt-4 ${hint}`}>Para volver a entrar necesitarás un código nuevo.</p>
        <Form method="post" action="/salir" className="mt-3">
          <SubmitButton pendingLabel="Saliendo…" className={buttonClasses({ size: "touch", variant: "outline", className: "w-full sm:w-auto" })}>
            Salir
          </SubmitButton>
        </Form>
      </section>
    </div>
  );
}
