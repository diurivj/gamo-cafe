import { Form, NavLink, Outlet } from "react-router";

import { requireUser } from "~/session.server";

import type { Route } from "./+types/shell";

/**
 * The signed-in shell: who is signed in, the way out, and the navigation.
 *
 * A section with `to` is a link; one without is a placeholder until its
 * ticket adds the route. The Admin list is not sent to a Worker's phone, but
 * that is tidiness, not enforcement: each Admin route guards itself.
 */
type Section = { readonly label: string; readonly to?: string };

const everyUser: ReadonlyArray<Section> = [
  { label: "Vender", to: "/" },
  { label: "Cuentas abiertas" },
  { label: "Clientes", to: "/clientes" },
  { label: "Mi día" },
];

const adminOnly: ReadonlyArray<Section> = [
  { label: "Día" },
  { label: "Cuentas" },
  { label: "Por cobrar" },
  { label: "Inventario" },
  { label: "Diferencias" },
  { label: "Historial" },
  { label: "Productos", to: "/productos" },
  { label: "Usuarios", to: "/usuarios" },
];

export function loader({ context }: Route.LoaderArgs) {
  const user = requireUser(context);
  return {
    user: { name: user.name, role: user.role },
    sections: user.role === "admin" ? { everyUser, adminOnly } : { everyUser, adminOnly: [] },
  };
}

function Sections({ label, sections }: { label: string; sections: ReadonlyArray<Section> }) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-2">
        {sections.map((section) => (
          <li key={section.label}>
            {section.to ? (
              <NavLink
                to={section.to}
                end
                className="block rounded-full border border-stone-300 bg-white px-4 py-2 font-medium aria-[current=page]:border-stone-900 aria-[current=page]:bg-stone-900 aria-[current=page]:text-white"
              >
                {section.label}
              </NavLink>
            ) : (
              <span className="block rounded-full border border-dashed border-stone-300 px-4 py-2 text-stone-500">
                {section.label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function Shell({ loaderData }: Route.ComponentProps) {
  const { user, sections } = loaderData;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-8">
      <header className="flex items-center justify-between gap-4 py-4">
        <div className="min-w-0">
          <p className="font-semibold">Gamo Cafe</p>
          <p className="truncate text-stone-600">
            {user.name} · {user.role === "admin" ? "Administrador" : "Empleado"}
          </p>
        </div>
        <Form method="post" action="/salir">
          <button type="submit" className="rounded-xl border border-stone-300 bg-white px-4 py-3 font-medium">
            Salir
          </button>
        </Form>
      </header>

      <div className="flex flex-col gap-3 border-y border-stone-200 py-3">
        <Sections label="Secciones" sections={sections.everyUser} />
        {sections.adminOnly.length > 0 ? (
          <Sections label="Administración" sections={sections.adminOnly} />
        ) : null}
      </div>

      <main className="flex-1 py-6">
        <Outlet />
      </main>
    </div>
  );
}
