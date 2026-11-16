import Link from "next/link";
import { activityLabel, actorLabel } from "@/lib/domain/activity-labels";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { GuestEditor, HouseholdTransfer } from "@/components/admin/GuestEditor";
import { forWedding } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import * as comms from "@/lib/data/comms";
import { env } from "@/lib/env";
import { CopyButton } from "@/components/admin/CopyButton";
import { ResponseCell } from "@/components/admin/ResponseCell";
import { HouseholdEditor } from "@/components/admin/HouseholdEditor";
import { AddGuestForm } from "@/components/admin/AddGuestForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { HouseholdEvents } from "@/components/admin/events/HouseholdEvents";
import type { MailingAddress } from "@/lib/csv/types";
import { formatWhen } from "@/components/admin/events/when";
import { removeGuest } from "@/app/admin/(dashboard)/guests/actions";
import * as events from "@/lib/data/events";
import type { MealOptionRow } from "@/lib/types";
import { RsvpStatusBadge } from "@/components/admin/RsvpStatusBadge";

export const dynamic = "force-dynamic";

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export default async function HouseholdDetailPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);
  const targetHouseholds = await households.list(scope);

  if (!(await households.byId(scope, householdId))) notFound();
  const detail = await households.getDetail(scope, householdId);

  const { data: meals } = await scope.db
    .from("meal_options")
    .select("id, name, is_kids_meal, sort_order, event_id, is_active, name_i18n")
    .eq("wedding_id", scope.weddingId)
    .order("sort_order");
  const commHistory = await comms.historyForHousehold(scope, householdId);

  // The invite matrix from the household's side. `detail.events` only carries
  // the ones they're already invited to, so the full list is read separately —
  // the unticked events are the whole point of the control.
  const [allEvents, invitedEventIds, wedding] = await Promise.all([
    events.list(scope),
    events.invitedEventIds(scope, householdId),
    scope.db
      .from("weddings")
      .select("timezone")
      .eq("id", scope.weddingId)
      .single(),
  ]);
  const timeZone: string = wedding.data?.timezone ?? "America/Los_Angeles";

  const rsvpUrl = `${env().NEXT_PUBLIC_APP_URL}/rsvp/h/${detail.access_token}`;
  const invitationType =
    detail.plus_one_slots > 0
      ? "May bring a plus-one"
      : detail.guests.length >= 3
        ? "Family invitation"
        : "Named guests only";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[12.5px] font-medium text-muted">
          <Link href="/admin/guests" className="hover:text-rose">
            Guests
          </Link>{" "}
          / {detail.display_name}
        </p>
        <div className="mt-3 flex items-center gap-3.5 max-md:flex-wrap max-md:gap-2">
          <h1 className="text-[22px] font-semibold text-ink">
            {detail.display_name}
          </h1>
          <RsvpStatusBadge status={detail.rsvp_status} />
          <div className="flex-1" />
          <CopyButton text={rsvpUrl} label="Copy RSVP link" />
          <CopyButton
            text={detail.invite_code}
            label={`Code: ${detail.invite_code}`}
            variant="secondary"
          />
        </div>
        <p className="mt-1 text-[13.5px] text-[#6b7167]">
          {[
            detail.email,
            detail.phone,
            invitationType,
            `Up to ${detail.max_party_size} ${detail.max_party_size === 1 ? "person" : "people"}`,
            detail.plus_one_slots > 0
              ? `${detail.plus_one_slots} plus-one${detail.plus_one_slots > 1 ? "s" : ""}`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="flex items-start gap-4 max-md:flex-col">
        <div className="flex w-full flex-[1.6] flex-col gap-3">
          <div>
            <h2 className="text-[14.5px] font-semibold text-ink">Replies</h2>
            <p className="text-[12.5px] text-muted">
              {admin.role === "viewer"
                ? "What each guest answered for each event."
                : "Did someone tell you by phone or text? Change their reply or meal here. It saves right away."}
            </p>
          </div>
          {detail.guests.map((g) => (
            <div
              key={g.id}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-hairline bg-white/75 p-4 max-md:flex-wrap max-md:gap-3"
            >
              <div className="w-[170px] flex-shrink-0 max-md:w-full">
                <p className="text-[14px] font-semibold text-ink">
                  {g.first_name} {g.last_name}
                  {g.origin === "plus_one" && (
                    <span className="ml-1.5 text-[11px] font-medium text-rose">
                      plus one
                    </span>
                  )}
                </p>
                <p className="text-[12px] text-muted">
                  {g.age_type.charAt(0).toUpperCase() + g.age_type.slice(1)}
                  {g.relationship ? ` · ${g.relationship}` : ""}
                </p>
              </div>
              {detail.events.map((e) => {
                const r = detail.responses.find(
                  (r) => r.guest_id === g.id && r.event_id === e.id,
                );
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
                {g.dietary_restrictions || g.allergies ? (
                  <span className="text-rose-deep">
                    {[g.dietary_restrictions, g.allergies]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : (
                  <span className="text-muted">No dietary notes</span>
                )}
              </div>
              {admin.role !== "viewer" && <GuestEditor guest={g} />}
              <ConfirmButton
                label="Remove"
                confirmLabel="Confirm remove?"
                action={removeGuest.bind(null, detail.id, g.id)}
              />
            </div>
          ))}

          {admin.role !== "viewer" && (
            <>
              <AddGuestForm householdId={detail.id} />
              <HouseholdTransfer
                sourceId={detail.id}
                guests={detail.guests}
                targets={targetHouseholds.map((h) => ({
                  id: h.id,
                  display_name: h.display_name,
                }))}
                operationId={crypto.randomUUID()}
              />
            </>
          )}

          <HouseholdEditor
            householdId={detail.id}
            primaryContactName={detail.primary_contact_name}
            preferredLocale={detail.preferred_locale}
            tags={detail.tags}
            displayName={detail.display_name}
            email={detail.email}
            phone={detail.phone}
            maxPartySize={detail.max_party_size}
            plusOneSlots={detail.plus_one_slots}
            internalNotes={detail.internal_notes}
            mailingAddress={
              (detail.mailing_address as MailingAddress | null) ?? null
            }
          />
        </div>

        <div className="flex w-full flex-1 flex-col gap-4">
          <HouseholdEvents
            householdId={detail.id}
            invited={invitedEventIds}
            events={allEvents.map((e) => ({
              id: e.id,
              name: e.name,
              whenLabel: formatWhen(e.starts_at, timeZone),
              rsvpEnabled: e.rsvp_enabled,
            }))}
          />

          <div className="rounded-xl border border-hairline p-5">
            <h2 className="text-[14.5px] font-semibold text-ink">Activity</h2>
            <div className="mt-2 flex flex-col">
              {detail.activity.slice(0, 12).map((a) => (
                <div key={a.id} className="flex gap-3 py-2.5">
                  <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-olive" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">
                      {activityLabel(a.action)}
                    </span>
                    <span className="block text-[12px] text-muted">
                      {[timeAgo(a.created_at), actorLabel(a.actor_type)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </div>
              ))}
              {!detail.activity.length && (
                <p className="py-3 text-[13px] text-muted">No activity yet.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-hairline p-5">
            <h2 className="text-[14.5px] font-semibold text-ink">
              Communication
            </h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {commHistory.length ? (
                commHistory.map((c, i) => {
                  const comm = (
                    c as unknown as { communications: { type: string } }
                  ).communications;
                  return (
                    <span
                      key={i}
                      className="rounded-full bg-sage-band px-2.5 py-1 text-[11px] font-semibold tracking-[0.03em] text-olive-deep uppercase whitespace-nowrap"
                    >
                      {comm.type.replace(/_/g, " ")} ·{" "}
                      {(c as { status: string }).status}
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
