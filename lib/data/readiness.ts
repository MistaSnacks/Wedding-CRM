import { eligibleMeals, expectedRsvpStatus } from "@/lib/domain/rsvp-validation";
import type { WeddingScope } from "./scope";
import { loadReportData, type ReportData } from "@/lib/reports/guest-reports";
import { readAll } from "./query";
import { calendarDayIn, formatCalendarDate } from "@/lib/format/wedding-date";
export type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  kind:
    | "contact"
    | "rsvp"
    | "meal"
    | "seating"
    | "payment"
    | "review"
    | "delivery"
    | "health";
  priority: "high" | "normal";
  /** The household or guest the item is about, for grouped lists. */
  subject?: string;
  /** The event the item belongs to, when it has one. */
  event?: string;
  /** How many guests the item covers (replies still needed). */
  count?: number;
};

export function guestReadiness(data: ReportData): AttentionItem[] {
  const items: AttentionItem[] = [];
  const responses = new Map(
    data.responses.map((r) => [`${r.guest_id}:${r.event_id}`, r]),
  );
  const seats = new Map(
    data.seats.map((s) => [`${s.guest_id}:${s.event_id}`, s]),
  );
  const invitations = new Set(
    data.invites.map((i) => `${i.household_id}:${i.event_id}`),
  );
  const liveGuests = new Set(
    data.hhs.flatMap((h) => h.guests.map((g) => g.id)),
  );
  // Shared addresses and family names can be intentional: surface for review only.
  for (const field of ["email", "display_name"] as const) {
    const groups = new Map<string, typeof data.hhs>();
    for (const h of data.hhs) {
      const key = h[field]?.trim().replace(/\s+/g, " ").toLocaleLowerCase();
      if (key) groups.set(key, [...(groups.get(key) ?? []), h]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a,b) => a.id.localeCompare(b.id));
      items.push({
        id: `duplicate:${field}:${sorted[0].id}`,
        title: `Review households sharing ${field === "email" ? "an email" : "a name"}`,
        detail: `${sorted.map(h => h.display_name).join(", ")}. Confirm these are separate invitations before merging anything.`,
        href: `/admin/guests?q=${encodeURIComponent(sorted[0][field] ?? "")}`,
        kind: "health", priority: "normal",
      });
    }
  }
  for (const h of data.hhs) {
    const href = `/admin/guests/${h.id}`;
    const canonicalStatus = expectedRsvpStatus(
      h.guests, data.events.filter(e => invitations.has(`${h.id}:${e.id}`)),
      data.responses, data.meals,
    );
    if (h.rsvp_status !== canonicalStatus) items.push({
      id: `status:${h.id}`, title: `Review RSVP status: ${h.display_name}`,
      detail: `Saved status is ${h.rsvp_status}; current invited replies and meals imply ${canonicalStatus}. Review the household and database migration health.`,
      href, kind: "health", priority: "high",
    });
    if (!h.email)
      items.push({
        id: `email:${h.id}`,
        title: `Add an email for ${h.display_name}`,
        detail:
          "This household cannot receive invitations or reminders by email.",
        href,
        kind: "contact",
        priority: "normal",
        subject: h.display_name,
      });
    if (
      !h.mailing_address ||
      !Object.entries(h.mailing_address).some(
        ([k, v]) => k !== "source" && Boolean(v?.trim()),
      )
    )
      items.push({
        id: `address:${h.id}`,
        title: `Add a mailing address for ${h.display_name}`,
        detail: "Needed before preparing envelopes.",
        href,
        kind: "contact",
        priority: "normal",
        subject: h.display_name,
      });
    for (const e of data.events.filter((e) =>
      invitations.has(`${h.id}:${e.id}`),
    )) {
      const pending = h.guests.filter(
        (g) =>
          !responses.get(`${g.id}:${e.id}`) ||
          responses.get(`${g.id}:${e.id}`)?.attending === "pending",
      );
      if (e.rsvp_enabled && pending.length)
        items.push({
          id: `rsvp:${h.id}:${e.id}`,
          title: `${h.display_name}: ${pending.length} ${pending.length === 1 ? "reply" : "replies"} needed`,
          detail: e.name,
          href,
          kind: "rsvp",
          priority: "normal",
          subject: h.display_name,
          event: e.name,
          count: pending.length,
        });
      for (const g of h.guests) {
        const r = responses.get(`${g.id}:${e.id}`);
        if (r?.attending !== "yes") continue;
        const options = eligibleMeals(data.meals, e.id, g.age_type);
        const meal = options.find((m) => m.id === r.meal_option_id);
        if (e.rsvp_enabled && !meal && options.length > 0)
          items.push({
            id: `meal:${g.id}:${e.id}`,
            title: `Meal needed for ${g.first_name} ${g.last_name}`,
            detail: e.name,
            href,
            kind: "meal",
            priority: "high",
            subject: `${g.first_name} ${g.last_name}`.trim(),
            event: e.name,
          });
        if (!seats.has(`${g.id}:${e.id}`))
          items.push({
            id: `seat:${g.id}:${e.id}`,
            title: `Seat needed for ${g.first_name} ${g.last_name}`,
            detail: e.name,
            href: `/admin/seating?event=${e.id}`,
            kind: "seating",
            priority: "normal",
            subject: `${g.first_name} ${g.last_name}`.trim(),
            event: e.name,
          });
      }
    }
    const plus = h.guests.filter((g) => g.origin === "plus_one").length;
    if (h.guests.length > h.max_party_size || plus > h.plus_one_slots)
      items.push({
        id: `party:${h.id}`,
        title: `Invitation limits need review: ${h.display_name}`,
        detail: "Existing guests exceed the saved invitation limits.",
        href,
        kind: "health",
        priority: "high",
      });
  }
  for (const table of data.tables) {
    const assigned = data.seats.filter((s) => s.table_id === table.id);
    const stale = assigned.filter(
      (s) =>
        !liveGuests.has(s.guest_id) ||
        !data.responses.some(
          (r) =>
            r.guest_id === s.guest_id &&
            r.event_id === table.event_id &&
            r.attending === "yes",
        ),
    );
    if (assigned.length > table.capacity || stale.length)
      items.push({
        id: `table:${table.id}`,
        title: `Review ${table.name}`,
        detail: `${assigned.length}/${table.capacity} seats occupied; ${stale.length} no longer attending.`,
        href: `/admin/seating?event=${table.event_id}`,
        kind: "seating",
        priority: "high",
      });
  }
  return items;
}

