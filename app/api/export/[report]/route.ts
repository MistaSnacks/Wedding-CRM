import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding, type WeddingScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import type { ResponseRow, MealOptionRow, EventRow, SeatingTableRow, SeatAssignmentRow } from "@/lib/types";

type Table = { name: string; rows: Array<Record<string, string | number>> };

async function loadShared(scope: WeddingScope) {
  const [hhs, { data: responses }, { data: meals }, { data: events }, { data: tables }, { data: seats }] =
    await Promise.all([
      households.list(scope),
      scope.db.from("guest_event_responses").select("guest_id, event_id, attending, meal_option_id, responded_at, responded_via").eq("wedding_id", scope.weddingId),
      scope.db.from("meal_options").select("id, name, is_kids_meal, sort_order, event_id").eq("wedding_id", scope.weddingId),
      scope.db.from("events").select("id, name, starts_at, venue_name, rsvp_enabled, seating_published_at, sort_order").eq("wedding_id", scope.weddingId).order("sort_order"),
      scope.db.from("seating_tables").select("id, event_id, name, capacity, shape, pos_x, pos_y").eq("wedding_id", scope.weddingId),
      scope.db.from("seat_assignments").select("guest_id, event_id, table_id, seat_number").eq("wedding_id", scope.weddingId),
    ]);
  return {
    hhs,
    responses: (responses ?? []) as ResponseRow[],
    meals: (meals ?? []) as MealOptionRow[],
    events: (events ?? []) as EventRow[],
    tables: (tables ?? []) as SeatingTableRow[],
    seats: (seats ?? []) as SeatAssignmentRow[],
  };
}

