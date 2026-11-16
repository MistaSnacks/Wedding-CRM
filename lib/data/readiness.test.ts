import { expect, it } from "vitest";
import { automationReadiness, guestReadiness } from "./readiness";
import type { ReportData } from "@/lib/reports/guest-reports";

function fixture(): ReportData {
  return {
    hhs: [{ id: "h", display_name: "Family", email: "family@example.test", mailing_address: { raw: "123 Lane" }, rsvp_status: "completed", max_party_size: 2, plus_one_slots: 0, guests: [{ id: "g", household_id: "h", first_name: "Alice", last_name: "A", age_type: "adult", origin: "named" }] }],
    events: [{ id: "e", name: "Reception", rsvp_enabled: true }],
    invites: [{ household_id: "h", event_id: "e" }],
    responses: [{ guest_id: "g", event_id: "e", attending: "yes", meal_option_id: null }],
    meals: [], tables: [], seats: [],
  } as unknown as ReportData;
}
it("flags shared contacts once without assuming they should be merged", () => {
  const data = fixture();
  data.hhs.push({ ...data.hhs[0], id: "h2", email: " FAMILY@example.test ", display_name: " family ", guests: [] });
  const warnings = guestReadiness(data).filter(i => i.id.startsWith("duplicate:"));
  expect(warnings).toHaveLength(2);
  expect(warnings.every(i => i.detail.includes("Confirm these are separate invitations"))).toBe(true);
  expect(warnings[0].href).toContain("q=");
});
it("compares status against expected active invitations, not stored row count", () => {
  const data = fixture(); data.responses = [];
  expect(guestReadiness(data).find(i => i.id === "status:h")?.detail).toContain("imply pending");
  data.responses = fixture().responses;
  expect(guestReadiness(data).find(i => i.id === "status:h")).toBeUndefined();
});
it("only requires age-eligible meals for active events", () => {
  const data = fixture();
  data.meals = [{ id: "kids", name: "Kids", event_id: "e", is_kids_meal: true, sort_order: 0, is_active: true, name_i18n: {} }];
  expect(guestReadiness(data).some(i => i.kind === "meal")).toBe(false);
  data.meals[0].is_kids_meal = false;
  expect(guestReadiness(data).some(i => i.kind === "meal")).toBe(true);
  data.events[0].rsvp_enabled = false;
  expect(guestReadiness(data).some(i => i.kind === "meal")).toBe(false);
});
it("flags missing, failed, stale or stuck automation, while allowing a recent run", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  const run = { state: "success", started_at: "2026-09-04T11:59:00Z", finished_at: "2026-09-04T11:59:05Z" };
  expect(automationReadiness(run, now)).toBeNull();
  expect(automationReadiness(null, now)).not.toBeNull();
  expect(automationReadiness({ ...run, state: "failed" }, now)).not.toBeNull();
  expect(automationReadiness({ ...run, started_at: "2026-09-04T11:44:00Z" }, now)?.detail).toContain("fifteen minutes");
  expect(automationReadiness({ ...run, state: "running", started_at: "2026-09-04T11:54:00Z" }, now)?.detail).toContain("five minutes");
});