/** Derived tasks disappear automatically as the underlying facts are repaired. */
export async function listReadiness(
  scope: WeddingScope,
): Promise<AttentionItem[]> {
  const [data, payments, outbox, submissions, wedding, sync, owners, automation] =
    await Promise.all([
      loadReportData(scope),
      readAll<{
        id: string;
        label: string;
        amount_cents: number;
        currency: string;
        due_date: string | null;
        paid_at: string | null;
        // Many-to-one: one object at run time, typed as a list by the client.
        budget_items: { name: string } | { name: string }[] | null;
      }>(() =>
        scope.db
          .from("budget_payments")
          .select("id,label,amount_cents,currency,due_date,paid_at,budget_items(name)")
          .eq("wedding_id", scope.weddingId)
          .is("paid_at", null)
          .order("id"),
      ),
      readAll<{
        id: string;
        household_id: string | null;
        last_error: string | null;
      }>(() =>
        scope.db
          .from("email_outbox")
          .select("id,household_id,last_error")
          .eq("wedding_id", scope.weddingId)
          .eq("state", "failed")
          .is("resolved_at", null)
          .order("id"),
      ),
      scope.db
        .from("sheet_submissions")
        .select("id", { count: "exact", head: true })
        .eq("wedding_id", scope.weddingId)
        .eq("status", "pending"),
      scope.db
        .from("weddings")
        .select("timezone")
        .eq("id", scope.weddingId)
        .single(),
      scope.db
        .from("sync_runs")
        .select("state,started_at,finished_at")
        .eq("wedding_id", scope.weddingId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      scope.db.from("wedding_members").select("user_id", { count: "exact", head: true })
        .eq("wedding_id", scope.weddingId).eq("role", "owner"),
      scope.db.from("automation_runs").select("state,started_at,finished_at")
        .eq("wedding_id", scope.weddingId).order("started_at", { ascending: false })
        .limit(1).maybeSingle(),
    ]);
  for (const result of [submissions, wedding, sync, owners, automation])
    if (result.error) throw new Error(result.error.message);
  const result = guestReadiness(data);
  if (owners.count === 0) result.push({
    id: "owner-health", title: "Restore a wedding owner",
    detail: "No owner is assigned. An operator must restore an authorized owner before access can be managed.",
    href: "/admin/settings", kind: "health", priority: "high",
  });
  const automationWarning = automationReadiness(automation.data);
  if (automationWarning) result.push(automationWarning);
  const zone = wedding.data?.timezone ?? "UTC";
  const today = calendarDayIn(new Date(), zone);
  const soon = calendarDayIn(new Date(Date.now() + 7 * 86400000), zone);
  for (const p of payments)
    if (!p.due_date || p.due_date <= soon) {
      // "7 of 10" alone says nothing; lead with the budget line it pays for.
      const line = Array.isArray(p.budget_items) ? p.budget_items[0] : p.budget_items;
      const what = [line?.name, p.label].filter(Boolean).join(", payment ");
      const amount = new Intl.NumberFormat("en", { style: "currency", currency: p.currency }).format(p.amount_cents / 100);
      result.push({
        id: `payment:${p.id}`,
        title: p.due_date
          ? `${p.due_date < today ? "Overdue" : "Due soon"}: ${what}`
          : `Needs a due date: ${what}`,
        detail: p.due_date ? `${amount} · due ${formatCalendarDate(p.due_date)}` : amount,
        href: "/admin/vendors/tasks",
        kind: "payment",
        priority: p.due_date && p.due_date < today ? "high" : "normal",
      });
    }
  if (submissions.count)
    result.push({
      id: "reviews",
      title: `${submissions.count} Sheet responses need review`,
      detail: "Review proposed contact changes before applying them.",
      href: "/admin/imports",
      kind: "review",
      priority: "normal",
    });
  for (const o of outbox)
    result.push({
      id: `delivery:${o.id}`,
      title: "A message needs delivery review",
      detail: o.last_error ?? "Delivery failed",
      href: "/admin/comms",
      kind: "delivery",
      priority: "high",
    });
  if (
    sync.data &&
    (sync.data.state === "failed" ||
      Date.now() - new Date(sync.data.started_at).getTime() > 8 * 86400000)
  )
    result.push({
      id: "sync-health",
      title: "Check the Save-the-Date connection",
      detail: "The latest sync failed or is overdue.",
      href: "/admin/imports",
      kind: "health",
      priority: "high",
    });
  return result.sort(
    (a, b) =>
      Number(b.priority === "high") - Number(a.priority === "high") ||
      a.title.localeCompare(b.title),
  );
}

export function automationReadiness(run: { state: string; started_at: string; finished_at: string | null } | null, now = Date.now()): AttentionItem | null {
  const age = run ? now - new Date(run.started_at).getTime() : Infinity;
  const detail = !run ? "No scheduled automation run has been recorded. Check the cron configuration."
    : run.state === "failed" ? "The latest scheduled automation run failed."
    : run.state === "running" && age > 5 * 60_000 ? "The latest automation run has been running for over five minutes."
    : age > 15 * 60_000 ? "Scheduled automation has not started in over fifteen minutes."
    : null;
  return detail ? { id: "automation-health", title: "Check scheduled automation", detail,
    href: "/admin/comms", kind: "health", priority: "high" } : null;
}
