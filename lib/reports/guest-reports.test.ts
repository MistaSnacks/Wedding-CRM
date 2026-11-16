import { expect, it } from "vitest";
import { buildGuestReport, type ReportData } from "./guest-reports";
const data = {
  hhs: [{ id: "h", display_name: "Family", guests: [{ id: "g", first_name: "Alice", last_name: "A", age_type: "adult", household_id: "h" }] }],
  events: [{ id: "e1", name: "Rehearsal" }, { id: "e2", name: "Reception" }],
  invites: [{ household_id: "h", event_id: "e1" }, { household_id: "h", event_id: "e2" }],
  responses: [{ guest_id: "g", event_id: "e1", attending: "yes", meal_option_id: "m1" }, { guest_id: "g", event_id: "e2", attending: "yes", meal_option_id: "m2" }],
  meals: [{ id: "m1", event_id: "e1", name: "Pasta" }, { id: "m2", event_id: "e2", name: "Beef" }],
  tables: [{ id: "t1", event_id: "e1", name: "Garden" }, { id: "t2", event_id: "e2", name: "Terrace" }],
  seats: [{ guest_id: "g", event_id: "e1", table_id: "t1" }, { guest_id: "g", event_id: "e2", table_id: "t2" }],
} as unknown as ReportData;
it("keeps event meal, table and headcount together", () => {
  const report = buildGuestReport(data, "caterer", "e2");
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0]).toMatchObject({ Event: "Reception", Meal: "Beef", Table: "Terrace" });
});
it("requires an event rather than picking one arbitrarily", () => {
  expect(() => buildGuestReport(data, "caterer")).toThrow(/Choose an event/);
});
it("includes invited guests whose pending response row does not exist", () => {
  expect(buildGuestReport({ ...data, responses: [] }, "pending", "e2").rows).toHaveLength(1);
});
it("does not include rehearsal-only acceptance in reception caterer count", () => {
  expect(buildGuestReport({ ...data, responses: data.responses.slice(0, 1) }, "caterer", "e2").rows).toHaveLength(0);
});
