"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { GuestActionResult } from "@/app/admin/(dashboard)/guests/actions";
/** Retains ordinary form values after a recoverable server error. */
export function GuestMutationForm({
  action,
  children,
  className,
}: {
  action: (
    state: GuestActionResult | null,
    data: FormData,
  ) => Promise<GuestActionResult>;
  children: ReactNode;
  className?: string;
}) {
  const [result, formAction, pending] = useActionState(action, null);
  const form = useRef<HTMLFormElement>(null);
  const draft = useRef<FormData | null>(null);
  useEffect(() => {
    if (!result?.ok && draft.current && form.current) {
      for (const [name, value] of draft.current) {
        const field = form.current.elements.namedItem(name);
        if (
          field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement ||
          field instanceof HTMLSelectElement
        ) {
          if (
            field instanceof HTMLInputElement &&
            (field.type === "checkbox" || field.type === "radio")
          )
            field.checked = draft.current.getAll(name).includes(field.value);
          else field.value = String(value);
        }
      }
    }
  }, [result]);
  return (
    <form
      ref={form}
      action={formAction}
      onSubmit={() => {
        if (form.current) draft.current = new FormData(form.current);
      }}
      className={className}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {result && (
        <p
          role="status"
          className={result.ok ? "text-sm text-olive" : "text-sm text-rose"}
        >
          {result.message}
        </p>
      )}
      {pending && (
        <p role="status" className="text-sm">
          Saving…
        </p>
      )}
    </form>
  );
}
