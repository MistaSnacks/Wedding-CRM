import { describe, expect, it } from "vitest";
import { headcountEstimate, planningCalendar, safeDocumentUrl, validCalendarDay } from "./planning-rules";
describe("planning safety and calendar", () => {
  it("rejects executable links, embedded credentials, and impossible dates", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,test", "https://user:password@example.com/a"]) expect(() => safeDocumentUrl(url)).toThrow();
    expect(safeDocumentUrl(" https://example.com/contract.pdf ")).toBe("https://example.com/contract.pdf");
    expect(() => validCalendarDay("2026-02-30")).toThrow();
    expect(validCalendarDay("2028-02-29")).toBe("2028-02-29");
  });
  it("uses all-day deadlines without UTC day shifts and escapes calendar injection", () => {
    const calendar = planningCalendar([{ id: "task-1", title: "Flowers, food;\nBEGIN:VEVENT", date: "2027-04-12" }], new Date("2026-09-04T09:15:00Z"));
    expect(calendar).toContain("DTSTART;VALUE=DATE:20270412\r\n");
    expect(calendar).toContain("SUMMARY:Flowers\\, food\\;\\nBEGIN:VEVENT");
    expect(calendar.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1);
  });
  it("folds multilingual names by bytes and rejects unsafe headcount amounts", () => {
    const calendar = planningCalendar([{ id: "one", title: "Đám cưới ".repeat(25), date: "2027-04-12" }], new Date("2026-09-04T00:00:00Z"));
    for (const line of calendar.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(headcountEstimate(123, 4500)).toBe(553500);
    expect(headcountEstimate(0, 4500)).toBe(0);
    for (const [n, cents] of [[-1, 100], [1.5, 100], [100, Number.MAX_SAFE_INTEGER]]) expect(() => headcountEstimate(n, cents)).toThrow();
  });
});
