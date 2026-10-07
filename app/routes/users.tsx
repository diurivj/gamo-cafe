import { useEffect } from "react";
import { Effect } from "effect";
import { data, Form, redirect, useFetcher } from "react-router";

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
import { answerWithNotice, takeNotice } from "~/notice.server";
import { requireUser } from "~/session.server";
import { type Notice, type TakenNotice, useSaidNotice } from "~/shared/notice";
import { formatSignInCode } from "~/shared/secret";
import { SubmitButton } from "~/components/submit-button";

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
  // What the form that redirected here has to say (spec §3.4).
  return { users, me: user.id, notice: takeNotice(context) };
}

// What an action that worked has to say on the screen that sent the form: a
// code to read out, or a short notice.
const issued = ({ user, code }: { user: { name: string }; code: string }): Notice => ({
  code: { name: user.name, code: formatSignInCode(code) },
});

const message = (text: string): Notice => ({ message: text });

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
        return message("Se cerró su sesión en todos los teléfonos.");
      case "deactivate":
        yield* deactivateUser(userId);
        return message("Usuario desactivado.");
      case "reactivate":
        yield* reactivateUser(userId);
        return message("Usuario reactivado. Dale un código nuevo para que entre.");
      case "change-role":
        yield* changeRole(userId, role);
        return message(`Ahora es ${roleLabel[role]}.`);
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
  // Recorded: the request that sent the form is answered with the notice, so
  // a reload or the back button neither records it again nor issues another
  // code (spec §3.4).
  return answerWithNotice(request, "/usuarios", result);
}

const button = "rounded-xl border border-stone-300 bg-white px-4 py-3 font-medium disabled:opacity-60";

export default function Users({ loaderData, actionData }: Route.ComponentProps) {
  const { users, me, notice: landingNotice } = loaderData;
  // The last notice the page said: the answer of the form that was sent, a
  // row's own answer (below), or the one a document POST left for the loader
  // (spec §3.4, ticket 34).
  const answeredNotice = actionData && "notice" in actionData ? actionData.notice : null;
  const [said, say] = useSaidNotice(landingNotice, answeredNotice);

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Usuarios</h1>

      {said?.code ? (
        <div className="mt-6 rounded-xl border border-stone-900 bg-white p-4">
          <p className="text-lg">
            Código de acceso para <strong>{said.code.name}</strong>
          </p>
          <output className="mt-2 block font-mono text-4xl font-semibold tracking-widest">
            {said.code.code}
          </output>
          <p className="mt-2 text-stone-600">
            Sirve una sola vez y dura 10 minutos. No se volverá a mostrar.
          </p>
        </div>
      ) : null}
      {said?.message ? (
        <p role="status" className="mt-6 rounded-xl bg-stone-200 px-4 py-3">
          {said.message}
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
          <SubmitButton
            name="intent"
            value="add"
            className="rounded-xl bg-stone-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
          >
            Agregar y dar código
          </SubmitButton>
        </Form>
      </section>

      <section aria-labelledby="user-list" className="mt-10">
        <h2 id="user-list" className="text-xl font-semibold">
          Todos los usuarios
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          {users.map((user) => (
            <UserRow key={user.id} user={user} isMe={user.id === me} onNotice={say} />
          ))}
        </ul>
      </section>
    </>
  );
}

/**
 * One User on the list. Their role and whether they are active are harmless
 * and reversible, so the row shows a change at once (spec §3.4): while the
 * form is on its way the User is what was asked for, and a refusal puts them
 * back as the server has them. What was recorded is said by the page, from
 * the row's own answer (ticket 34). A new code and signing out are not shown
 * ahead.
 */
function UserRow({
  user,
  isMe,
  onNotice,
}: {
  user: Route.ComponentProps["loaderData"]["users"][number];
  isMe: boolean;
  onNotice: (notice: TakenNotice) => void;
}) {
  const change = useFetcher<typeof action>({ key: `user:${user.id}` });
  const pending = change.state !== "idle";
  const intent = change.formData?.get("intent");
  const active = intent === "deactivate" ? false : intent === "reactivate" ? true : user.active;
  const askedRole = intent === "change-role" ? change.formData?.get("role") : null;
  const role = askedRole === "admin" || askedRole === "worker" ? askedRole : user.role;
  const error = change.data && "error" in change.data ? change.data.error : null;
  // The row's own words, for the page to say.
  const answered = change.data && "notice" in change.data ? change.data.notice : null;
  useEffect(() => {
    if (answered) onNotice(answered);
  }, [answered?.id]);

  return (
    <li aria-label={user.name} className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-lg font-semibold break-words">
        {user.name}
        {isMe ? <span className="font-normal text-stone-600"> (tú)</span> : null}
      </p>
      <p className="text-stone-600">
        {roleLabel[role]}
        {active ? null : " · Desactivado"}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-red-800">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {active ? (
          <Form method="post" className="contents">
            <input type="hidden" name="userId" value={user.id} />
            <SubmitButton name="intent" value="new-code" disabled={pending} className={button}>
              Código nuevo
            </SubmitButton>
            <SubmitButton name="intent" value="sign-out-everywhere" disabled={pending} className={button}>
              Cerrar sesión en todos los teléfonos
            </SubmitButton>
          </Form>
        ) : null}
        <change.Form method="post" className="contents">
          <input type="hidden" name="userId" value={user.id} />
          <SubmitButton
            name="intent"
            value={active ? "deactivate" : "reactivate"}
            fetcher={change}
            className={button}
          >
            {active ? "Desactivar" : "Reactivar"}
          </SubmitButton>
        </change.Form>
      </div>
      <change.Form method="post" className="mt-2">
        <input type="hidden" name="userId" value={user.id} />
        <input type="hidden" name="role" value={role === "admin" ? "worker" : "admin"} />
        <SubmitButton
          name="intent"
          value="change-role"
          fetcher={change}
          className={button}
        >
          {role === "admin" ? "Hacer empleado" : "Hacer administrador"}
        </SubmitButton>
      </change.Form>
    </li>
  );
}
