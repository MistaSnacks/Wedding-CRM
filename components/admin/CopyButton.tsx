"use client";

import { useState } from "react";

export function CopyButton({
  text,
  label,
  variant = "primary",
}: {
  text: string;
  label: string;
  variant?: "primary" | "secondary";
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={`rounded-lg px-4 py-2.5 text-[13.5px] font-semibold transition-all duration-200 hover:-translate-y-px active:scale-[0.97] motion-reduce:transition-none ${
        variant === "primary"
          ? "bg-olive-deep text-cream hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)]"
          : "border border-[#dddbd0] bg-white font-medium text-ink hover:border-rose hover:text-rose"
      }`}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
