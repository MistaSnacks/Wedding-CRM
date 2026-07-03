import Link from "next/link";
import { notFound } from "next/navigation";
import { defaultScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import * as comms from "@/lib/data/comms";
import { env } from "@/lib/env";
import { CopyButton } from "@/components/admin/CopyButton";
import { ResponseCell } from "@/components/admin/ResponseCell";
import { HouseholdEditor } from "@/components/admin/HouseholdEditor";
import type { MealOptionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  completed: "bg-sage-band text-olive-deep",
  started: "bg-[#f3edd8] text-[#7a6420]",
  declined: "bg-blush text-rose",
  pending: "bg-[#f1f0ea] text-[#6b7167]",
};

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}

export default async function HouseholdDetailPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const scope = defaultScope();

  let detail;
  try {
    detail = await households.getDetail(scope, householdId);
  } catch {
    notFound();
  }

  const { data: meals } = await scope.db
    .from("meal_options")
    .select("id, name, is_kids_meal, sort_order, event_id")
    .eq("wedding_id", scope.weddingId)
    .order("sort_order");
  const commHistory = await comms.historyForHousehold(scope, householdId);

  const rsvpUrl = `${env().NEXT_PUBLIC_APP_URL}/rsvp/h/${detail.access_token}`;
  const invitationType =
    detail.plus_one_slots > 0 ? "Plus one allowed" : detail.guests.length >= 3 ? "Family invitation" : "Named guests only";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[12.5px] font-medium text-muted">
          <Link href="/admin/guests" className="hover:text-rose">Guests</Link> / {detail.display_name}
        </p>
        <div className="mt-3 flex items-center gap-3.5">
          <h1 className="text-[22px] font-semibold text-ink">{detail.display_name}</h1>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.05em] uppercase ${STATUS_BADGE[detail.rsvp_status]}`}>
            {detail.rsvp_status}
          </span>
          <div className="flex-1" />
          <CopyButton text={rsvpUrl} label="Copy RSVP link" />
          <CopyButton text={detail.invite_code} label={`Code: ${detail.invite_code}`} variant="secondary" />
        </div>
        <p className="mt-1 text-[13.5px] text-[#6b7167]">
          {[detail.email, detail.phone, invitationType, `Max party of ${detail.max_party_size}`,
            detail.plus_one_slots > 0 ? `${detail.plus_one_slots} plus one${detail.plus_one_slots > 1 ? "s" : ""}` : "No plus ones"]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="flex items-start gap-4">
        <div className="flex flex-[1.6] flex-col gap-3">
          {detail.guests.map((g) => (
            <div key={g.id} className="flex items-center gap-4 rounded-xl border border-hairline px-4.5 p-4">
              <div className="w-[170px] flex-shrink-0">
                <p className="text-[14px] font-semibold text-ink">
                  {g.first_name} {g.last_name}
                  {g.origin === "plus_one" && <span className="ml-1.5 text-[11px] font-medium text-rose">plus one</span>}
                </p>
                <p className="text-[12px] text-muted">
                  {g.age_type.charAt(0).toUpperCase() + g.age_type.slice(1)}
                  {g.relationship ? ` · ${g.relationship}` : ""}
                </p>
              </div>
              {detail.events.map((e) => {
                const r = detail.responses.find((r) => r.guest_id === g.id && r.event_id === e.id);
                return (
                  <ResponseCell
                    key={e.id}
                    householdId={detail.id}
                    guestId={g.id}
                    eventId={e.id}
                    eventName={e.name}
                    attending={r?.attending ?? "pending"}
                    mealOptionId={r?.meal_option_id ?? null}
                    meals={(meals ?? []) as MealOptionRow[]}
                    isChild={g.age_type !== "adult"}
                  />
                );
              })}
              <div className="min-w-0 flex-1 text-[12.5px] text-[#4a5147]">
                {(g.dietary_restrictions || g.allergies) ? (
                  <span className="text-rose-deep">{[g.dietary_restrictions, g.allergies].filter(Boolean).join(" · ")}</span>
                ) : (
                  <span className="text-muted">No dietary notes</span>
                )}
              </div>
            </div>
          ))}

          <HouseholdEditor
            householdId={detail.id}
            displayName={detail.display_name}
            email={detail.email}
            phone={detail.phone}
            maxPartySize={detail.max_party_size}
            plusOneSlots={detail.plus_one_slots}
            internalNotes={detail.internal_notes}
          />
        </div>

        <div className="flex flex-1 flex-col gap-4">
          <div className="rounded-xl border border-hairline p-5">
            <h2 className="text-[14.5px] font-semibold text-ink">Activity</h2>
            <div className="mt-2 flex flex-col">
              {detail.activity.slice(0, 12).map((a) => (
                <div key={a.id} className="flex gap-3 py-2.5">
                  <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-olive" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{a.action.replace(/\./g, " ")}</span>
                    <span className="block text-[12px] text-muted">
                      {timeAgo(a.created_at)} · by {a.actor_type}
                    </span>
                  </span>
                </div>
              ))}
              {!detail.activity.length && <p className="py-3 text-[13px] text-muted">No activity yet.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-hairline p-5">
            <h2 className="text-[14.5px] font-semibold text-ink">Communication</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {commHistory.length ? (
                commHistory.map((c, i) => {
                  const comm = (c as unknown as { communications: { type: string } }).communications;
                  return (
                    <span key={i} className="rounded-full bg-sage-band px-2.5 py-1 text-[11px] font-semibold tracking-[0.03em] text-olive-deep uppercase whitespace-nowrap">
                      {comm.type.replace(/_/g, " ")} · {(c as { status: string }).status}
                    </span>
                  );
                })
              ) : (
                <p className="text-[13px] text-muted">Nothing sent yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
