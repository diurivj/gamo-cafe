import { data, Form, redirect } from "react-router";

import { run } from "~/backend/run.server";
import { useSignInCode } from "~/backend/sign-in";
import { optionalUser, sessionCookie } from "~/session.server";
import { SubmitButton } from "~/components/submit-button";

import type { Route } from "./+types/sign-in";

export const meta: Route.MetaFunction = () => [{ title: "Entrar · Gamo Cafe" }];

export function loader({ context }: Route.LoaderArgs) {
  if (optionalUser(context)) throw redirect("/");
  return null;
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

  if ("error" in result) return data(result, { status: 400 });
  throw redirect("/", { headers: { "Set-Cookie": sessionCookie(result.token) } });
}

export default function SignIn({ actionData }: Route.ComponentProps) {

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6">
      <p className="text-lg text-stone-600">Gamo Cafe</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Entrar</h1>

      <Form method="post" className="mt-8 flex flex-col gap-4">
        <label htmlFor="code" className="text-lg font-medium">
          Código de acceso
        </label>
        <input
          id="code"
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ABCD 2345"
          aria-describedby={actionData?.error ? "code-error" : "code-help"}
          aria-invalid={actionData?.error ? true : undefined}
          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-4 text-center font-mono text-2xl uppercase tracking-widest placeholder:text-stone-300"
        />
        {actionData?.error ? (
          <p id="code-error" role="alert" className="text-red-700">
            {actionData.error}
          </p>
        ) : (
          <p id="code-help" className="text-stone-600">
            Pídele tu código a un administrador. Sirve una sola vez y dura 10 minutos.
          </p>
        )}
        <SubmitButton
          pendingLabel="Entrando…"
          className="rounded-xl bg-stone-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-60"
        >
          Entrar
        </SubmitButton>
      </Form>
    </main>
  );
}
