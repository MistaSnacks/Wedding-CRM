import { adminDb } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every data-layer module exports functions that take a WeddingScope.
 * Nothing in the app can query domain tables without one — this is the
 * tenancy guarantee (RLS is the backstop).
 */
export type WeddingScope = { weddingId: string; db: SupabaseClient };

export function forWedding(weddingId: string): WeddingScope {
  if (!weddingId) throw new Error("weddingId required");
  return { weddingId, db: adminDb() };
}

/** The single wedding in v1. SaaS later resolves this per-tenant. */
export const DEFAULT_WEDDING_ID = "11111111-1111-1111-1111-111111111111";

export function defaultScope(): WeddingScope {
  return forWedding(DEFAULT_WEDDING_ID);
}

export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error("not found");
  return res.data;
}
