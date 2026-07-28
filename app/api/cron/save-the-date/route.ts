import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { defaultScope } from "@/lib/data/scope";
import { env } from "@/lib/env";
import { configuredReader, runSync } from "@/lib/sync/run";
import { SheetAccessError } from "@/lib/sync/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const expected = env().CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Weekly Save-the-Date sync. Safe to call more than once: the job reconciles
 * the whole sheet and every row is keyed by its content, so a cron double-fire
 * changes nothing.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const reader = configuredReader();
  if (!reader) {
    return NextResponse.json(
      {
        skipped: "not_configured",
        message:
          "The Save-the-Date sync isn't connected to Google yet. Add the service-account credentials and the sheet ID.",
      },
      { status: 200 },
    );
  }

  try {
    const result = await runSync(defaultScope(), reader);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof SheetAccessError) {
      // A readable message, because this is what an admin will be shown.
      console.error("[sync] sheet unreadable:", e.kind, e.message);
      return NextResponse.json({ ok: false, kind: e.kind, message: e.message }, { status: 502 });
    }
    console.error("[sync] failed:", e);
    return NextResponse.json({ ok: false, message: "The sync failed unexpectedly." }, { status: 500 });
  }
}
