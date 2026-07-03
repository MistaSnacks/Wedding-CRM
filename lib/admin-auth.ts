import { redirect } from "next/navigation";
import { serverClient } from "@/lib/supabase/server";
import { adminDb } from "@/lib/supabase/admin";

export type AdminContext = {
  userId: string;
  email: string;
  weddingId: string;
  role: "owner" | "editor" | "viewer";
};

/** Resolve the signed-in admin + their wedding membership, or redirect. */
export async function requireAdmin(): Promise<AdminContext> {
  const supabase = await serverClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: membership } = await adminDb()
    .from("wedding_members")
    .select("wedding_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/admin/login?error=no_access");

  return {
    userId: user.id,
    email: user.email ?? "",
    weddingId: membership.wedding_id,
    role: membership.role,
  };
}
