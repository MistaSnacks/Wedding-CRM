import type { VendorStatus } from "./data/vendor-rules";
import type { BudgetHealth } from "./data/budget-rules";

export type Locale = "en" | "es" | "vi";
export type RsvpStatus = "pending" | "started" | "completed" | "declined";
export type Attending = "pending" | "yes" | "no";
export type AgeType = "adult" | "child" | "infant";

export type HouseholdRow = {
  id: string;
  wedding_id: string;
  display_name: string;
  primary_contact_name: string | null;
  email: string | null;
  phone: string | null;
  mailing_address: Record<string, string> | null;
  invite_code: string;
  access_token: string;
  max_party_size: number;
  plus_one_slots: number;
  rsvp_status: RsvpStatus;
  preferred_locale: Locale;
  tags: string[];
  internal_notes: string | null;
};

export type SheetSubmissionStatus = "pending" | "matched" | "created" | "ignored";

export type SheetSubmissionRow = {
  id: string;
  wedding_id: string;
  source: "save_the_date";
  row_key: string;
  raw: Record<string, string>;
  received_at: string | null;
  status: SheetSubmissionStatus;
  household_id: string | null;
  /** Prior value of every field a match wrote, so undo restores rather than guesses. */
  applied: Record<string, { from: unknown; to: unknown }> | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type GuestRow = {
  id: string;
  household_id: string;
  first_name: string;
  last_name: string;
  relationship: string | null;
  age_type: AgeType;
  origin: "named" | "plus_one";
  is_vip: boolean;
  dietary_restrictions: string | null;
  allergies: string | null;
  accessibility_needs: string | null;
  hotel_info: Record<string, unknown> | null;
  internal_notes: string | null;
};

export type EventRow = {
  id: string;
  name: string;
  starts_at: string | null;
  venue_name: string | null;
  rsvp_enabled: boolean;
  seating_published_at: string | null;
  sort_order: number;
};

export type MealOptionRow = {
  id: string;
  name: string;
  is_kids_meal: boolean;
  sort_order: number;
  event_id: string | null;
};

export type ResponseRow = {
  guest_id: string;
  event_id: string;
  attending: Attending;
  meal_option_id: string | null;
  responded_at: string | null;
  responded_via: "guest" | "admin" | null;
};

export type QuestionRow = {
  id: string;
  label: Record<Locale, string>;
  type: "text" | "boolean" | "select";
  options: unknown;
  scope: "household" | "guest";
  sort_order: number;
  is_active: boolean;
};

export type AnswerRow = {
  question_id: string;
  household_id: string;
  guest_id: string | null;
  value: unknown;
};

export type ActivityRow = {
  id: number;
  household_id: string | null;
  guest_id: string | null;
  actor_type: "guest" | "admin" | "system";
  action: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type SeatingTableRow = {
  id: string;
  event_id: string;
  name: string;
  capacity: number;
  shape: "round" | "rect" | "banquet";
  pos_x: number;
  pos_y: number;
};

export type SeatAssignmentRow = {
  guest_id: string;
  event_id: string;
  table_id: string;
  seat_number: number | null;
};

export type SubmitRsvpPayload = {
  responses: Array<{ guest_id: string; event_id: string; attending: Attending; meal_option_id?: string | null }>;
  new_plus_ones?: Array<{
    first_name: string;
    last_name: string;
    responses: Array<{ event_id: string; attending: Attending; meal_option_id?: string | null }>;
  }>;
  guest_fields?: Array<{ guest_id: string; dietary_restrictions?: string; allergies?: string }>;
  answers?: Array<{ question_id: string; guest_id?: string | null; value: unknown }>;
  via: "guest" | "admin";
  complete: boolean;
};

export type HouseholdFilter =
  | "all"
  | "pending"
  | "attending"
  | "declined"
  | "started"
  | "families"
  | "plus_ones"
  | "children"
  | "missing_meal"
  | "dietary"
  | "accessibility"
  | "no_table"
  | "vip";

export type OverviewMetrics = {
  householdsInvited: number;
  guestsInvited: number;
  householdsResponded: number;
  householdsPending: number;
  guestsAttending: number;
  guestsDeclined: number;
  guestsPending: number;
  completionPct: number;
  plusOnesAdded: number;
  adultsAttending: number;
  childrenAttending: number;
  infantsAttending: number;
  mealCounts: Array<{ name: string; count: number }>;
  dietaryCount: number;
  accessibilityCount: number;
  tablesCount: number;
  guestsWithoutTable: number;
};

// ---------------------------------------------------------------------------
// Budget & vendors (migration 0012)
//
// Row types mirror the columns as `0012_budget_vendors.sql` actually declares
// them, not as the older drafts describe them: money is `*_cents` on `bigint`,
// `budget_payments` has no `paid` boolean (`paid_at` is the only flag), the
// payment's parent is `budget_item_id`, a category's allocation is
// `target_cents`, and `budget_items.qty` is text because the source sheet
// contains "100 liters (abundant)".
//
// The two derived enums live where their rules live — `VendorStatus` in
// `lib/data/vendor-rules.ts`, `BudgetHealth` in `lib/data/budget-rules.ts` —
// and are re-exported here so the row types and the rule modules can never
// drift into two definitions of the same word.
// ---------------------------------------------------------------------------

export type { VendorStatus, BudgetHealth };

export type PaymentKind = "deposit" | "installment" | "final" | "refund";
export type ContractedSource = "manual" | "vendor";
export type VendorPriority = "must_have" | "nice_to_have" | "optional";

export type VendorRow = {
  id: string;
  wedding_id: string;
  /** The budget category this vendor's spend belongs to. Null until the money is planned. */
  category_id: string | null;
  name: string;
  /**
   * The wedding-team role ("Photographer", "DJ"). Free text, not an enum.
   * `not null default 'other'` in the DB, typed nullable because the rule
   * modules treat an unset role as an empty slot to fill.
   */
  role: string | null;
  status: VendorStatus;
  priority: VendorPriority;
  assigned_to: string | null;
  contact_name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  address: string | null;
  estimated_cents: number | null;
  quoted_cents: number | null;
  contracted_cents: number | null;
  currency: string;
  /** Calendar date, "YYYY-MM-DD". Never `new Date()` it. */
  contract_signed_at: string | null;
  /** Calendar date. Separate from the signature: couples book verbally first. */
  booked_at: string | null;
  /** A pasted Drive/Dropbox link, not an upload. */
  contract_url: string | null;
  rating: number | null;
  notes: string | null;
  sort_order: number;
};

export type BudgetCategoryRow = {
  id: string;
  wedding_id: string;
  name: string;
  /** Stable machine key; survives a rename so the seed stays idempotent. */
  slug: string;
  sort_order: number;
  /** Top-down allocation. The category forecast falls back to it only when the category is empty. */
  target_cents: number | null;
  /** Nullable override of the sum of item benchmarks. Null = unknown, 0 = genuinely nothing. */
  benchmark_cents: number | null;
  is_contingency: boolean;
  notes: string | null;
};

export type BudgetItemRow = {
  id: string;
  wedding_id: string;
  category_id: string;
  vendor_id: string | null;
  name: string;
  /** Text on purpose: the source sheet has "2", "180" and "100 liters (abundant)". Never arithmetic. */
  qty: string | null;
  unit_price_cents: number | null;
  benchmark_cents: number | null;
  estimated_cents: number | null;
  quoted_cents: number | null;
  contracted_cents: number | null;
  /** Who last wrote `contracted_cents`, so a vendor sync never silently replaces a typed number. */
  contracted_source: ContractedSource;
  currency: string;
  pending_guest_count: boolean;
  is_reconciliation: boolean;
  notes: string | null;
  sort_order: number;
};

export type BudgetPaymentRow = {
  id: string;
  wedding_id: string;
  budget_item_id: string;
  /** Optional payee override; falls back to the item's vendor when null. */
  vendor_id: string | null;
  label: string;
  kind: PaymentKind;
  /** Negative only for refunds — the DB enforces the sign against `kind`. */
  amount_cents: number;
  currency: string;
  /** Calendar date. Compare with `calendarDayDelta`, never with `new Date()`. */
  due_date: string | null;
  /** Calendar date the money left. Null means unpaid — this is the only paid flag. */
  paid_at: string | null;
  method: string | null;
  reference: string | null;
  /** A pasted link, not an upload. */
  receipt_url: string | null;
  notes: string | null;
  sort_order: number;
};

/**
 * The Overview's money and vendor numbers.
 *
 * Deliberately **not** part of `OverviewMetrics`: that type's keys and
 * `lib/data/metrics.test.ts` stay untouched, and the Overview page awaits both
 * inside one `Promise.all`. Every field here is a direct read from
 * `budget.summary()`, `vendorCounts()` or `teamRollup()` — `metrics.ts` does no
 * arithmetic of its own, which is why it needs no new tests.
 */
export type BudgetMetrics = {
  /** The venue's zone, returned so the page never has to await the wedding row separately. */
  timeZone: string;
  /** `weddings.budget_total_cents`. Null means "not set" — render a prompt, never $0. */
  budgetTotalCents: number | null;
  /** `weddings.budget_benchmark_label`. The benchmark's name lives in data, never in code. */
  benchmarkLabel: string;
  currency: string;
  /** Σ category forecasts. */
  forecastCents: number;
  /** Σ resolved category benchmarks. */
  benchmarkCents: number;
  /** forecast − benchmark. Null when either side is unknown. */
  benchmarkDeltaCents: number | null;
  /** Σ `amount_cents` where `paid_at is not null`. Nothing stores this. */
  spentCents: number;
  /** forecast − spent, floored at zero: "Still to pay". */
  remainingCents: number;
  /** maxSpend − forecast: "Left in budget". Null when no total is set. Negative = over. */
  leftInBudgetCents: number | null;
  /** Σ unpaid scheduled payments. */
  scheduledUnpaidCents: number;
  dueThisMonthCents: number;
  dueThisMonthCount: number;
  overdueCents: number;
  overdueCount: number;
  budgetHealth: BudgetHealth;
  /** True when items carry more than one currency. Nothing converts; the UI must say so. */
  mixedCurrency: boolean;
  vendorsTotal: number;
  /** booked + completed. */
  vendorsBooked: number;
  /** researching + contacted + quoted. `passed` counts in neither. */
  vendorsPending: number;
  vendorsPassed: number;
  /** booked with no `contract_signed_at`. `completed` excluded. */
  contractsOutstanding: number;
  contractsSigned: number;
  rolesTotal: number;
  rolesFilled: number;
};
