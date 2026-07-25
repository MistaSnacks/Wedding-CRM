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

/**
 * Write gate for server actions. Viewers are read-only.
 *
 * The admin surface queries through the service-role client, which bypasses
 * RLS — so the `is_wedding_editor` policies never fire here and this check is
 * the only thing enforcing the role. Every mutating action must call it.
 *
 * Throws rather than redirects: an action reaching this with a viewer means
 * either a UI bug or a hand-crafted POST, and both should fail loudly.
 */
export async function requireEditor(): Promise<AdminContext> {
  const admin = await requireAdmin();
  if (admin.role === "viewer") {
    throw new Error("Forbidden: your access is read-only.");
  }
  return admin;
}

/** Owner-only write gate (member management). Throws — see requireEditor. */
export async function requireOwner(): Promise<AdminContext> {
  const admin = await requireAdmin();
  if (admin.role !== "owner") {
    throw new Error("Forbidden: only an owner can manage team members.");
  }
  return admin;
}

/** Owner-only gate for pages, which want a redirect rather than an error page. */
export async function requireOwnerPage(): Promise<AdminContext> {
  const admin = await requireAdmin();
  if (admin.role !== "owner") redirect("/admin?error=owner_only");
  return admin;
}

/** Editor-or-owner gate for pages, which want a redirect rather than an error page. */
export async function requireEditorPage(): Promise<AdminContext> {
  const admin = await requireAdmin();
  if (admin.role === "viewer") redirect("/admin?error=editor_only");
  return admin;
}
