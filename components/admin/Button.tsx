import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "topbar" | "secondary";

/**
 * Hover rules (spec §9.5): primary buttons bloom to rose on hover —
 * EXCEPT inside the blush top bar, where they deepen olive instead
 * (never pink-on-pink). Both lift −1px; pressed scales 0.97.
 */
const styles: Record<Variant, string> = {
  primary:
    "bg-olive-deep text-cream hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)]",
  topbar: "bg-olive-deep text-cream hover:bg-olive-deeper hover:shadow-[0_6px_14px_rgba(42,53,23,0.3)]",
  secondary:
    "border border-[#dddbd0] bg-white text-ink hover:border-rose hover:text-rose",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2.5 text-[13.5px] font-semibold transition-all duration-200 hover:-translate-y-px active:scale-[0.97] disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${styles[variant]} ${className}`}
    />
  );
}
