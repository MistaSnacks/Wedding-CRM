import type { AgeType } from "@/lib/types";

/** Trim, collapse internal whitespace, lowercase. Used for all comparison keys. */
export function norm(s: string | undefined | null): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Trimmed display value, or undefined when empty. */
export function cleanValue(s: string | undefined | null): string | undefined {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : undefined;
}

export function normalizeAge(v: string | undefined): AgeType {
  const s = norm(v);
  if (s.startsWith("child") || s === "kid" || s === "niño") return "child";
  if (s.startsWith("infant") || s === "baby" || s === "bebé") return "infant";
  return "adult";
}
