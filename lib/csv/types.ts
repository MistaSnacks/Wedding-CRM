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
};

export type RowError = { line: number; message: string };

export type CsvValidation = {
  ok: boolean;
  households: import("@/lib/data/imports").ImportHouseholdInput[];
  errors: RowError[];
  warnings: RowError[];
};

export type { AgeType };
