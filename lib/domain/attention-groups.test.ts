import { expect, test } from "vitest";
import type { AttentionItem } from "@/lib/data/readiness";
import { groupAttention } from "./attention-groups";

const item = (over: Partial<AttentionItem> & Pick<AttentionItem, "id" | "kind">): AttentionItem => ({
  title: "t",
  detail: "d",
  href: "/admin/guests/h1",
  priority: "normal",
  ...over,
});

test("one row per household, however many events it has not answered", () => {
  const [group] = groupAttention([
    item({ id: "rsvp:h1:e1", kind: "rsvp", subject: "The Nguyens", event: "Reception", count: 2 }),
    item({ id: "rsvp:h1:e2", kind: "rsvp", subject: "The Nguyens", event: "Welcome Party", count: 2 }),
    item({ id: "rsvp:h2:e1", kind: "rsvp", subject: "Ana Ramirez", event: "Reception", count: 1, href: "/admin/guests/h2" }),
  ]);
  expect(group.summary).toBe("2 households still have guests who have not replied.");
  expect(group.rows.map((r) => r.title)).toEqual(["Ana Ramirez", "The Nguyens"]);
  expect(group.rows[1].detail).toBe("2 guests · Reception and Welcome Party");
  expect(group.rows[0].detail).toBe("1 guest · Reception");
});

test("a household missing both email and address is one row", () => {
  const [group] = groupAttention([
    item({ id: "email:h1", kind: "contact", subject: "Aaron Gonzalez" }),
    item({ id: "address:h1", kind: "contact", subject: "Aaron Gonzalez" }),
  ]);
  expect(group.rows).toHaveLength(1);
  expect(group.rows[0].detail).toBe("No email or mailing address");
  expect(group.summary).toBe("1 household has no email and 1 household has no mailing address.");
});

test("unseated guests collapse to one row per event and name a few people", () => {
  const seats = ["Ann", "Bo", "Cy", "Di", "Ed", "Flo"].map((n, i) =>
    item({ id: `seat:g${i}:e1`, kind: "seating", subject: n, event: "Reception", href: "/admin/seating?event=e1" }),
  );
  const [group] = groupAttention([
    ...seats,
    item({ id: "table:t1", kind: "seating", title: "Review Table 4", detail: "11/10 seats occupied; 0 no longer attending.", priority: "high", href: "/admin/seating?event=e1" }),
  ]);
  expect(group.rows[0].title).toBe("6 guests coming to Reception have no table");
  expect(group.rows[0].detail).toBe("Ann, Bo, Cy, Di and 2 more");
  expect(group.rows[1].title).toBe("Check Table 4");
  expect(group.urgent).toBe(true);
});

test("groups come most pressing first and setup checks are marked technical", () => {
  const groups = groupAttention([
    item({ id: "automation-health", kind: "health", priority: "high", title: "Check scheduled automation", detail: "No scheduled automation run has been recorded. Check the cron configuration." }),
    item({ id: "rsvp:h1:e1", kind: "rsvp", subject: "A", event: "Reception", count: 1 }),
    item({ id: "meal:g1:e1", kind: "meal", subject: "Aki", event: "Reception", priority: "high" }),
    item({ id: "payment:p1", kind: "payment", title: "Overdue: Florist deposit", priority: "high" }),
  ]);
  expect(groups.map((g) => g.kind)).toEqual(["payment", "meal", "rsvp", "health"]);
  const setup = groups[3];
  expect(setup.technical).toBe(true);
  expect(setup.rows[0].title).toBe("Automatic emails are not running");
  expect(setup.rows[0].detail).not.toMatch(/cron/i);
  expect(groups[0].summary).toBe("1 payment is overdue.");
});

test("no items, no groups", () => {
  expect(groupAttention([])).toEqual([]);
});

test("the seating summary counts people, not seats", () => {
  const [group] = groupAttention([
    item({ id: "seat:g1:e1", kind: "seating", href: "/admin/seating?event=e1", event: "Reception", subject: "Ana" }),
    item({ id: "seat:g1:e2", kind: "seating", href: "/admin/seating?event=e2", event: "Welcome Party", subject: "Ana" }),
    item({ id: "seat:g2:e1", kind: "seating", href: "/admin/seating?event=e1", event: "Reception", subject: "Ben" }),
  ]);
  expect(group.summary).toBe("2 guests who are coming have no table.");
  expect(group.rows).toHaveLength(2);
});
