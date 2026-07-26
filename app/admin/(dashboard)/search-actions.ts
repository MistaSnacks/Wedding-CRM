"use server";

import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as households from "@/lib/data/households";

export type DirectoryEntry = {
  id: string;
  display_name: string;
  guests: Array<{ first_name: string; last_name: string }>;
  email: string | null;
  phone: string | null;
  rsvp_status: string;
};

/** Everything the header search needs, fetched once per page load on first focus. */
export async function fetchDirectory(): Promise<DirectoryEntry[]> {
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);
  const rows = await households.list(scope);
  return rows.map((h) => ({
    id: h.id,
    display_name: h.display_name,
    guests: h.guests.map((g) => ({ first_name: g.first_name, last_name: g.last_name })),
    email: h.email,
    phone: h.phone,
    rsvp_status: h.rsvp_status,
  }));
}
