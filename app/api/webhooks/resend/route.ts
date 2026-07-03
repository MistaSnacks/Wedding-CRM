import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import { defaultScope } from "@/lib/data/scope";
import * as comms from "@/lib/data/comms";
import type { RecipientStatus } from "@/lib/data/comms";

/**
 * Resend delivery webhooks (svix signing). Idempotent: statuses only move
 * forward (queued → sent → delivered → opened; bounced/failed terminal).
 */
const EVENT_STATUS: Record<string, RecipientStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.bounced": "bounced",
  "email.complained": "failed",
  "email.delivery_delayed": "sent",
};

function verifySvix(secret: string, id: string, timestamp: string, payload: string, signatures: string): boolean {
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const signedContent = `${id}.${timestamp}.${payload}`;
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");
  return signatures.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    try {
      return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

export async function POST(request: Request) {
  const secret = env().RESEND_WEBHOOK_SECRET;
  const payload = await request.text();

  if (secret) {
    const id = request.headers.get("svix-id") ?? "";
    const timestamp = request.headers.get("svix-timestamp") ?? "";
    const signatures = request.headers.get("svix-signature") ?? "";
    if (!id || !verifySvix(secret, id, timestamp, payload, signatures)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
    // Reject stale timestamps (>5 min) to prevent replay
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      return NextResponse.json({ error: "stale" }, { status: 401 });
    }
  }

  let body: { type?: string; data?: { email_id?: string } };
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const status = body.type ? EVENT_STATUS[body.type] : undefined;
  const messageId = body.data?.email_id;
  if (status && messageId) {
    await comms.markByMessageId(defaultScope(), messageId, status);
  }
  return NextResponse.json({ ok: true });
}
