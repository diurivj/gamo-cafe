import { Effect } from "effect";
import { data, Form, redirect, useNavigation } from "react-router";

import { CurrentUser, type Role } from "~/backend/current-user";
import { run } from "~/backend/run.server";
import {
  addUserWithCode,
  changeRole,
  deactivateUser,
  issueCodeForUser,
  listUsers,
  reactivateUser,
  signOutEverywhere,
} from "~/backend/users";
import { requireUser } from "~/session.server";
import { formatSignInCode } from "~/shared/secret";

import type { Route } from "./+types/users";

export const meta: Route.MetaFunction = () => [{ title: "Usuarios · Gamo Cafe" }];

/** What a Worker gets from this screen and its actions (spec §4.1). */
function forbidden(): Response {
  return new Response(null, { status: 403 });
}

function badRequest(): Response {
  return new Response(null, { status: 400 });
}

const roleLabel = { admin: "Administrador", worker: "Empleado" } as const;

function parseRole(value: FormDataEntryValue | null): Role {
  if (value === "admin" || value === "worker") return value;
  throw badRequest();
}

export async function loader({ context }: Route.LoaderArgs) {
  const user = requireUser(context);
  const users = await run(context, listUsers.pipe(Effect.provideService(CurrentUser, user)), (error) => {
    switch (error._tag) {
      case "AdminOnly":
        throw forbidden();
    }
  });
  return { users, me: user.id };
}

/** What an action that worked has to say: a code to read out, or a short notice. */
type Done =
  | { readonly issued: { readonly name: string; readonly code: string } }
  | { readonly notice: string };

const issued = ({ user, code }: { user: { name: string }; code: string }): Done => ({
  issued: { name: user.name, code: formatSignInCode(code) },
});

const notice = (text: string): Done => ({ notice: text });

const intents = ["add", "new-code", "sign-out-everywhere", "deactivate", "reactivate", "change-role"] as const;

/** The operation a submitted form asks for. A form it does not understand is answered 400. */
function programFor(form: FormData) {
  const field = (name: string) => String(form.get(name) ?? "");
  const intent = intents.find((known) => known === field("intent"));
  if (!intent) throw badRequest();
  const role = intent === "add" || intent === "change-role" ? parseRole(form.get("role")) : "worker";
  const userId = field("userId");

  // One generator, so that its error type is the union of every operation's.
  return Effect.gen(function* () {
    switch (intent) {
      case "add":
        return issued(yield* addUserWithCode(field("name"), role));
      case "new-code":
        return issued(yield* issueCodeForUser(userId));
      case "sign-out-everywhere":
        yield* signOutEverywhere(userId);
        return notice("Se cerró su sesión en todos los teléfonos.");
      case "deactivate":
        yield* deactivateUser(userId);
        return notice("Usuario desactivado.");
      case "reactivate":
        yield* reactivateUser(userId);
        return notice("Usuario reactivado. Dale un código nuevo para que entre.");
      case "change-role":
        yield* changeRole(userId, role);
        return notice(`Ahora es ${roleLabel[role]}.`);
    }
  });
}

export async function action({ context, request }: Route.ActionArgs) {
  const user = requireUser(context);
  const form = await request.formData();

  const result = await run(
    context,
    programFor(form).pipe(Effect.provideService(CurrentUser, user)),
    (error) => {
      switch (error._tag) {
        case "AdminOnly":
          throw forbidden();
        case "UserNameRequired":
          return { error: "Escribe el nombre del usuario." };
        case "UserNameTaken":
          return { error: "Ya hay un usuario con ese nombre. Si está desactivado, reactívalo." };
        case "UserNotFound":
          return { error: "Ese usuario no existe." };
        case "UserIsDeactivated":
          return { error: "Ese usuario está desactivado. Reactívalo para darle un código." };
        case "LastActiveAdmin":
          return { error: "Debe quedar al menos un administrador activo." };
      }
    },
  );

  if ("error" in result) return data(result, { status: 400 });
  // An Admin who made themselves a Worker has no business here any more.
  if (form.get("intent") === "change-role" && form.get("userId") === user.id && form.get("role") === "worker") {
    throw redirect("/");
  }
  return result;
}

