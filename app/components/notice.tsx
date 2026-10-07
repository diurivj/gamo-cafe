import type { ReactNode } from "react";

import { type Tone, ToneDrawing } from "./icons";

const tones: Readonly<Record<Tone, string>> = {
  success: "font-semibold",
  error: "font-semibold text-danger",
  info: "",
};

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
 * thing to know before going on.
 *
 *     {error ? <Notice tone="error" id="code-error">{error}</Notice> : null}
 *     {said?.message ? <Notice tone="success">{said.message}</Notice> : null}
 *
 * Its tone is told by the drawing as well as the color, and it stays until
 * the screen replaces it: nothing here disappears by itself.
 */
export function Notice({ tone, id, className = "", children }: Props) {
  return (
    <div className={`flex items-start gap-2 ${tones[tone]} ${className}`}>
      <ToneDrawing tone={tone} />
      <p id={id} role={tone === "error" ? "alert" : "status"} className="min-w-0 flex-1">
        {children}
      </p>
    </div>
  );
}
