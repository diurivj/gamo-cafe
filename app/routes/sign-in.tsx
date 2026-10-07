import { useEffect, useRef } from "react";
import { data, Form, redirect } from "react-router";

import { run } from "~/backend/run.server";
import { useSignInCode } from "~/backend/sign-in";
import { Notice } from "~/components/notice";
import { fieldLabel, hint, pageTitle, primaryButton, textField } from "~/components/styles";
import { SubmitButton } from "~/components/submit-button";
import { clearedSessionCookie, optionalUser, sessionCookie, sessionToken } from "~/session.server";

import type { Route } from "./+types/sign-in";

export const meta: Route.MetaFunction = () => [{ title: "Entrar · Gamo Cafe" }];

export function loader({ context, request }: Route.LoaderArgs) {
  if (optionalUser(context)) throw redirect("/");
  // A phone that still carries a session's cookie had a session, and it
  // ended: 60 days without use, or an Admin signed the User out. It is told
  // once: the answer that says so clears the cookie. Salir clears it too, so a
  // User who left by themselves is not told this.
  if (sessionToken(request) === undefined) return { sessionEnded: false };
  return data({ sessionEnded: true }, { headers: { "Set-Cookie": clearedSessionCookie } });
}

// A document answers with its loader's headers only when the route says so.
export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export async function action({ context, request }: Route.ActionArgs) {
  const form = await request.formData();
  const code = String(form.get("code") ?? "");

  // Not a React hook: the operation that trades a code for a session.
  const result = await run(context, useSignInCode(code), (error) => {
    switch (error._tag) {
      case "SignInCodeRejected":
        return { error: "Ese código no es válido o ya venció. Pide uno nuevo." };
      case "TooManySignInFailures":
        return { error: "Demasiados intentos. Espera 10 minutos y pide un código nuevo." };
    }
  });

  // What was typed goes back with the refusal, to be corrected, not retyped.
  if ("error" in result) return data({ ...result, code }, { status: 400 });
  throw redirect("/", { headers: { "Set-Cookie": sessionCookie(result.token) } });
}

export default function SignIn({ loaderData, actionData }: Route.ComponentProps) {
  const field = useRef<HTMLInputElement>(null);
  // A refused code puts the User back on the field it is about.
  useEffect(() => {
    if (actionData?.error) field.current?.focus();
  }, [actionData]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <p className="font-bold">Gamo Cafe</p>
      <h1 className={`mt-1 ${pageTitle}`}>Entrar</h1>

      {loaderData.sessionEnded ? (
        <Notice tone="info" className="mt-6">
          Tu sesión terminó. Entra con un código nuevo.
        </Notice>
      ) : null}

      <Form method="post" className="mt-8 flex flex-col gap-3">
        <label htmlFor="code" className={fieldLabel}>
          Código de acceso
        </label>
        <p id="code-help" className={hint}>
          Pídeselo a un administrador. Sirve una sola vez y dura 10 minutos.
        </p>
        <input
          ref={field}
          id="code"
          name="code"
          required
          autoFocus
          defaultValue={actionData?.code}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-describedby={actionData?.error ? "code-help code-error" : "code-help"}
          aria-invalid={actionData?.error ? true : undefined}
          className={`${textField} text-center font-mono text-2xl tracking-widest uppercase`}
        />
        {actionData?.error ? (
          <Notice tone="error" id="code-error">
            {actionData.error}
          </Notice>
        ) : null}
        <SubmitButton pendingLabel="Entrando…" className={`mt-2 ${primaryButton}`}>
          Entrar
        </SubmitButton>
      </Form>
    </main>
  );
}
