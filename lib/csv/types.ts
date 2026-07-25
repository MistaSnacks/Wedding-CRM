import type { AgeType } from "@/lib/types";

export type CsvMapping = {
  firstName: string;
  lastName: string;
  household?: string;
  envelope?: string;
  email?: string;
  phone?: string;
  ageType?: string;
  relationship?: string;
  isPlusOne?: string;
  maxPartySize?: string;
  plusOneSlots?: string;
  locale?: string;
  tags?: Array<{ column: string; prefix?: string }>;
  address?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  meal?: string;
  dietary?: string;
  notes?: string;
};

export type ImportContext = {
  events: Array<{ id: string; name: string }>;
  mealOptions: Array<{ id: string; name: string }>;
};

export type MailingAddress = {
  raw?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  source: "csv" | "save_the_date";
};

export type RowError = { line: number; message: string };

export type CsvValidation = {
  ok: boolean;
  households: import("@/lib/data/imports").ImportHouseholdInput[];
  errors: RowError[];
  warnings: RowError[];
};

export type { AgeType };
