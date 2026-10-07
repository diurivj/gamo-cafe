import type { Role } from "~/backend/current-user";
import type { Destination, MoreGroup, MoreLink } from "~/shared/navigation";

/**
 * What each role's navigation holds (UI redesign §4.1, §4.2). Only loaders
 * read this, so an Admin's labels and paths are not sent to a Worker's phone.
 * That is tidiness, not enforcement: each Admin route guards itself.
 *
 * A new screen gets its link here: among the four destinations of a role, or
 * in a group of its Más.
 */

const sell: Destination = { label: "Vender", to: "/", icon: "bag" };
const more: Destination = { label: "Más", to: "/mas", icon: "menu" };

const destinations: Readonly<Record<Role, ReadonlyArray<Destination>>> = {
  admin: [
    sell,
    { label: "Día", to: "/dia", icon: "calendar" },
    { label: "Inventario", to: "/inventario", icon: "box" },
    more,
  ],
  worker: [
    sell,
    // A Worker's Cuentas is Cuentas abiertas, and the Bills opened from it.
    { label: "Cuentas", to: "/cuentas-abiertas", icon: "receipt", holds: ["/cuentas"] },
    { label: "Mi día", to: "/mi-dia", icon: "person" },
    more,
  ],
};

const customers: MoreLink = { label: "Clientes", to: "/clientes" };

const moreGroups: Readonly<Record<Role, ReadonlyArray<MoreGroup>>> = {
  admin: [
    {
      title: "Cuentas y clientes",
      links: [
        { label: "Cuentas abiertas", to: "/cuentas-abiertas" },
        { label: "Cuentas", to: "/cuentas" },
        { label: "Por cobrar", to: "/por-cobrar" },
        customers,
      ],
    },
    {
      title: "Revisar",
      links: [
        { label: "Mi día", to: "/mi-dia" },
        { label: "Diferencias", to: "/diferencias" },
        { label: "Historial", to: "/historial" },
      ],
    },
    {
      title: "Catálogo y accesos",
      links: [
        { label: "Productos", to: "/productos" },
        { label: "Usuarios", to: "/usuarios" },
      ],
    },
  ],
  worker: [{ title: "Cuentas y clientes", links: [customers] }],
};

/** The four destinations of a role, in order; Más is the last. */
export function destinationsFor(role: Role): ReadonlyArray<Destination> {
  return destinations[role];
}

/** What Más offers a role: every screen that is not one of its destinations. */
export function moreGroupsFor(role: Role): ReadonlyArray<MoreGroup> {
  return moreGroups[role];
}
