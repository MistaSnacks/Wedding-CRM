import { requireOwnerPage } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as members from "@/lib/data/members";
import { TeamManager } from "@/components/admin/TeamManager";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const admin = await requireOwnerPage();
  const scope = forWedding(admin.weddingId);
  const list = await members.list(scope);
  const ownerCount = list.filter((m) => m.role === "owner").length;

  const rows = list.map((m) => ({ ...m, isSelf: m.userId === admin.userId }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-semibold text-ink">Team</h1>
        <p className="mt-0.5 text-[13.5px] text-[#6b7167]">
          Who can access this wedding&apos;s dashboard. Owners manage the team; editors can change guests, RSVPs,
          seating, and send email; viewers can only look.
        </p>
      </div>
      <TeamManager members={rows} ownerCount={ownerCount} />
    </div>
  );
}
