import { Resend } from "resend";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { env } from "@/lib/env";
import { emailStrings, localeOf } from "./strings";

/**
 * All outbound email goes through sendEmail. With no RESEND_API_KEY the
 * rendered HTML is written to .emails/*.html (dev fallback) — never throws.
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ id: string | null }> {
  const e = env();
  if (!e.RESEND_API_KEY) {
    const dir = path.join(process.cwd(), ".emails");
    await mkdir(dir, { recursive: true });
    const safe = args.subject.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
    const file = path.join(dir, `${Date.now()}-${safe}.html`);
    await writeFile(file, `<!-- to: ${args.to} -->\n${args.html}`);
    console.log(`[email:dev] wrote ${file}`);
    return { id: null };
  }
  const resend = new Resend(e.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: e.RESEND_FROM,
    to: args.to,
    subject: args.subject,
    html: args.html,
  });
  if (error) {
    console.error("[email] send failed:", error.message);
    return { id: null };
  }
  return { id: data?.id ?? null };
}

/** Shared shell: cream ground, serif heading, olive button. Inline styles only. */
export function emailShell(opts: { heading: string; body: string; cta?: { label: string; url: string }; footer?: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f9f7ee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9f7ee;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e7e3d2;border-radius:16px;padding:40px;">
<tr><td align="center" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;letter-spacing:.24em;color:#b17565;padding-bottom:12px;">JULIET &amp; JUAN</td></tr>
<tr><td align="center" style="font-family:Georgia,'Times New Roman',serif;font-size:30px;color:#3b4823;padding-bottom:16px;">${opts.heading}</td></tr>
<tr><td align="center" style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#4a5147;padding-bottom:24px;">${opts.body}</td></tr>
${
  opts.cta
    ? `<tr><td align="center" style="padding-bottom:24px;"><a href="${opts.cta.url}" style="display:inline-block;background:#3b4823;color:#f9f7ee;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:999px;">${opts.cta.label}</a></td></tr>`
    : ""
}
${
  opts.footer
    ? `<tr><td align="center" style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#8a8f86;">${opts.footer}</td></tr>`
    : ""
}
</table>
<table role="presentation" width="520"><tr><td align="center" style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#8a8f86;padding-top:16px;">June 12, 2027 · Tulum, México</td></tr></table>
</td></tr></table></body></html>`;
}

export async function sendVerificationEmail(args: { to: string; accessToken: string; locale: string }) {
  const s = emailStrings[localeOf(args.locale)];
  const url = `${env().NEXT_PUBLIC_APP_URL}/rsvp/h/${args.accessToken}`;
  return sendEmail({
    to: args.to,
    subject: s.verifySubject,
    html: emailShell({ heading: s.verifyHeading, body: s.verifyBody, cta: { label: s.verifyCta, url }, footer: s.verifyIgnore }),
  });
}

export async function sendConfirmationEmail(args: { to: string; accessToken: string; locale: string }) {
  const s = emailStrings[localeOf(args.locale)];
  const url = `${env().NEXT_PUBLIC_APP_URL}/rsvp/h/${args.accessToken}`;
  return sendEmail({
    to: args.to,
    subject: s.confirmSubject,
    html: emailShell({ heading: s.confirmHeading, body: s.confirmBody, cta: { label: s.confirmCta, url }, footer: s.confirmEditNote }),
  });
}

export function invitationHtml(args: { accessToken: string; inviteCode: string; locale: string }): { subject: string; html: string } {
  const s = emailStrings[localeOf(args.locale)];
  const url = `${env().NEXT_PUBLIC_APP_URL}/rsvp/h/${args.accessToken}`;
  return {
    subject: s.inviteSubject,
    html: emailShell({
      heading: s.inviteHeading,
      body: `${s.inviteBody}<br/><br/><span style="font-size:12px;letter-spacing:.1em;color:#8a8f86;">${s.inviteCodeLabel}</span><br/><span style="font-family:Georgia,serif;font-size:22px;letter-spacing:.2em;color:#1c231b;">${args.inviteCode}</span>`,
      cta: { label: s.inviteCta, url },
    }),
  };
}

export function reminderHtml(args: { accessToken: string; locale: string }): { subject: string; html: string } {
  const s = emailStrings[localeOf(args.locale)];
  const url = `${env().NEXT_PUBLIC_APP_URL}/rsvp/h/${args.accessToken}`;
  return {
    subject: s.reminderSubject,
    html: emailShell({ heading: s.reminderHeading, body: s.reminderBody, cta: { label: s.reminderCta, url } }),
  };
}