const button = "rounded-xl border border-stone-300 bg-white px-4 py-3 font-medium disabled:opacity-60";

export default function Users({ loaderData, actionData }: Route.ComponentProps) {
  const { users, me } = loaderData;
  const sending = useNavigation().state !== "idle";

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Usuarios</h1>

      {actionData && "issued" in actionData ? (
        <div className="mt-6 rounded-xl border border-stone-900 bg-white p-4">
          <p className="text-lg">
            Código de acceso para <strong>{actionData.issued.name}</strong>
          </p>
          <output className="mt-2 block font-mono text-4xl font-semibold tracking-widest">
            {actionData.issued.code}
          </output>
          <p className="mt-2 text-stone-600">
            Sirve una sola vez y dura 10 minutos. No se volverá a mostrar.
          </p>
        </div>
      ) : null}
      {actionData && "notice" in actionData ? (
        <p role="status" className="mt-6 rounded-xl bg-stone-200 px-4 py-3">
          {actionData.notice}
        </p>
      ) : null}
      {actionData && "error" in actionData ? (
        <p role="alert" className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-red-800">
          {actionData.error}
        </p>
      ) : null}

      <section aria-labelledby="add-user" className="mt-8">
        <h2 id="add-user" className="text-xl font-semibold">
          Agregar usuario
        </h2>
        <Form method="post" className="mt-3 flex flex-col gap-3">
          <label htmlFor="name" className="font-medium">
            Nombre
          </label>
          <input
            id="name"
            name="name"
            required
            maxLength={60}
            autoComplete="off"
            className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg"
          />
          <label htmlFor="role" className="font-medium">
            Rol
          </label>
          <select
            id="role"
            name="role"
            defaultValue="worker"
            className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-lg"
          >
            <option value="worker">{roleLabel.worker}</option>
            <option value="admin">{roleLabel.admin}</option>
          </select>
          <button
            type="submit"
            name="intent"
            value="add"
            disabled={sending}
            className="rounded-xl bg-stone-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
          >
            Agregar y dar código
          </button>
        </Form>
      </section>

      <section aria-labelledby="user-list" className="mt-10">
        <h2 id="user-list" className="text-xl font-semibold">
          Todos los usuarios
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          {users.map((user) => (
            <li
              key={user.id}
              aria-label={user.name}
              className="rounded-xl border border-stone-200 bg-white p-4"
            >
              <p className="text-lg font-semibold break-words">
                {user.name}
                {user.id === me ? <span className="font-normal text-stone-600"> (tú)</span> : null}
              </p>
              <p className="text-stone-600">
                {roleLabel[user.role]}
                {user.active ? null : " · Desactivado"}
              </p>
              <Form method="post" className="mt-3 flex flex-wrap gap-2">
                <input type="hidden" name="userId" value={user.id} />
                {user.active ? (
                  <>
                    <button type="submit" name="intent" value="new-code" disabled={sending} className={button}>
                      Código nuevo
                    </button>
                    <button
                      type="submit"
                      name="intent"
                      value="sign-out-everywhere"
                      disabled={sending}
                      className={button}
                    >
                      Cerrar sesión en todos los teléfonos
                    </button>
                    <button type="submit" name="intent" value="deactivate" disabled={sending} className={button}>
                      Desactivar
                    </button>
                  </>
                ) : (
                  <button type="submit" name="intent" value="reactivate" disabled={sending} className={button}>
                    Reactivar
                  </button>
                )}
              </Form>
              <Form method="post" className="mt-2">
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="role" value={user.role === "admin" ? "worker" : "admin"} />
                <button type="submit" name="intent" value="change-role" disabled={sending} className={button}>
                  {user.role === "admin" ? "Hacer empleado" : "Hacer administrador"}
                </button>
              </Form>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
