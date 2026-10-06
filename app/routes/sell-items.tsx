import { Outlet, type ShouldRevalidateFunctionArgs } from "react-router";

import { activeItemsByCategory } from "~/backend/catalog";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";

import type { Route } from "./+types/sell-items";

// What Vender offers: the active Items by Category. It is a layout around
// Vender, with a loader of its own, so that the browser can keep the Items
// while Vender's own loader, which is about a Bill and what was just
// recorded, runs again after every sale (spec §3.4).

export async function loader({ context }: Route.LoaderArgs) {
  requireUser(context);
  return { categories: await run(context, activeItemsByCategory) };
}

/** What Vender gets from here, with `useOutletContext`. */
export type SellItems = Route.ComponentProps["loaderData"];

/**
 * The Items are read when Vender is opened, and Productos is another page: a
 * change made there is read the next time Vender is opened. While Vender stays
 * on screen a recorded form changes no Item, so it does not read them again.
 * A refused one does: an Item retired meanwhile is among what the server
 * refuses, and the screen has to stop offering it.
 */
export function shouldRevalidate({ actionStatus, defaultShouldRevalidate, formMethod }: ShouldRevalidateFunctionArgs) {
  if (actionStatus !== undefined && actionStatus >= 400) return true;
  if (formMethod !== undefined && formMethod !== "GET") return false;
  return defaultShouldRevalidate;
}

export default function SellItemsLayout({ loaderData }: Route.ComponentProps) {
  return <Outlet context={loaderData} />;
}
