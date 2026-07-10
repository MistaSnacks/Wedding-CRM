"use client";

import { useEffect, useRef, useState, useTransition } from "react";

/** Two-click destructive button: first click arms it, second click fires. Re-disarms after 4s. */
export function ConfirmButton(props: {
  label: string;
  confirmLabel: string;
  action: () => Promise<void>;
  variant?: "subtle" | "danger";
}) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const variant = props.variant ?? "subtle";

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function handleClick() {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    startTransition(async () => {
      await props.action();
    });
  }

  const base =
    variant === "danger"
      ? "rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold transition-colors"
      : "text-[11.5px] font-medium transition-colors";
  const tone =
    variant === "danger"
      ? armed
        ? "border-rose bg-rose text-cream"
        : "border-[#e5c8bf] text-rose hover:bg-blush"
      : armed
        ? "font-semibold text-rose"
        : "text-muted hover:text-rose";

  return (
    <button type="button" onClick={handleClick} disabled={pending} className={`${base} ${tone} ${pending ? "opacity-50" : ""}`}>
      {pending ? "…" : armed ? props.confirmLabel : props.label}
    </button>
  );
}
