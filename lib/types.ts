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
