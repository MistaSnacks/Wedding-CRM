import type { WeddingScope } from "./scope";
import * as activity from "./activity";

export type MemberRole = "owner" | "editor" | "viewer";

export type Member = {
  userId: string;
  email: string;
  role: MemberRole;
  createdAt: string;
  /** True for the row belonging to the admin viewing the page. */
  isSelf?: boolean;
};

const ROLES: MemberRole[] = ["owner", "editor", "viewer"];
export function isRole(v: string): v is MemberRole {
  return (ROLES as string[]).includes(v);
}

/**
 * Members of a wedding, joined to their auth email.
 *
 * `wedding_members` lives in the public schema but `auth.users` is not
 * reachable through PostgREST, so email is resolved via the Auth admin API
 * (service role) and joined in memory. Fine at wedding scale (a handful of
 * admins); revisit if membership ever grows large.
 */
export async function list(scope: WeddingScope): Promise<Member[]> {
  const { data: rows, error } = await scope.db
    .from("wedding_members")
    .select("user_id, role, created_at")
    .eq("wedding_id", scope.weddingId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: userList, error: uErr } = await scope.db.auth.admin.listUsers({ perPage: 1000 });
  if (uErr) throw new Error(uErr.message);
  const emailById = new Map(userList.users.map((u) => [u.id, u.email ?? ""]));

  return (rows ?? []).map((r) => ({
    userId: r.user_id as string,
    email: emailById.get(r.user_id as string) ?? "(unknown)",
    role: r.role as MemberRole,
    createdAt: r.created_at as string,
  }));
}

async function ownerCount(scope: WeddingScope): Promise<number> {
  const { count, error } = await scope.db
    .from("wedding_members")
    .select("user_id", { count: "exact", head: true })
    .eq("wedding_id", scope.weddingId)
    .eq("role", "owner");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function roleOf(scope: WeddingScope, userId: string): Promise<MemberRole | null> {
  const { data } = await scope.db
    .from("wedding_members")
    .select("role")
    .eq("wedding_id", scope.weddingId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as MemberRole) ?? null;
}

export type InviteResult = { userId: string; created: boolean; emailed: boolean };

/**
 * Invite someone to this wedding's dashboard, idempotently.
 *
 * New address → create the auth user (Supabase sends the branded invite email,
 * routed through Resend SMTP). Existing address → skip the email and just grant
 * access. Either way the membership row is upserted, so re-inviting is safe and
 * never consumes a duplicate.
 */
export async function invite(
  scope: WeddingScope,
  args: { email: string; role: MemberRole; actorId?: string; redirectTo?: string },
): Promise<InviteResult> {
  const email = args.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("A valid email address is required.");

  let userId: string | null = null;
  let created = false;
  let emailed = false;

  const { data: invited, error: inviteErr } = await scope.db.auth.admin.inviteUserByEmail(email, {
    redirectTo: args.redirectTo,
  });

  if (!inviteErr && invited?.user) {
    userId = invited.user.id;
    created = true;
    emailed = true;
  } else {
    // Already registered (or invite blocked): find the existing user and just
    // grant access. Their sign-in path is the normal magic link at /admin/login.
    const { data: userList, error: listErr } = await scope.db.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw new Error(inviteErr?.message ?? listErr.message);
    const existing = userList.users.find((u) => u.email?.toLowerCase() === email);
    if (!existing) throw new Error(inviteErr?.message ?? `Could not invite ${email}.`);
    userId = existing.id;
  }

  const { error: memberErr } = await scope.db
    .from("wedding_members")
    .upsert(
      { wedding_id: scope.weddingId, user_id: userId, role: args.role },
      { onConflict: "user_id,wedding_id" },
    );
  if (memberErr) throw new Error(memberErr.message);

  await activity.log(scope, {
    actorType: "admin",
    actorId: args.actorId,
    action: "member.invited",
    payload: { email, role: args.role, created },
  });

  return { userId: userId!, created, emailed };
}

/** Change a member's role. Refuses to demote the last owner. */
export async function setRole(
  scope: WeddingScope,
  args: { userId: string; role: MemberRole; actorId?: string },
): Promise<void> {
  const current = await roleOf(scope, args.userId);
  if (!current) throw new Error("That person is not a member of this wedding.");
  if (current === "owner" && args.role !== "owner" && (await ownerCount(scope)) <= 1) {
    throw new Error("This wedding must keep at least one owner.");
  }

  const { error } = await scope.db
    .from("wedding_members")
    .update({ role: args.role })
    .eq("wedding_id", scope.weddingId)
    .eq("user_id", args.userId);
  if (error) throw new Error(error.message);

  await activity.log(scope, {
    actorType: "admin",
    actorId: args.actorId,
    action: "member.role_changed",
    payload: { userId: args.userId, from: current, to: args.role },
  });
}

/** Remove a member. Refuses to remove the last owner or the actor themselves. */
export async function remove(
  scope: WeddingScope,
  args: { userId: string; actorId?: string },
): Promise<void> {
  if (args.userId === args.actorId) {
    throw new Error("You can't remove your own access.");
  }
  const current = await roleOf(scope, args.userId);
  if (!current) return; // already gone — idempotent
  if (current === "owner" && (await ownerCount(scope)) <= 1) {
    throw new Error("This wedding must keep at least one owner.");
  }

  const { error } = await scope.db
    .from("wedding_members")
    .delete()
    .eq("wedding_id", scope.weddingId)
    .eq("user_id", args.userId);
  if (error) throw new Error(error.message);

  await activity.log(scope, {
    actorType: "admin",
    actorId: args.actorId,
    action: "member.removed",
    payload: { userId: args.userId, role: current },
  });
}
