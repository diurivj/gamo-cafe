import { data } from "react-router";
import { Effect } from "effect";

import { CurrentUser } from "~/backend/current-user";
import { addCustomer, searchCustomers } from "~/backend/customers";
import { run } from "~/backend/run.server";
import { requireUser } from "~/session.server";
import { customerNameMessages } from "~/shared/customer-messages";

import type { Route } from "./+types/customer-picker";

// What `CustomerPicker` (~/components/customer-picker) talks to, from inside
// whatever screen it is on. Any User may search and add (spec §4.1).

/**
 * The active Customers whose name starts with `?q=`. Retired Customers cannot
 * be chosen for a Bill, so they are never offered. `q` comes back as it was
 * sent, for the picker to tell which typed text an answer is for.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  requireUser(context);
  const typed = new URL(request.url).searchParams.get("q") ?? "";
  const customers = await run(context, searchCustomers(typed));
  return {
    q: typed,
    customers: customers.map(({ id, name, note }) => ({ id, name, note })),
  };
}

/** Adds a Customer named `name` and answers with it, or with why not. */
export async function action({ context, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();
  const program = addCustomer({ name: String(form.get("name") ?? "") }).pipe(
    Effect.provideService(CurrentUser, user),
  );

  const result = await run(context, program, (error) => ({ error: customerNameMessages[error._tag] }));
  if ("error" in result) return data(result, { status: 400 });
  return { customer: result };
}
