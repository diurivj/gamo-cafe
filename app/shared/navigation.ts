/**
 * The shape of the navigation (UI redesign §4): the four destinations a role
 * has, and the groups of links on Más. `~/navigation.server` holds what each
 * role gets; the loaders send only that role's, so this module carries no
 * label or path of its own to a phone.
 */

/** The drawing beside a destination's word, or a link's of Más. */
export type NavigationIcon =
  | "home"
  | "bag"
  | "calendar"
  | "box"
  | "receipt"
  | "person"
  | "people"
  | "menu"
  | "stack"
  | "wallet"
  | "scale"
  | "clock"
  | "tag"
  | "badge"
  | "cup";

/** One of a role's four destinations. The first is Inicio, the last one Más. */
export interface Destination {
  readonly label: string;
  readonly to: string;
  readonly icon: NavigationIcon;
  /** The paths it holds besides `to`: each of them and every screen under it. */
  readonly holds?: ReadonlyArray<string>;
}

/** A link on Más. */
export interface MoreLink {
  readonly label: string;
  readonly to: string;
  /** The drawing beside its words: what a User recognizes it by before reading. */
  readonly icon: NavigationIcon;
}

/** The links of Más that belong to one task. */
export interface MoreGroup {
  readonly title: string;
  readonly links: ReadonlyArray<MoreLink>;
}

/**
 * The destination a screen belongs to: the one whose path the screen is at or
 * under. A screen that none of them holds is reached through Más, the last.
 */
export function destinationAt<D extends Pick<Destination, "to" | "holds">>(
  destinations: ReadonlyArray<D>,
  pathname: string,
): D | undefined {
  const holds = (path: string) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`));
  return (
    destinations.find((destination) => [destination.to, ...(destination.holds ?? [])].some(holds)) ??
    destinations.at(-1)
  );
}
