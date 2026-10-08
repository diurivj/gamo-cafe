import { useEffect } from "react";

import { Notice } from "./notice";

/** What a form was refused for, as its action answered it (`refused` in `~/catalog-forms.server`). */
export interface FormRefusal {
  readonly error: string;
  /** Which form of the page was refused. */
  readonly form: string;
  /** The field the refusal is about: its `name`, which is also its `id`. */
  readonly field: string | null;
}

/**
 * What a refusal adds to the field it is about, so the field says it is wrong
 * and is described by the refusal's words as well as by its own hint:
 *
 *     <Input id="price" name="price" {...refusedField(refusal, "price", "price-hint")} />
 *     <FieldError refusal={refusal} field="price" />
 */
export function refusedField(refusal: FormRefusal | undefined, field: string, hintId?: string) {
  const about = refusal?.field === field;
  return {
    "aria-invalid": about ? true : undefined,
    "aria-describedby": [hintId, about ? `${field}-error` : undefined].filter(Boolean).join(" ") || undefined,
  } as const;
}

/** The refusal, under the field it is about. */
export function FieldError({ refusal, field }: { readonly refusal: FormRefusal | undefined; readonly field: string }) {
  return refusal?.field === field ? (
    <Notice tone="error" id={`${field}-error`}>
      {refusal.error}
    </Notice>
  ) : null;
}

/** A refusal that is about no field, over the form's action. */
export function FormError({ refusal }: { readonly refusal: FormRefusal | undefined }) {
  return refusal && refusal.field === null ? <Notice tone="error">{refusal.error}</Notice> : null;
}

/** Takes the keyboard to the field a refusal is about, once per refusal. */
export function useFocusOnRefusal(refusal: FormRefusal | undefined) {
  useEffect(() => {
    if (refusal?.field) document.getElementById(refusal.field)?.focus();
  }, [refusal]);
}
