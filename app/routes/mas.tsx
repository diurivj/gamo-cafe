import { Form, Link } from "react-router";

import { ChevronDrawing } from "~/components/icons";
import { hint, pageTitle, secondaryButton, sectionTitle } from "~/components/styles";
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

const roleMeans = {
  admin: "puedes abrir todas las herramientas.",
  worker: "puedes vender, cobrar y atender clientes.",
} as const;

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
          <ul className="mt-2 divide-y divide-rule border-y border-rule">
            {group.links.map(({ label, to, about }) => (
              // The whole row is the link's target; its name is the label alone.
              <li
                key={to}
                className="relative flex min-h-16 items-center gap-3 py-3 has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={to}
                    aria-describedby={`sobre-${label}`}
                    className="font-semibold outline-none after:absolute after:inset-0"
                  >
                    {label}
                  </Link>
                  <p id={`sobre-${label}`} className={hint}>
                    {about}
                  </p>
                </div>
                <ChevronDrawing className="size-5 text-ink-soft" />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section aria-labelledby="sesion">
        <h2 id="sesion" className={sectionTitle}>
          Tu sesión
        </h2>
        <p className="mt-2">
          Entraste como <strong>{user.name}</strong>.
        </p>
        <p className={hint}>
          {roleLabel[user.role]}: {roleMeans[user.role]}
        </p>
        <p className={`mt-4 ${hint}`}>Si sales, para volver a entrar necesitarás un código nuevo.</p>
        <Form method="post" action="/salir" className="mt-3">
          <SubmitButton pendingLabel="Saliendo…" className={`w-full sm:w-auto ${secondaryButton}`}>
            Salir
          </SubmitButton>
        </Form>
      </section>
    </div>
  );
}
