import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { env } from '@/lib/env';
import { adminDb } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const secret = env().RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Webhook is not configured.' }, { status: 503 });
  const payload = await request.text();
  let body: ReturnType<Resend['webhooks']['verify']>;
  try {
    body = new Resend(env().RESEND_API_KEY ?? 'webhook-only').webhooks.verify({ payload, headers: {
      id: request.headers.get('svix-id') ?? '', timestamp: request.headers.get('svix-timestamp') ?? '',
      signature: request.headers.get('svix-signature') ?? '', }, webhookSecret: secret });
  } catch { return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 }); }
  if (!('email_id' in body.data) || !body.data.email_id) return NextResponse.json({ ok: true });
  const { error } = await adminDb().rpc('apply_email_event', { p_id: request.headers.get('svix-id'), p_message: body.data.email_id, p_type: body.type });
  if (error) { console.error('Webhook persistence failed', error.message); return NextResponse.json({ error: 'Delivery update could not be saved.' }, { status: 503 }); }
  return NextResponse.json({ ok: true });
}