async function buildReport(scope: WeddingScope, report: string): Promise<Table> {
  const { hhs, responses, meals, events, tables, seats } = await loadShared(scope);
  const mealName = (id: string | null) => meals.find((m) => m.id === id)?.name ?? "";
  const eventName = (id: string) => events.find((e) => e.id === id)?.name ?? id;
  const tableName = (guestId: string) => {
    const seat = seats.find((s) => s.guest_id === guestId);
    return seat ? tables.find((t) => t.id === seat.table_id)?.name ?? "" : "";
  };
  const guestRows = hhs.flatMap((h) =>
    h.guests.map((g) => ({ h, g, rs: responses.filter((r) => r.guest_id === g.id) })),
  );
  const attends = (guestId: string) => responses.some((r) => r.guest_id === guestId && r.attending === "yes");

  switch (report) {
    case "guest-list":
      return {
        name: "Guest List",
        rows: guestRows.map(({ h, g, rs }) => ({
          Household: h.display_name,
          "First Name": g.first_name,
          "Last Name": g.last_name,
          "Age Type": g.age_type,
          Origin: g.origin,
          ...Object.fromEntries(events.map((e) => [e.name, rs.find((r) => r.event_id === e.id)?.attending ?? "pending"])),
          Meal: mealName(rs.find((r) => r.meal_option_id)?.meal_option_id ?? null),
          Dietary: g.dietary_restrictions ?? "",
          Allergies: g.allergies ?? "",
          Accessibility: g.accessibility_needs ?? "",
          Table: tableName(g.id),
          VIP: g.is_vip ? "yes" : "",
        })),
      };
    case "households":
      return {
        name: "Households",
        rows: hhs.map((h) => ({
          Household: h.display_name,
          Contact: h.primary_contact_name ?? "",
          Email: h.email ?? "",
          Phone: h.phone ?? "",
          Guests: h.guests.length,
          "Max Party": h.max_party_size,
          "Plus Ones": h.plus_one_slots,
          Status: h.rsvp_status,
          "Invite Code": h.invite_code,
          Language: h.preferred_locale,
        })),
      };
    case "rsvp-status":
      return {
        name: "RSVP Status",
        rows: hhs.map((h) => ({
          Household: h.display_name,
          Status: h.rsvp_status,
          Responded: h.guests.filter((g) => responses.some((r) => r.guest_id === g.id && r.attending !== "pending")).length,
          Total: h.guests.length,
        })),
      };
    case "attending":
    case "declined":
    case "pending": {
      const want = report === "attending" ? "yes" : report === "declined" ? "no" : "pending";
      return {
        name: report,
        rows: guestRows
          .filter(({ rs, g }) =>
            report === "attending"
              ? attends(g.id)
              : report === "declined"
                ? rs.length > 0 && rs.every((r) => r.attending === "no")
                : rs.every((r) => r.attending === "pending"),
          )
          .map(({ h, g, rs }) => ({
            Household: h.display_name,
            Guest: `${g.first_name} ${g.last_name}`,
            ...(want === "yes" ? { Meal: mealName(rs.find((r) => r.meal_option_id)?.meal_option_id ?? null) } : {}),
            Email: h.email ?? "",
          })),
      };
    }
    case "meals":
      return {
        name: "Meal Counts",
        rows: meals.map((m) => ({
          Meal: m.name,
          Count: responses.filter((r) => r.attending === "yes" && r.meal_option_id === m.id).length,
        })),
      };
    case "dietary":
      return {
        name: "Dietary",
        rows: guestRows
          .filter(({ g }) => g.dietary_restrictions || g.allergies)
          .map(({ h, g }) => ({
            Guest: `${g.first_name} ${g.last_name}`,
            Household: h.display_name,
            Dietary: g.dietary_restrictions ?? "",
            Allergies: g.allergies ?? "",
            Table: tableName(g.id),
          })),
      };
    case "accessibility":
      return {
        name: "Accessibility",
        rows: guestRows
          .filter(({ g }) => g.accessibility_needs)
          .map(({ h, g }) => ({
            Guest: `${g.first_name} ${g.last_name}`,
            Household: h.display_name,
            Needs: g.accessibility_needs ?? "",
          })),
      };
    case "seating":
      return {
        name: "Seating",
        rows: seats.map((s) => {
          const guest = guestRows.find(({ g }) => g.id === s.guest_id);
          return {
            Event: eventName(s.event_id),
            Table: tables.find((t) => t.id === s.table_id)?.name ?? "",
            Guest: guest ? `${guest.g.first_name} ${guest.g.last_name}` : s.guest_id,
            Household: guest?.h.display_name ?? "",
            Meal: guest ? mealName(guest.rs.find((r) => r.meal_option_id)?.meal_option_id ?? null) : "",
          };
        }),
      };
    case "addresses":
      return {
        name: "Addresses",
        rows: hhs.map((h) => ({
          Household: h.display_name,
          Contact: h.primary_contact_name ?? "",
          Address: h.mailing_address ? Object.values(h.mailing_address).filter(Boolean).join(", ") : "",
          Email: h.email ?? "",
          Phone: h.phone ?? "",
        })),
      };
    case "caterer":
      return {
        name: "Caterer",
        rows: guestRows
          .filter(({ g }) => attends(g.id))
          .map(({ h, g, rs }) => ({
            Guest: `${g.first_name} ${g.last_name}`,
            Table: tableName(g.id),
            Meal: mealName(rs.find((r) => r.meal_option_id)?.meal_option_id ?? "") || "MISSING",
            "Kids Meal": g.age_type !== "adult" ? "yes" : "",
            Dietary: [g.dietary_restrictions, g.allergies].filter(Boolean).join(" / "),
            Household: h.display_name,
          })),
      };
    default:
      throw new Error(`unknown report: ${report}`);
  }
}

function toCsv(rows: Array<Record<string, string | number>>): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  const admin = await requireAdmin();
  const { report } = await params;
  const format = new URL(request.url).searchParams.get("format") ?? "csv";

  let table: Table;
  try {
    table = await buildReport(forWedding(admin.weddingId), report);
  } catch {
    return NextResponse.json({ error: "unknown report" }, { status: 404 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "xlsx") {
    const ws = XLSX.utils.json_to_sheet(table.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, table.name.slice(0, 31));
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${report}-${stamp}.xlsx"`,
      },
    });
  }

  return new NextResponse(toCsv(table.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report}-${stamp}.csv"`,
    },
  });
}
