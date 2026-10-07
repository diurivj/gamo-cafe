import { Outlet, type ShouldRevalidateFunctionArgs } from "react-router";

import { activeItemsByCategory } from "~/backend/catalog";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";
import { onlyStepChanged } from "~/shared/sale";

import type { Route } from "./+types/sell-items";

// What Vender offers: the active Items by Category. It is a layout around
// Vender, with a loader of its own, so that the browser keeps the Items while
// Vender's own loader, which is about the Bill a sale targets, runs again
// when that changes (spec §3.4).

export async function loader({ context }: Route.LoaderArgs) {
  requireUser(context);
  return { categories: await run(context, activeItemsByCategory) };
}

/** What Vender gets from here, with `useOutletContext`. */
export type SellItems = Route.ComponentProps["loaderData"];

/**
 * The Items are read when Vender is opened, and Productos is another page: a
 * change made there is read the next time Vender is opened. While Vender stays
 * on screen nothing it does changes an Item: a sale travels outside the
 * router, and moving between its two steps only changes `?paso=`. Vender asks
 * for them again itself when a refusal says a price may have changed.
 */
export function shouldRevalidate({ currentUrl, defaultShouldRevalidate, nextUrl }: ShouldRevalidateFunctionArgs) {
  return onlyStepChanged(currentUrl, nextUrl) ? false : defaultShouldRevalidate;
}

export default function SellItemsLayout({ loaderData }: Route.ComponentProps) {
  return <Outlet context={loaderData} />;
}
