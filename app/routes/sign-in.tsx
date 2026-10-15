import { useEffect, useRef } from "react";
import { data, Form, redirect } from "react-router";

import { run } from "~/backend/run.server";
import { useSignInCode } from "~/backend/sign-in";
import { Monogram, Wordmark } from "~/components/brand";
import { Notice } from "~/components/notice";
import { hint } from "~/components/styles";
import { buttonClasses } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { SubmitButton } from "~/components/submit-button";
import { clearedSessionCookie, HOME_PATH, optionalUser, sessionCookie, sessionToken } from "~/session.server";

import type { Route } from "./+types/sign-in";

export const meta: Route.MetaFunction = () => [{ title: "Entrar · Gamo Cafe" }];

export function loader({ context, request }: Route.LoaderArgs) {
  if (optionalUser(context)) throw redirect(HOME_PATH);
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
  throw redirect(HOME_PATH, { headers: { "Set-Cookie": sessionCookie(result.token) } });
}

export default function SignIn({ loaderData, actionData }: Route.ComponentProps) {
  const field = useRef<HTMLInputElement>(null);
  // A refused code puts the User back on the field it is about.
  useEffect(() => {
    if (actionData?.error) field.current?.focus();
  }, [actionData]);

  return (
    <main className="relative isolate flex min-h-dvh w-full flex-col justify-center px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      {/* The light of the counter, warm over the paper: only a drawing. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem] bg-[radial-gradient(60rem_22rem_at_50%_-6rem,rgb(214_150_96/0.22),transparent_70%)]"
      />
      <div className="mx-auto flex w-full max-w-md animate-enter flex-col">
        <div className="flex items-center gap-3">
          <Monogram />
          <Wordmark />
        </div>
        <h1 className="mt-10 font-display text-[3.25rem] leading-none tracking-[-0.015em] wrap-break-word">Entrar</h1>

        {loaderData.sessionEnded ? (
          <Notice tone="info" className="mt-6">
            Tu sesión terminó. Entra con un código nuevo.
          </Notice>
        ) : null}

        <Card className="mt-7">
          <CardContent>
            {/* A long word breaks rather than be cut by the card, with text twice as large on a narrow phone. */}
            <Form method="post" className="flex flex-col gap-3 wrap-anywhere">
              <Label htmlFor="code">Código de acceso</Label>
              <p id="code-help" className={hint}>
                Pídeselo a un administrador. Sirve una sola vez y dura 10 minutos.
              </p>
              <Input
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
                className="mt-1 h-16 text-center text-[1.75rem] font-semibold tracking-[0.3em] uppercase figures"
              />
              {actionData?.error ? (
                <Notice tone="error" id="code-error">
                  {actionData.error}
                </Notice>
              ) : null}
              <SubmitButton pendingLabel="Entrando…" className={buttonClasses({ size: "touch", className: "mt-2 w-full" })}>
                Entrar
              </SubmitButton>
            </Form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
