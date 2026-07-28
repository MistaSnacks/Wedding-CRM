import { createHash } from "node:crypto";
import Papa from "papaparse";
import { SignJWT, importPKCS8 } from "jose";
import type { Locale } from "@/lib/types";

/**
 * Reading the Save-the-Date response sheet.
 *
 * A service account is the right credential for a sheet somebody else owns: a
 * per-user OAuth token dies silently when the owner changes their password, and
 * publishing the sheet would make 250 people's home addresses world-readable
 * with no failure signal.
 *
 * The reader is an interface so the sync is testable without network or
 * credentials — and so a CSV export can stand in while the service account is
 * still being provisioned.
 */

export type SheetRow = Record<string, string>;
export type SheetReader = () => Promise<SheetRow[]>;

/** Columns the matcher cannot work without. Order is irrelevant; we map by header. */
export const REQUIRED_COLUMNS = ["Received At", "First Name", "Last Name"] as const;

/**
 * Every failure a real sync hits — sharing revoked, tab renamed, columns
 * reordered, sheet moved — surfaces as one of these, with a message an admin
 * can act on rather than a stack trace.
 */
export class SheetAccessError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "not_found" | "shape" | "network",
  ) {
    super(message);
    this.name = "SheetAccessError";
  }
}

const norm = (s: string): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Identity of a row, from content that does not drift: when it arrived, who
 * sent it, what they're called. Re-reading the sheet therefore produces the
 * same keys, which is what makes a best-effort cron safe — a double-fire is a
 * no-op and a skipped week is caught by the next run.
 */
export function rowKey(row: SheetRow): string {
  const parts = [
    (row["Received At"] ?? "").trim(),
    norm(row["Email"] ?? ""),
    norm(`${row["First Name"] ?? ""} ${row["Last Name"] ?? ""}`),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function assertShape(rows: SheetRow[]): void {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length) {
    throw new SheetAccessError(
      `The Save-the-Date sheet is missing the ${missing.join(" and ")} column${missing.length > 1 ? "s" : ""}. If a column was renamed, put the name back or tell us the new one.`,
      "shape",
    );
  }
}

export function parseCsv(text: string): SheetRow[] {
  const parsed = Papa.parse<SheetRow>(text, { header: true, skipEmptyLines: true });
  const rows = (parsed.data ?? []).filter((r) => Object.values(r).some((v) => (v ?? "").trim()));
  assertShape(rows);
  return rows;
}

/** Stand-in reader: a CSV export of the same sheet. Used by tests and manual runs. */
export function csvReader(text: string): SheetReader {
  return async () => parseCsv(text);
}

export type ParsedSubmission = {
  first: string;
  last: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  /** Blank means English; only es/vi are meaningful overrides. */
  language: Locale;
  receivedAt: string;
  /** Confirmed present in real data (`Ty Huynh`); honoured immediately. */
  optOut: boolean;
};

const cell = (row: SheetRow, key: string): string => (row[key] ?? "").trim();

export function parseSubmission(row: SheetRow): ParsedSubmission {
  const notes = cell(row, "Notes");
  const language = cell(row, "Language").toLowerCase();
  return {
    first: cell(row, "First Name"),
    last: cell(row, "Last Name"),
    email: cell(row, "Email"),
    phone: cell(row, "Phone"),
    address: cell(row, "Mailing Address"),
    notes,
    language: language === "es" || language === "vi" ? language : "en",
    receivedAt: cell(row, "Received At"),
    optOut: /opt.?out/i.test(notes),
  };
}

export type GoogleSheetConfig = {
  clientEmail: string;
  /** PEM private key. Vercel env mangles newlines, so `\n` escapes are accepted. */
  privateKey: string;
  sheetId: string;
  /** A1 range including the header row. */
  range: string;
};

async function accessToken(cfg: GoogleSheetConfig): Promise<string> {
  const pem = cfg.privateKey.includes("\\n") ? cfg.privateKey.replace(/\\n/g, "\n") : cfg.privateKey;
  let key;
  try {
    key = await importPKCS8(pem, "RS256");
  } catch {
    throw new SheetAccessError(
      "The Google service-account key isn't readable. Re-paste the private key into the environment settings.",
      "auth",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(cfg.clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new SheetAccessError(
      "Google wouldn't accept our sign-in for the Save-the-Date sheet. The service account may have been disabled.",
      "auth",
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new SheetAccessError("Google returned no access token.", "auth");
  return json.access_token;
}

export function googleSheetReader(cfg: GoogleSheetConfig): SheetReader {
  return async () => {
    const token = await accessToken(cfg);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      cfg.sheetId,
    )}/values/${encodeURIComponent(cfg.range)}`;

    let res: Response;
    try {
      res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    } catch {
      throw new SheetAccessError("We couldn't reach Google Sheets just now.", "network");
    }

    if (res.status === 403) {
      throw new SheetAccessError(
        "We can't read the Save-the-Date sheet any more — it looks like sharing was turned off. Re-share it with the service account as a Viewer.",
        "auth",
      );
    }
    if (res.status === 404) {
      throw new SheetAccessError(
        "The Save-the-Date sheet or its tab can't be found. It may have been moved, deleted, or the tab renamed.",
        "not_found",
      );
    }
    if (!res.ok) {
      throw new SheetAccessError(`Google Sheets returned an error (${res.status}).`, "network");
    }

    const json = (await res.json()) as { values?: string[][] };
    return rowsFromValues(json.values ?? []);
  };
}

/** Sheets returns a bare grid; the first row is the header and short rows are padded. */
export function rowsFromValues(values: string[][]): SheetRow[] {
  const [header, ...body] = values;
  if (!header) return [];
  const rows = body
    .map((cells) => {
      const row: SheetRow = {};
      header.forEach((h, i) => {
        row[h] = cells[i] ?? "";
      });
      return row;
    })
    .filter((r) => Object.values(r).some((v) => (v ?? "").trim()));
  assertShape(rows);
  return rows;
}
