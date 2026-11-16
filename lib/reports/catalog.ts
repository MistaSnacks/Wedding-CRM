import type { ExportReport } from "@/components/admin/ExportCenter";

/**
 * Every ready-made download, shared by the Reports page and the Imports &
 * Exports page so the two lists can never drift apart.
 */
export const REPORTS: ExportReport[] = [
  { key: "cash-flow", label: "Cash flow by month", group: "Budget & planning", description: "Scheduled, paid, and outstanding amounts by due month and currency" },
  { key: "vendor-cost-summary", label: "Vendor cost summary", group: "Budget & planning", description: "Vendor prices, linked budget forecast, and payments kept separate by currency" },
  { key: "budget", label: "Budget ledger", group: "Budget & planning", description: "Your estimates, quotes, contracts, and paid amounts with currency; private reference figures excluded" },
  { key: "vendors", label: "Vendor directory", group: "Budget & planning", description: "Contacts, status, responsibility, and contract details" },
  { key: "payments", label: "All payments", group: "Budget & planning", description: "Every installment and refund, with due dates, receipts, currency, and paid dates" },
  { key: "outstanding-payments", label: "Outstanding payments", group: "Budget & planning", description: "Unpaid installments, including payments that need a due date" },
  { key: "paid-expenses", label: "Paid expenses", group: "Budget & planning", description: "Recorded payments and refunds, with receipts and references" },
  { key: "tasks", label: "Planning tasks", group: "Budget & planning", description: "Deadlines, responsible people, and completion status" },
  { key: "guest-list", label: "Full guest list", group: "Guest lists", description: "Everyone, with RSVPs, meals, dietary notes, and tables" },
  { key: "households", label: "Household list", group: "Guest lists", description: "One row per household — contacts, party size, invite code" },
  { key: "addresses", label: "Mailing addresses", group: "Guest lists", description: "One row per household, ready for envelopes or a mail house" },
  { key: "rsvp-status", label: "RSVP progress", group: "RSVPs", description: "How many in each household have answered" },
  { key: "attending", label: "Attending guests", group: "RSVPs", description: "Everyone who said yes, with their meal choice" },
  { key: "declined", label: "Declined guests", group: "RSVPs", description: "Everyone who said no" },
  { key: "pending", label: "Awaiting reply", group: "RSVPs", description: "Invited guests who haven't answered yet" },
  { key: "caterer", label: "Caterer report", group: "For your vendors", description: "Attending guests with meals, kids' meals, and dietary needs" },
  { key: "meals", label: "Meal counts", group: "For your vendors", description: "Totals for each dish" },
  { key: "dietary", label: "Dietary restrictions", group: "For your vendors", description: "Guests with dietary notes or allergies, and their tables" },
  { key: "accessibility", label: "Accessibility requests", group: "For your vendors", description: "Guests who asked for accommodations" },
  { key: "seating", label: "Seating chart", group: "For your vendors", description: "Who sits at which table, per event" },
];
