"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireOwner } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import { env } from "@/lib/env";
import * as members from "@/lib/data/members";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * `requireOwner()` sits outside every try below, so an expired session already
 * redirects rather than being swallowed. The catch-alls still open with
 * `unstable_rethrow`: Next signals `redirect()` and `notFound()` by throwing,
 * and a catch-all that turns anything thrown into a string will render the
 * sentinel `NEXT_REDIRECT` at the user the first time one drifts inside.
 */

export async function inviteMember(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireOwner();
  const scope = forWedding(admin.weddingId);

  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "editor");
  if (!members.isRole(role)) return { ok: false, error: "Pick a valid role." };
  if (!email.includes("@")) return { ok: false, error: "Enter a valid email address." };

  try {
    const res = await members.invite(scope, {
      email,
      role,
      actorId: admin.userId,
      redirectTo: `${env().NEXT_PUBLIC_APP_URL}/admin/auth/callback`,
    });
    revalidatePath("/admin/team");
    return {
      ok: true,
      message: res.emailed
        ? `Invitation sent to ${email} as ${role}.`
        : `${email} already had an account — granted ${role} access. They sign in at /admin/login.`,
    };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : "Invite failed." };
  }
}

export async function changeMemberRole(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireOwner();
  const scope = forWedding(admin.weddingId);
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!members.isRole(role)) return { ok: false, error: "Pick a valid role." };

  try {
    await members.setRole(scope, { userId, role, actorId: admin.userId });
    revalidatePath("/admin/team");
    return { ok: true, message: "Role updated." };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : "Update failed." };
  }
}

export async function removeMember(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireOwner();
  const scope = forWedding(admin.weddingId);
  const userId = String(formData.get("userId") ?? "");

  try {
    await members.remove(scope, { userId, actorId: admin.userId });
    revalidatePath("/admin/team");
    return { ok: true, message: "Access removed." };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : "Remove failed." };
  }
}
