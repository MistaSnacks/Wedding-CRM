"use client";

import { useActionState, useState, useTransition } from "react";
import type { Member, MemberRole } from "@/lib/data/members";
import {
  inviteMember,
  changeMemberRole,
  removeMember,
  type ActionResult,
} from "@/app/admin/(dashboard)/team/actions";

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer (read-only)",
};

const inputCls =
  "rounded-lg border border-[#dddbd0] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-olive";

export function TeamManager({ members, ownerCount }: { members: Member[]; ownerCount: number }) {
  const [inviteState, inviteAction, invitePending] = useActionState<ActionResult | null, FormData>(
    inviteMember,
    null,
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Invite */}
      <form action={inviteAction} className="flex flex-col gap-3 rounded-xl border border-hairline p-5">
        <h2 className="text-[14.5px] font-semibold text-ink">Invite someone</h2>
        <div className="flex gap-2">
          <input
            name="email"
            type="email"
            required
            placeholder="name@example.com"
            className={`flex-1 ${inputCls}`}
          />
          <select name="role" defaultValue="editor" className={inputCls}>
            <option value="owner">Owner</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer (read-only)</option>
          </select>
          <button
            disabled={invitePending}
            className="rounded-lg bg-olive-deep px-5 py-2.5 text-[13.5px] font-semibold text-cream transition-all duration-200 hover:-translate-y-px hover:bg-rose hover:shadow-[0_8px_18px_rgba(177,117,101,0.35)] active:scale-[0.97] disabled:opacity-50 motion-reduce:transition-none"
          >
            {invitePending ? "Sending…" : "Send invite"}
          </button>
        </div>
        <p className="text-[12px] text-muted">
          They&apos;ll get a branded sign-in email — no password. Re-inviting an existing member just updates their role.
        </p>
        {inviteState && (
          <p className={`text-[12.5px] font-medium ${inviteState.ok ? "text-olive-deep" : "text-rose"}`}>
            {inviteState.ok ? inviteState.message : inviteState.error}
          </p>
        )}
      </form>

      {/* Members */}
      <div className="rounded-xl border border-hairline p-5">
        <h2 className="text-[14.5px] font-semibold text-ink">Members</h2>
        <div className="mt-2 flex flex-col">
          {members.map((m) => (
            <MemberRow key={m.userId} member={m} ownerCount={ownerCount} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MemberRow({ member, ownerCount }: { member: Member; ownerCount: number }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The last owner can't be demoted or removed; you can't remove yourself.
  const isLastOwner = member.role === "owner" && ownerCount <= 1;
  const canRemove = !member.isSelf && !isLastOwner;

  function onRoleChange(role: string) {
    if (role === member.role) return;
    setError(null);
    const fd = new FormData();
    fd.set("userId", member.userId);
    fd.set("role", role);
    startTransition(async () => {
      const res = await changeMemberRole(null, fd);
      if (!res.ok) setError(res.error);
    });
  }

  function onRemove() {
    setError(null);
    const fd = new FormData();
    fd.set("userId", member.userId);
    startTransition(async () => {
      const res = await removeMember(null, fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex items-center gap-4 border-t border-[#f1f0ea] py-3 first:border-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13.5px] font-medium text-ink">
          {member.email}
          {member.isSelf && <span className="ml-2 text-[11px] font-normal text-muted">you</span>}
        </span>
        {error && <span className="text-[11.5px] font-medium text-rose">{error}</span>}
      </div>

      <select
        defaultValue={member.role}
        disabled={pending || isLastOwner}
        onChange={(e) => onRoleChange(e.target.value)}
        title={isLastOwner ? "A wedding must keep at least one owner." : undefined}
        className="rounded-lg border border-[#dddbd0] bg-white px-3 py-2 text-[13px] disabled:opacity-60"
      >
        {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>

      <div className="w-24 text-right">
        {canRemove ? (
          <RemoveButton pending={pending} onRemove={onRemove} />
        ) : (
          <span className="text-[11.5px] text-muted">{isLastOwner ? "last owner" : "—"}</span>
        )}
      </div>
    </div>
  );
}

/** Two-click remove so a single misclick can't revoke access. */
function RemoveButton({ pending, onRemove }: { pending: boolean; onRemove: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          setTimeout(() => setArmed(false), 4000);
        } else {
          setArmed(false);
          onRemove();
        }
      }}
      className={`text-[12px] font-medium transition-colors disabled:opacity-50 ${
        armed ? "font-semibold text-rose" : "text-muted hover:text-rose"
      }`}
    >
      {pending ? "…" : armed ? "Confirm?" : "Remove"}
    </button>
  );
}
