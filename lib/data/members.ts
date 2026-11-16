import type { WeddingScope } from "./scope";

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

  const { data: userList, error: uErr } = await allUsers(scope);
  if (uErr) throw new Error(uErr.message);
  const emailById = new Map(userList.users.map((u) => [u.id, u.email ?? ""]));

  return (rows ?? []).map((r) => ({
    userId: r.user_id as string,
    email: emailById.get(r.user_id as string) ?? "(unknown)",
    role: r.role as MemberRole,
    createdAt: r.created_at as string,
  }));
}

export type InviteResult = {
  userId: string;
  created: boolean;
  emailed: boolean;
};

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
  args: {
    email: string;
    role: MemberRole;
    actorId?: string;
    redirectTo?: string;
  },
): Promise<InviteResult> {
  const email = args.email.trim().toLowerCase();
  if (!email.includes("@"))
    throw new Error("A valid email address is required.");

  let userId: string | null = null;
  let created = false;
  let emailed = false;

  const { data: invited, error: inviteErr } =
    await scope.db.auth.admin.inviteUserByEmail(email, {
      redirectTo: args.redirectTo,
    });

  if (!inviteErr && invited?.user) {
    userId = invited.user.id;
    created = true;
    emailed = true;
  } else {
    // Already registered (or invite blocked): find the existing user and just
    // grant access. Their sign-in path is the normal magic link at /admin/login.
    const { data: userList, error: listErr } = await allUsers(scope);
    if (listErr) throw new Error(inviteErr?.message ?? listErr.message);
    const existing = userList.users.find(
      (u) => u.email?.toLowerCase() === email,
    );
    if (!existing)
      throw new Error(inviteErr?.message ?? `Could not invite ${email}.`);
    userId = existing.id;
  }

  const { error: memberErr } = await scope.db.rpc("manage_wedding_member", {
    p_wedding_id: scope.weddingId,
    p_user_id: userId,
    p_role: args.role,
    p_actor_id: args.actorId,
    p_remove: false,
  });
  if (memberErr) throw new Error(memberErr.message);

  return { userId: userId!, created, emailed };
}

/** Change a member's role. Refuses to demote the last owner. */
export async function setRole(
  scope: WeddingScope,
  args: { userId: string; role: MemberRole; actorId?: string },
): Promise<void> {
  const { error } = await scope.db.rpc("manage_wedding_member", {
    p_wedding_id: scope.weddingId,
    p_user_id: args.userId,
    p_role: args.role,
    p_actor_id: args.actorId,
    p_remove: false,
  });
  if (error) throw new Error(error.message);
}

/** Remove a member. Refuses to remove the last owner or the actor themselves. */
export async function remove(
  scope: WeddingScope,
  args: { userId: string; actorId?: string },
): Promise<void> {
  const { error } = await scope.db.rpc("manage_wedding_member", {
    p_wedding_id: scope.weddingId,
    p_user_id: args.userId,
    p_role: null,
    p_actor_id: args.actorId,
    p_remove: true,
  });
  if (error) throw new Error(error.message);
}

async function allUsers(scope: WeddingScope) {
  const users: Array<{ id: string; email?: string }> = [];
  for (let page = 1; ; page++) {
    const result = await scope.db.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) return { data: { users }, error: result.error };
    users.push(...result.data.users);
    if (result.data.users.length < 1000)
      return { data: { users }, error: null };
  }
}
