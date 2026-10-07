import type { ReactNode } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";

import { type Tone, ToneDrawing } from "./icons";

interface Props {
  /** `error` is read out at once (`role="alert"`); the others when the reader is free. */
  readonly tone: Tone;
  /** For the field an error is about: its `aria-describedby`. */
  readonly id?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * How the app says what happened: a recorded form's notice, a refusal, a
 * thing to know before going on. A shadcn `Alert` with the role its tone
 * needs.
 *
 *     {error ? <Notice tone="error" id="code-error">{error}</Notice> : null}
 *     {said?.message ? <Notice tone="success">{said.message}</Notice> : null}
 *
 * Its tone is told by the drawing as well as the color, and it stays until
 * the screen replaces it: nothing here disappears by itself.
 */
export function Notice({ tone, id, className, children }: Props) {
  return (
    <Alert
      id={id}
      role={tone === "error" ? "alert" : "status"}
      variant={tone === "error" ? "destructive" : "default"}
      className={className}
    >
      <ToneDrawing tone={tone} />
      <AlertDescription className={tone === "error" ? "font-medium" : "text-foreground"}>{children}</AlertDescription>
    </Alert>
  );
}
