import type { AttentionItem } from "@/lib/data/readiness";

/*
 * Turns the flat list of derived planning items into a short to-do list a
 * wedding party can read. Four hundred rows that each say "1 reply needed"
 * are true and useless; "142 households have not replied" with one button is
 * the same fact in a form someone can act on.
 *
 * Pure functions only. The page and the Overview summary both render from the
 * result, so the counts on the two screens cannot disagree.
 */

export type AttentionRow = {
  key: string;
  title: string;
  detail: string;
  href: string;
  urgent: boolean;
};

export type AttentionGroup = {
  kind: AttentionItem["kind"];
  /** Section heading, e.g. "Waiting for replies". */
  title: string;
  /** One sentence with the count, e.g. "142 households have not replied yet." */
  summary: string;
  /** Why it matters or what clears it. */
  hint: string;
  action: { label: string; href: string } | null;
  rows: AttentionRow[];
  /** Anything in the group that should not wait. */
  urgent: boolean;
  /** Setup checks are for whoever runs the site, so the page keeps them folded. */
  technical: boolean;
};

const ORDER: AttentionItem["kind"][] = ["payment", "delivery", "meal", "seating", "review", "rsvp", "contact", "health"];

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function listOf(names: string[], max = 3) {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length <= max) return unique.join(", ");
  return `${unique.slice(0, max).join(", ")} and ${unique.length - max} more`;
}

function andJoin(names: string[]) {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length <= 1) return unique.join("");
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

function byKey<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return [...map.values()];
}

const sortRows = (rows: AttentionRow[]) =>
  rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.title.localeCompare(b.title));

function replies(items: AttentionItem[]): AttentionGroup {
  // One row per household, however many events it has not answered.
  const rows = byKey(items, (i) => i.href).map((group): AttentionRow => {
    const guests = Math.max(...group.map((i) => i.count ?? 1));
    return {
      key: group[0].id,
      title: group[0].subject ?? group[0].title,
      detail: `${plural(guests, "guest", "guests")} · ${andJoin(group.map((i) => i.event ?? i.detail))}`,
      href: group[0].href,
      urgent: false,
    };
  });
  return {
    kind: "rsvp",
    title: "Waiting for replies",
    summary: `${plural(rows.length, "household still has", "households still have")} guests who have not replied.`,
    hint: "A reminder email reaches everyone who has an email address. Open a household to enter a reply someone gave you by phone.",
    action: { label: "Send a reminder", href: "/admin/comms" },
    rows: sortRows(rows),
    urgent: false,
    technical: false,
  };
}

function contacts(items: AttentionItem[]): AttentionGroup {
  const rows = byKey(items, (i) => i.href).map((group): AttentionRow => {
    const missing = group.map((i) => (i.id.startsWith("email:") ? "email" : "mailing address"));
    return {
      key: group[0].id,
      title: group[0].subject ?? group[0].title,
      detail: `No ${missing.join(" or ")}`,
      href: group[0].href,
      urgent: false,
    };
  });
  const noEmail = items.filter((i) => i.id.startsWith("email:")).length;
  const noAddress = items.filter((i) => i.id.startsWith("address:")).length;
  const parts = [
    noEmail ? `${plural(noEmail, "household has", "households have")} no email` : "",
    noAddress ? `${plural(noAddress, "household has", "households have")} no mailing address` : "",
  ].filter(Boolean);
  return {
    kind: "contact",
    title: "Missing contact details",
    summary: `${parts.join(" and ")}.`,
    hint: "Without an email a household gets no invitation or reminder. Addresses are only needed for paper mail.",
    action: { label: "Open the guest list", href: "/admin/guests" },
    rows: sortRows(rows),
    urgent: false,
    technical: false,
  };
}

function meals(items: AttentionItem[]): AttentionGroup {
  const rows = byKey(items, (i) => `${i.href}|${i.subject ?? i.title}`).map(
    (group): AttentionRow => ({
      key: group[0].id,
      title: group[0].subject ?? group[0].title,
      detail: `Coming to ${andJoin(group.map((i) => i.event ?? i.detail))}, no meal chosen`,
      href: group[0].href,
      urgent: true,
    }),
  );
  return {
    kind: "meal",
    title: "Meals to choose",
    summary: `${plural(rows.length, "guest is", "guests are")} coming but ${rows.length === 1 ? "has" : "have"} not picked a meal.`,
    hint: "The caterer needs a dish for every guest. Open the guest to choose one, or ask them.",
    action: { label: "Open meals", href: "/admin/meals" },
    rows: sortRows(rows),
    urgent: true,
    technical: false,
  };
}

