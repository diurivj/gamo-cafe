import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import { Form, Link, redirect, type ShouldRevalidateFunctionArgs, useSearchParams } from "react-router";

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
import { type Refusal, refused, requireAdminUser, text } from "~/catalog-forms.server";
import { BackLink } from "~/components/back-link";
import { FieldError, FormError, type FormRefusal, refusedField, useFocusOnRefusal } from "~/components/field-error";
import { ChevronDrawing } from "~/components/icons";
import { Notice } from "~/components/notice";
import { hint, pageTitle, rowCard, sectionTitle } from "~/components/styles";
import { SubmitButton } from "~/components/submit-button";
import { Badge } from "~/components/ui/badge";
import { buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
import { answerWithNotice, takeNotice } from "~/notice.server";
import { type Notice as NoticeToSay, type TakenNotice, useSaidNotice } from "~/shared/notice";
import { roleLabel, roleMeans } from "~/shared/role";
import { formatSignInCode } from "~/shared/secret";

import type { Route } from "./+types/users";

export const meta: Route.MetaFunction = () => [{ title: "Usuarios · Gamo Cafe" }];

// Usuarios (spec §3.5, §4.1; UI redesign §7): who works with the app, which
// is not who buys and says so. The list is every User with their role, the
// deactivated ones apart; no form is on it. Adding a User and one User's
// access are steps of the same screen (`?paso=nuevo`, `?paso=usuario&id=…`),
// each a `<Form>` this page's action answers with a notice of what was
// recorded, or with the one-time code to read out. A User's step says what
// each action does before it is tapped, and names them in its title: the step
// is the confirmation. Nothing is shown before the server's answer. An Admin
// screen: `requireAdminUser` refuses a Worker before anything is read, and
// the operations refuse one again.

const USUARIOS = "/usuarios";

/** Which step of the screen an address asks for. */
type Step = { readonly name: "list" } | { readonly name: "new" } | { readonly name: "user"; readonly id: string };

function stepOf(search: URLSearchParams): Step {
  switch (search.get("paso")) {
    case "nuevo":
      return { name: "new" };
    case "usuario":
      return { name: "user", id: search.get("id") ?? "" };
    default:
      return { name: "list" };
  }
}

const NEW_USER_HREF = `${USUARIOS}?paso=nuevo`;
const userHref = (id: string) => `${USUARIOS}?${new URLSearchParams({ paso: "usuario", id })}`;

function stepHref(step: Step): string {
  switch (step.name) {
    case "list":
      return USUARIOS;
    case "new":
      return NEW_USER_HREF;
    case "user":
      return userHref(step.id);
  }
}

function badRequest(): Response {
  return new Response(null, { status: 400 });
}

function parseRole(value: FormDataEntryValue | null): Role {
  if (value === "admin" || value === "worker") return value;
  throw badRequest();
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const admin = requireAdminUser(context);
  const users = await run(context, listUsers.pipe(Effect.provideService(CurrentUser, admin)), (error) => {
    switch (error._tag) {
      case "AdminOnly":
        throw new Response(null, { status: 403 });
    }
  });
  const step = stepOf(new URL(request.url).searchParams);
  if (step.name === "user" && !users.some((user) => user.id === step.id)) {
    throw new Response(null, { status: 404 });
  }
  // What a form the browser posted by itself has to say (spec §3.4).
  return { users, me: admin.id, notice: takeNotice(context) };
}

// What an action that worked has to say on the screen that sent the form: a
// code to read out, or a short notice.
const issued = ({ user, code }: { user: { name: string }; code: string }): NoticeToSay => ({
  code: { name: user.name, code: formatSignInCode(code) },
});

const message = (said: string): NoticeToSay => ({ message: said });

const intents = ["add", "new-code", "sign-out-everywhere", "deactivate", "reactivate", "change-role"] as const;
type Intent = (typeof intents)[number];

/** Which form of the page a submission is: what it asks for, and about whom. A refusal is shown on it. */
const formKeyOf = (intent: string, userId: string) => `${intent}:${userId}`;

/** The operation a submitted form asks for. A form it does not understand is answered 400. */
function programFor(form: FormData) {
  const intent = intents.find((known) => known === text(form, "intent"));
  if (!intent) throw badRequest();
  const role = intent === "add" || intent === "change-role" ? parseRole(form.get("role")) : "worker";
  const userId = text(form, "userId");

  // One generator, so that its error type is the union of every operation's.
  return Effect.gen(function* () {
    switch (intent) {
      case "add":
        return issued(yield* addUserWithCode(text(form, "name"), role));
      case "new-code":
        return issued(yield* issueCodeForUser(userId));
      case "sign-out-everywhere":
        yield* signOutEverywhere(userId);
        return message("Se cerró su sesión en todos los teléfonos. Para volver a entrar necesita un código.");
      case "deactivate":
        yield* deactivateUser(userId);
        return message("Usuario desactivado. Ya no puede entrar.");
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
  const admin = requireAdminUser(context);
  const form = await request.formData();
  const formKey = formKeyOf(text(form, "intent"), text(form, "userId"));

  const result = await run(
    context,
    programFor(form).pipe(Effect.provideService(CurrentUser, admin)),
    (error): Refusal => {
      switch (error._tag) {
        case "AdminOnly":
          throw new Response(null, { status: 403 });
        case "UserNameRequired":
          return { error: "Escribe el nombre del usuario.", field: "name" };
        case "UserNameTaken":
          return { error: "Ya hay un usuario con ese nombre. Si está desactivado, reactívalo.", field: "name" };
        case "UserNotFound":
          return { error: "Ese usuario no existe." };
        case "UserIsDeactivated":
          return { error: "Ese usuario está desactivado. Reactívalo para darle un código." };
        case "LastActiveAdmin":
          return { error: "Debe quedar al menos un administrador activo. Haz administrador a alguien más primero." };
      }
    },
  );

  if ("error" in result) return refused(result, formKey);
  // An Admin who made themselves a Worker has no business here any more.
  if (form.get("intent") === "change-role" && form.get("userId") === admin.id && form.get("role") === "worker") {
    throw redirect("/");
  }
  // Recorded: the request that sent the form is answered with the notice, so
  // a reload or the back button neither records it again nor issues another
  // code, and no other tab can read the code (spec §3.4). A document POST
  // lands on the step it was sent from.
  const here = stepHref(stepOf(new URL(request.url).searchParams));
  return answerWithNotice(request, here, { ...result, form: formKey });
}

/**
 * A form that was refused is most often a stale one — another Admin changed
 * the User meanwhile — so the Users are read again after it too, and the page
 * is back to what the server has. The router would otherwise keep what it had
 * after a 400.
 */
export function shouldRevalidate({ formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  return formMethod !== undefined && formMethod !== "GET" ? true : defaultShouldRevalidate;
}

type User = Route.ComponentProps["loaderData"]["users"][number];
type Heading = RefObject<HTMLHeadingElement | null>;

/** The `id` of what the last recorded form said. */
const RECORDED = "recorded";
/** The `id` of what the last form was refused for, when it is about no field. */
const REFUSED = "refused";

/**
 * A refusal that is about no field. The Users are read again after it, and
 * the button that was tapped may be gone with what it offered, so the refusal
 * takes the keyboard — where it is first shown, and again if the page that
 * was read puts it elsewhere.
 */
function Refused({ refusal }: { readonly refusal: FormRefusal }) {
  const said = useRef<HTMLDivElement>(null);
  useEffect(() => {
    said.current?.focus();
  }, [refusal]);
  return (
    <div ref={said} id={REFUSED} tabIndex={-1} className="rounded-2xl outline-none">
      <Notice tone="error">{refusal.error}</Notice>
    </div>
  );
}

const withCode = (notice: TakenNotice | null) => (notice?.code ? notice : null);

export default function Users({ loaderData, actionData }: Route.ComponentProps) {
  const { users, me, notice: landingNotice } = loaderData;
  const [search] = useSearchParams();
  const step = stepOf(search);

  const refusal: FormRefusal | undefined = actionData && "error" in actionData ? actionData : undefined;
  useFocusOnRefusal(refusal);
  // The answer of the form that was just recorded, or the notice a document
  // POST left for the loader (spec §3.4, ticket 34).
  const answered = actionData && "notice" in actionData ? actionData.notice : null;
  // What was recorded takes the keyboard: the code is read out from there.
  useEffect(() => {
    if (answered) document.getElementById(RECORDED)?.focus();
  }, [answered?.id]);

  // A new step takes the keyboard and the screen reader to its heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const view = stepHref(step);
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    heading.current?.focus({ preventScroll: true });
  }, [view]);

  const user = step.name === "user" ? users.find((known) => known.id === step.id) : undefined;
  const answers = { landing: landingNotice, answered };

  if (step.name === "new") return <NewUser heading={heading} refusal={refusal} {...answers} />;
  if (user) {
    const activeAdmins = users.filter((known) => known.active && known.role === "admin");
    return (
      <OneUser
        // Another User's step starts without this one's code.
        key={user.id}
        user={user}
        isMe={user.id === me}
        onlyAdmin={activeAdmins.length === 1 && activeAdmins[0]?.id === user.id}
        heading={heading}
        refusal={refusal}
        {...answers}
      />
    );
  }
  return <UserList users={users} me={me} heading={heading} refusal={refusal} {...answers} />;
}

interface Answers {
  /** What a form the browser posted by itself left for this page. */
  readonly landing: TakenNotice | null;
  /** The answer of the form this screen just sent. */
  readonly answered: TakenNotice | null;
}

/**
 * What the last recorded form said, and the last code that was issued on this
 * step. The code is the only time it is known, so it stays while the step
 * does — a form recorded after it does not take it off the screen — until
 * `codeStands` says it stopped working.
 */
function Recorded({
  landing,
  answered,
  codeStands = true,
  own = false,
}: Answers & {
  readonly codeStands?: boolean;
  /** The code is the Admin's own, for another phone of theirs. */
  readonly own?: boolean;
}) {
  const [issuedCode] = useSaidNotice(withCode(landing), withCode(answered));
  // The answer's own code is on the page with the answer, not a render later.
  const lastCode = withCode(answered) ?? issuedCode;
  // A code that stopped working does not come back when the User is reactivated.
  const [endedCode, setEndedCode] = useState<string | null>(null);
  if (!codeStands && lastCode && endedCode !== lastCode.id) setEndedCode(lastCode.id);
  const code = codeStands && lastCode && lastCode.id !== endedCode ? lastCode.code : undefined;
  const said = (answered ?? landing)?.message;
  if (!code && !said) return null;

  return (
    <div id={RECORDED} tabIndex={-1} className="flex flex-col gap-3 rounded-2xl outline-none">
      {code ? (
        <Card size="sm" className="animate-rise bg-[color-mix(in_oklch,var(--card),var(--brand)_6%)] ring-brand/25">
          <CardContent className="flex flex-col gap-2">
            <p className="wrap-anywhere">
              Código de acceso para <strong>{code.name}</strong>
            </p>
            <output
              // Read out one character at a time, not as two words.
              aria-label={code.code.replace(" ", ",").split("").join(" ")}
              // Each group of four fits a 320px phone with text twice as large, and the code breaks between them:
              // in a font whose letters are all as wide, which a W or an M of the app's own font is not.
              className="my-1 font-mono text-3xl font-semibold tracking-widest select-all"
            >
              {code.code}
            </output>
            <p className="wrap-anywhere">
              {own
                ? "Escríbelo en Entrar, en tu otro teléfono, con o sin el espacio."
                : "Díselo: lo escribe en Entrar, en su teléfono, con o sin el espacio."}
            </p>
            <p className={hint}>
              Sirve una sola vez y dura 10 minutos. No se volverá a mostrar: si se pierde o vence, da un código nuevo.
            </p>
          </CardContent>
        </Card>
      ) : null}
      {said ? <Notice tone="success">{said}</Notice> : null}
    </div>
  );
}

/** Every User: who can sign in, then who cannot. */
function UserList({
  users,
  me,
  heading,
  refusal,
  ...answers
}: Answers & {
  readonly users: ReadonlyArray<User>;
  readonly me: string;
  readonly heading: Heading;
  /** What a form sent to the list itself was refused for: the list has none of its own. */
  readonly refusal: FormRefusal | undefined;
}) {
  const active = users.filter((user) => user.active);
  const deactivated = users.filter((user) => !user.active);
  const rows = (listed: ReadonlyArray<User>) => (
    <ul className="flex flex-col gap-3">
      {listed.map((user) => (
        <UserRow key={user.id} user={user} isMe={user.id === me} />
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
          Usuarios
        </h1>
        <p className={hint}>
          Quienes trabajan con esta aplicación y entran con un código. Los clientes se anotan en{" "}
          <Link to="/clientes" className="font-medium text-foreground underline underline-offset-4">
            Clientes
          </Link>
          .
        </p>
      </div>
      <Recorded {...answers} />
      {refusal ? <Refused refusal={refusal} /> : null}

      <Link to={NEW_USER_HREF} className={buttonClasses({ size: "touch" })}>
        Agregar usuario
      </Link>

      <section aria-labelledby="activos" className="flex flex-col gap-3">
        <h2 id="activos" className={sectionTitle}>
          Usuarios activos
        </h2>
        {active.length === 1 && active[0]?.id === me ? (
          <p className={hint}>Solo tú puedes entrar. Agrega a quien trabaja contigo y dale su código.</p>
        ) : null}
        {rows(active)}
      </section>

      {deactivated.length > 0 ? (
        <section aria-labelledby="desactivados" className="flex flex-col gap-3 border-t pt-6">
          <h2 id="desactivados" className={sectionTitle}>
            Usuarios desactivados
          </h2>
          <p className={hint}>No pueden entrar. Lo que registraron se conserva.</p>
          {rows(deactivated)}
        </section>
      ) : null}
    </div>
  );
}

/** A User as the list shows them: name, role and state in words, and the way into their step. */
function UserRow({ user, isMe }: { readonly user: User; readonly isMe: boolean }) {
  return (
    <li aria-label={user.name}>
      <Link to={userHref(user.id)} className="block rounded-2xl">
        <Card size="sm" className={rowCard}>
          <CardContent className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="max-w-full min-w-0 text-xl font-semibold wrap-anywhere">{user.name}</span>
                {user.active ? null : <Badge variant="secondary">Desactivado</Badge>}
              </span>
              <span className={`wrap-anywhere ${hint}`}>{isMe ? `${roleLabel[user.role]} · Eres tú` : roleLabel[user.role]}</span>
            </span>
            <ChevronDrawing className="size-5 shrink-0" />
          </CardContent>
        </Card>
      </Link>
    </li>
  );
}

/** The step that adds a User and shows their first code. It stays, ready for the next one. */
function NewUser({
  heading,
  refusal,
  ...answers
}: Answers & { readonly heading: Heading; readonly refusal: FormRefusal | undefined }) {
  // A recorded form starts over, empty; a refused one keeps what was typed.
  const [last] = useSaidNotice(answers.landing, answers.answered);

  return (
    <div className="flex flex-col gap-6">
      <BackLink to={USUARIOS} label="Usuarios" />
      <div className="flex flex-col gap-2">
        <h1 ref={heading} tabIndex={-1} className={`${pageTitle} outline-none`}>
          Agregar usuario
        </h1>
        <p className={hint}>Alguien que trabaja aquí. Al agregarlo verás su código para entrar.</p>
      </div>
      <Recorded {...answers} />

      <Form method="post" key={last?.id ?? "new"} className="flex flex-col gap-6">
        <input type="hidden" name="intent" value="add" />
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nombre</Label>
          <Input id="name" name="name" required maxLength={60} autoComplete="off" {...refusedField(refusal, "name")} />
          <FieldError refusal={refusal} field="name" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="role">Rol</Label>
          <NativeSelect id="role" name="role" defaultValue="worker" aria-describedby="role-hint">
            <NativeSelectOption value="worker">{roleLabel.worker}</NativeSelectOption>
            <NativeSelectOption value="admin">{roleLabel.admin}</NativeSelectOption>
          </NativeSelect>
          <div id="role-hint" className={`flex flex-col gap-1 ${hint}`}>
            <p>{`${roleLabel.worker}: ${roleMeans.worker}`}</p>
            <p>{`${roleLabel.admin}: ${roleMeans.admin}`}</p>
          </div>
        </div>
        <FormError refusal={refusal} />
        <SubmitButton pendingLabel="Agregando…" className={buttonClasses({ size: "touch" })}>
          Agregar y dar código
        </SubmitButton>
      </Form>
    </div>
  );
}

/** What a change of role does, said to the Admin before it is asked for. */
const roleChange = {
  admin: "Podrá ver el día de todos, todas las cuentas y el inventario, y administrar productos y usuarios.",
  worker:
    "Dejará de ver el día de todos, todas las cuentas y el inventario, y de administrar productos y usuarios. Seguirá vendiendo y cobrando.",
} as const;

/** One part of a User's step: what an action does, what it was refused for, and the action. */
function Part({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t pt-6">
      <h2 id={id} className={sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The step of one User: a new code, their role, their sessions and whether
 * they can sign in. Each part says what its action does; what the page
 * offers is a courtesy, and the operations in `~/backend/users` decide again.
 */
function OneUser({
  user,
  isMe,
  onlyAdmin,
  heading,
  refusal,
  ...answers
}: Answers & {
  readonly user: User;
  readonly isMe: boolean;
  /** The one active Admin: the app keeps them as they are (spec §3.5). */
  readonly onlyAdmin: boolean;
  readonly heading: Heading;
  readonly refusal: FormRefusal | undefined;
}) {
  // A refusal is said in the part it is about. The Users were read again
  // after it, so that part may be gone — the last Admin's step offers no
  // deactivation — and then the step says it at its top.
  const placedForms = (
    [
      "change-role",
      ...(user.active ? (["new-code", "sign-out-everywhere"] as const) : (["reactivate"] as const)),
      ...(user.active && !onlyAdmin ? (["deactivate"] as const) : []),
    ] satisfies ReadonlyArray<Intent>
  ).map((intent) => formKeyOf(intent, user.id));
  const unplaced = refusal && !placedForms.includes(refusal.form) ? refusal : undefined;
  const refusalOf = (intent: Intent) =>
    refusal?.form === formKeyOf(intent, user.id) ? <Refused refusal={refusal} /> : null;
  const otherRole = user.role === "admin" ? "worker" : "admin";
  /** A form of this step: its intent, this User, and one action named by its effect. */
  const actionForm = (
    intent: Intent,
    label: string,
    pendingLabel: string,
    // The step's one primary action is dark; one that takes access away is marked as that, as Cuenta's corrections are.
    variant: "default" | "outline" | "destructive" = "outline",
  ) => (
    <Form method="post">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="userId" value={user.id} />
      {intent === "change-role" ? <input type="hidden" name="role" value={otherRole} /> : null}
      <SubmitButton
        pendingLabel={pendingLabel}
        className={`${buttonClasses({ variant, size: "touch" })} w-full`}
      >
        {label}
      </SubmitButton>
    </Form>
  );

  return (
    <div className="flex flex-col gap-6">
      <BackLink to={USUARIOS} label="Usuarios" />
      <div className="flex flex-col gap-2">
        <h1 ref={heading} tabIndex={-1} className={`${pageTitle} wrap-anywhere outline-none`}>
          {user.name}
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant="outline">{roleLabel[user.role]}</Badge>
          <Badge variant={user.active ? "outline" : "secondary"}>{user.active ? "Activo" : "Desactivado"}</Badge>
          {isMe ? <span className={hint}>Eres tú</span> : null}
        </p>
      </div>
      {/* Deactivating ends every code that was not used. */}
      <Recorded {...answers} codeStands={user.active} own={isMe} />
      {unplaced ? <Refused refusal={unplaced} /> : null}

      {user.active ? (
        <Part id="codigo" title="Código de acceso">
          <p>
            {isMe
              ? "Para entrar en otro teléfono. Este sigue con su sesión."
              : "Para entrar en un teléfono nuevo, o después de salir. Sus otros teléfonos siguen con su sesión."}
          </p>
          {refusalOf("new-code")}
          {actionForm("new-code", "Dar código nuevo", "Creando código…", "default")}
        </Part>
      ) : (
        <Part id="estado" title="Reactivar">
          <p>{`No puede entrar. Al reactivarlo podrá entrar otra vez como ${roleLabel[user.role]}, con un código nuevo.`}</p>
          {refusalOf("reactivate")}
          {actionForm("reactivate", "Reactivar usuario", "Reactivando…", "default")}
        </Part>
      )}

      <Part id="rol" title="Rol">
        <p>{`${roleLabel[user.role]}: ${roleMeans[user.role]}`}</p>
        {refusalOf("change-role")}
        {onlyAdmin ? (
          <p>
            {isMe
              ? "Eres el único administrador activo, y debe quedar al menos uno. Para cambiar tu rol o desactivarte, primero haz administrador a alguien más."
              : "Es el único administrador activo, y debe quedar al menos uno. Para cambiar su rol o desactivarlo, primero haz administrador a alguien más."}
          </p>
        ) : (
          <>
            <p>
              {isMe && otherRole === "worker"
                ? "Como Empleado dejarás de ver el día de todos, todas las cuentas y el inventario, y de administrar productos y usuarios: saldrás de esta pantalla y solo otro administrador podrá devolverte el rol."
                : `Como ${roleLabel[otherRole]}: ${roleChange[otherRole]} ${
                    user.active
                      ? "El cambio se ve en su siguiente toque; su sesión sigue abierta."
                      : "Sigue desactivado: tendrá ese rol cuando se reactive."
                  }`}
            </p>
            {actionForm(
              "change-role",
              otherRole === "admin" ? "Hacer administrador" : "Hacer empleado",
              "Guardando…",
            )}
          </>
        )}
      </Part>

      {user.active ? (
        <>
          <Part id="sesiones" title="Sesiones">
            <p>
              {isMe
                ? "Saldrás de todos tus teléfonos, este también, y el código que esté en pantalla dejará de verse. Para volver a entrar necesitarás un código: date uno antes, arriba, anótalo y úsalo en 10 minutos."
                : "Saldrá de todos sus teléfonos en su siguiente toque. Para volver a entrar necesitará un código. Sigue activo."}
            </p>
            {isMe && onlyAdmin ? <p>Nadie más puede darte un código: eres el único administrador.</p> : null}
            {refusalOf("sign-out-everywhere")}
            {actionForm("sign-out-everywhere", "Cerrar sesión en todos los teléfonos", "Cerrando…", "destructive")}
          </Part>

          {onlyAdmin ? null : (
            <Part id="estado" title="Desactivar">
              <p>
                {isMe
                  ? "Ya no podrás entrar: saldrás de todos tus teléfonos, este también, y tus códigos dejarán de servir. Lo que registraste se conserva. Solo otro administrador podrá reactivarte."
                  : "Ya no podrá entrar: se cierra su sesión en todos los teléfonos y sus códigos dejan de servir. Lo que registró se conserva, y se puede reactivar después."}
              </p>
              {refusalOf("deactivate")}
              {actionForm("deactivate", "Desactivar usuario", "Desactivando…", "destructive")}
            </Part>
          )}
        </>
      ) : null}
    </div>
  );
}