function seating(items: AttentionItem[]): AttentionGroup {
  const seats = items.filter((i) => i.id.startsWith("seat:"));
  const tables = items.filter((i) => !i.id.startsWith("seat:"));
  // One row per event: nobody seats guests one page-visit at a time.
  const rows = byKey(seats, (i) => i.href).map((group): AttentionRow => {
    const event = group[0].event ?? group[0].detail;
    return {
      key: group[0].id,
      title: `${plural(group.length, "guest", "guests")} coming to ${event} ${group.length === 1 ? "has" : "have"} no table`,
      detail: listOf(group.map((i) => i.subject ?? ""), 4),
      href: group[0].href,
      urgent: false,
    };
  });
  for (const t of tables)
    rows.push({ key: t.id, title: t.title.replace(/^Review /, "Check "), detail: t.detail.replace("/", " of "), href: t.href, urgent: true });
  // A guest coming to two events needs two seats but is one person. Count
  // people here so the number matches "Still to seat" on the Overview.
  const people = new Set(seats.map((i) => i.id.split(":")[1])).size;
  const summary = [
    people ? `${plural(people, "guest who is coming has", "guests who are coming have")} no table` : "",
    tables.length ? `${plural(tables.length, "table needs", "tables need")} a check` : "",
  ]
    .filter(Boolean)
    .join(" and ");
  return {
    kind: "seating",
    title: "Seating",
    summary: `${summary}.`,
    hint: "Seat people when most replies are in. A table needs a check when it is over its size or holds someone who is no longer coming.",
    action: { label: "Open seating", href: seats[0]?.href ?? tables[0]?.href ?? "/admin/seating" },
    rows,
    urgent: tables.length > 0,
    technical: false,
  };
}

function payments(items: AttentionItem[]): AttentionGroup {
  const overdue = items.filter((i) => i.priority === "high").length;
  return {
    kind: "payment",
    title: "Payments",
    summary: overdue
      ? `${plural(overdue, "payment is", "payments are")} overdue${items.length > overdue ? ` and ${items.length - overdue} more ${items.length - overdue === 1 ? "is" : "are"} due soon or need a date` : ""}.`
      : `${plural(items.length, "payment is", "payments are")} due in the next week or ${items.length === 1 ? "needs" : "need"} a date.`,
    hint: "Marking a payment as paid in Vendors clears it from this list.",
    action: { label: "Open payments", href: "/admin/vendors/tasks" },
    rows: sortRows(items.map((i) => ({ key: i.id, title: i.title, detail: i.detail, href: i.href, urgent: i.priority === "high" }))),
    urgent: overdue > 0,
    technical: false,
  };
}

function deliveries(items: AttentionItem[]): AttentionGroup {
  return {
    kind: "delivery",
    title: "Emails that did not arrive",
    summary: `${plural(items.length, "email", "emails")} could not be delivered.`,
    hint: "Usually a mistyped address. Fix the address on the household, then send again from Emails.",
    action: { label: "Open emails", href: "/admin/comms" },
    rows: items.map((i) => ({ key: i.id, title: "An email bounced", detail: i.detail, href: i.href, urgent: true })),
    urgent: true,
    technical: false,
  };
}

function reviews(items: AttentionItem[]): AttentionGroup {
  return {
    kind: "review",
    title: "Sign-ups to review",
    summary: items.map((i) => i.title.replace("Sheet responses need review", "save-the-date sign-ups are waiting for you")).join(" ") + ".",
    hint: "Each one is a guest who filled in the save-the-date form. You decide who they are before anything changes.",
    action: { label: "Review sign-ups", href: "/admin/imports" },
    rows: [],
    urgent: false,
    technical: false,
  };
}

/** Plain words for the checks that are really about how the site runs. */
function setupRow(i: AttentionItem): AttentionRow {
  if (i.id === "automation-health")
    return { key: i.id, title: "Automatic emails are not running", detail: "Reminders and scheduled emails will not go out on their own until this is fixed. Sending by hand still works. Tell whoever set up the site.", href: i.href, urgent: true };
  if (i.id === "sync-health")
    return { key: i.id, title: "The save-the-date form is not connected", detail: "New sign-ups will not arrive on their own. You can still upload them by hand under Import & export.", href: i.href, urgent: false };
  if (i.id.startsWith("duplicate:"))
    return { key: i.id, title: i.title.replace("Review households sharing", "Two households share"), detail: i.detail.replace(" Confirm these are separate invitations before merging anything.", " Check that these are two separate invitations."), href: i.href, urgent: false };
  if (i.id.startsWith("status:"))
    return { key: i.id, title: i.title.replace("Review RSVP status: ", "Reply status looks out of date: "), detail: "Open the household and save its replies again to refresh it.", href: i.href, urgent: false };
  if (i.id.startsWith("party:"))
    return { key: i.id, title: i.title.replace("Invitation limits need review: ", "More guests than the invitation allows: "), detail: "Raise the party size on the household, or remove the extra guest.", href: i.href, urgent: false };
  return { key: i.id, title: i.title, detail: i.detail, href: i.href, urgent: i.priority === "high" };
}

function setup(items: AttentionItem[]): AttentionGroup {
  const rows = items.map(setupRow);
  return {
    kind: "health",
    title: "Checks",
    summary: `${plural(rows.length, "thing", "things")} to double-check.`,
    hint: "These do not block guests from replying.",
    action: null,
    rows: sortRows(rows),
    urgent: rows.some((r) => r.urgent),
    technical: true,
  };
}

const BUILDERS: Record<AttentionItem["kind"], (items: AttentionItem[]) => AttentionGroup> = {
  rsvp: replies,
  contact: contacts,
  meal: meals,
  seating,
  payment: payments,
  delivery: deliveries,
  review: reviews,
  health: setup,
};

/** The to-do list: one group per kind of work, most pressing first. */
export function groupAttention(items: AttentionItem[]): AttentionGroup[] {
  return ORDER.flatMap((kind) => {
    const mine = items.filter((i) => i.kind === kind);
    return mine.length ? [BUILDERS[kind](mine)] : [];
  });
}
