import { Resend } from "resend";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { env } from "@/lib/env";
import {
  emailStrings,
  emailText,
  hasWeddingFields,
  localeOf,
  resolveWeddingFields,
  type EmailWedding,
} from "./strings";

/**
 * Fills the wedding day, reply-by date and city in a finished email.
 * See the note on merge fields in `strings.ts`.
 */
export function resolveEmail<T extends { subject: string; html: string }>(mail: T, wedding: EmailWedding): T {
  return {
    ...mail,
    subject: resolveWeddingFields(mail.subject, wedding),
    html: resolveWeddingFields(mail.html, wedding, { html: true }),
  };
}

/**
 * All outbound email goes through sendEmail. With no RESEND_API_KEY the
 * rendered HTML is written to .emails/*.html (dev fallback) — never throws.
 *
 * This is also the last place a merge field can be filled. Mail from the
 * outbox arrives here already filled for its own wedding; a direct send (a
 * test email) that still carries one gets the values of the wedding guests see.
 * No guest is ever sent the text "[wedding date]".
 */
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  /** Overrides RESEND_REPLY_TO for this send (e.g. auth mail wants none). */
  replyTo?: string | null;
  idempotencyKey?: string;
  from?: string;
}): Promise<{ id: string | null }> {
  const e = env();
  if (hasWeddingFields(args.subject) || hasWeddingFields(args.html)) {
    const { getWeddingPublic } = await import("@/lib/data/wedding-public");
    args = resolveEmail(args, await getWeddingPublic());
  }
  if (!e.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") throw new Error("Email delivery is not configured.");
    const dir = path.join(process.cwd(), ".emails");
    await mkdir(dir, { recursive: true });
    const safe = args.subject.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
    const file = path.join(dir, `${Date.now()}-${safe}.html`);
    await writeFile(file, `<!-- to: ${args.to} -->\n${args.html}`);
    console.log(`[email:dev] wrote ${file}`);
    return { id: null };
  }
  const resend = new Resend(e.RESEND_API_KEY);
  const replyTo = args.replyTo === undefined ? e.RESEND_REPLY_TO : args.replyTo;
  const { data, error } = await resend.emails.send({
    from: args.from ?? e.RESEND_FROM,
    to: args.to,
    subject: args.subject,
    html: args.html,
    ...(replyTo ? { replyTo } : {}),
  }, args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined);
  if (error) throw new Error(`Email provider rejected delivery: ${error.message}`);
  if (!data?.id) throw new Error("Email provider returned no delivery identifier.");
  return { id: data.id };
}

/**
 * Shared shell: cream ground, serif heading, olive button. Inline styles only.
 *
 * The line under the card is the wedding day and the city, from the database.
 * Pass `wedding` to write them in now; without it the line carries merge fields
 * and delivery fills them. `locale` decides how the date is written.
 */
export function emailShell(opts: {
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  /** A second, quieter call to action under the button — e.g. hotel recommendations. */
  secondary?: { label: string; url: string };
  footer?: string;
  locale?: string | null;
  wedding?: EmailWedding | null;
}): string {
  const html = `<!doctype html>
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
  opts.secondary
    ? `<tr><td align="center" style="padding-bottom:24px;"><a href="${opts.secondary.url}" style="display:inline-block;border:1px solid #3b4823;color:#3b4823;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:12px 26px;border-radius:999px;">${opts.secondary.label}</a></td></tr>`
    : ""
}${
  opts.footer
    ? `<tr><td align="center" style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#8a8f86;">${opts.footer}</td></tr>`
    : ""
}
</table>
<table role="presentation" width="520"><tr><td align="center" style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#8a8f86;padding-top:16px;">${emailText(opts.locale, "footerLine")}</td></tr></table>
</td></tr></table></body></html>`;
  return opts.wedding ? resolveWeddingFields(html, opts.wedding, { html: true }) : html;
}

export async function sendVerificationEmail(args: { to: string; accessToken: string; locale: string }) {
  const s = emailStrings[localeOf(args.locale)];
  const url = `${env().NEXT_PUBLIC_APP_URL}/rsvp/h/${args.accessToken}`;
  return sendEmail({
    to: args.to,
    subject: s.verifySubject,
    html: emailShell({ heading: s.verifyHeading, body: s.verifyBody, cta: { label: s.verifyCta, url }, footer: s.verifyIgnore, locale: args.locale }),
  });
}

/**
 * The RSVP-received email. When the household asked for hotel recommendations,
 * the body says so and a second button sends them to the wedding site's
 * hotel page — the one place the couple maintains that list.
 */
export function confirmationHtml(args: {
  outcome?: "completed" | "declined";
  accessToken: string;
  locale: string;
  hotelRecsUrl?: string | null;
  /** The wedding's current values. Without them, delivery fills them in. */
  wedding?: EmailWedding | null;
}): { subject: string; html: string } {
  const s = emailStrings[localeOf(args.locale)];
  const text = (key: Parameters<typeof emailText>[1]) => emailText(args.locale, key, args.wedding, { html: true });
  const declined = { en: { heading: "Thank you for letting us know", body: "We have recorded that you cannot attend. We will miss you, and appreciate your reply." }, es: { heading: "Gracias por avisarnos", body: "Hemos registrado que no podrás asistir. Te extrañaremos y agradecemos tu respuesta." }, vi: { heading: "Cảm ơn bạn đã cho chúng tôi biết", body: "Chúng tôi đã ghi nhận rằng bạn không thể tham dự. Chúng tôi sẽ nhớ bạn và cảm ơn bạn đã phản hồi." } }[localeOf(args.locale)];
  const url = `${env().NEXT_PUBLIC_APP_URL}/rsvp/h/${args.accessToken}`;
  return {
    subject: s.confirmSubject,
    html: emailShell({
      heading: args.outcome === "declined" ? declined.heading : s.confirmHeading,
      body: args.outcome === "declined" ? declined.body : args.hotelRecsUrl ? `${text("confirmBody")}<br/><br/>${text("confirmHotelBody")}` : text("confirmBody"),
      cta: { label: s.confirmCta, url },
      secondary: args.outcome !== "declined" && args.hotelRecsUrl ? { label: s.confirmHotelCta, url: args.hotelRecsUrl } : undefined,
      footer: text("confirmEditNote"),
      locale: args.locale,
      wedding: args.wedding,
    }),
  };
}

export async function sendConfirmationEmail(args: {
  to: string;
  accessToken: string;
  locale: string;
  hotelRecsUrl?: string | null;
  wedding?: EmailWedding | null;
}) {
  const { subject, html } = confirmationHtml(args);
  return sendEmail({ to: args.to, subject, html });
}

export function invitationHtml(args: {
  accessToken: string;
  inviteCode: string;
  locale: string;
  /** The wedding's current values. Without them, delivery fills them in. */
  wedding?: EmailWedding | null;
}): { subject: string; html: string } {
  const s = emailStrings[localeOf(args.locale)];
  const url = `${env().NEXT_PUBLIC_APP_URL}/rsvp/h/${args.accessToken}`;
  return {
    subject: emailText(args.locale, "inviteSubject", args.wedding),
    html: emailShell({
      locale: args.locale,
      wedding: args.wedding,
      heading: s.inviteHeading,
      body: `${emailText(args.locale, "inviteBody", args.wedding, { html: true })}<br/><br/><span style="font-size:12px;letter-spacing:.1em;color:#8a8f86;">${s.inviteCodeLabel}</span><br/><span style="font-family:Georgia,serif;font-size:22px;letter-spacing:.2em;color:#1c231b;">${args.inviteCode}</span>`,
      cta: { label: s.inviteCta, url },
    }),
  };
}

export function reminderHtml(args: {
  accessToken: string;
  locale: string;
  /** The wedding's current values. Without them, delivery fills them in. */
  wedding?: EmailWedding | null;
}): { subject: string; html: string } {
  const s = emailStrings[localeOf(args.locale)];
  const url = `${env().NEXT_PUBLIC_APP_URL}/rsvp/h/${args.accessToken}`;
  return {
    subject: s.reminderSubject,
    html: emailShell({
      heading: s.reminderHeading,
      body: emailText(args.locale, "reminderBody", args.wedding, { html: true }),
      cta: { label: s.reminderCta, url },
      locale: args.locale,
      wedding: args.wedding,
    }),
  };
}

/** Plain text is escaped before entering an HTML template. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"\']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\'": "&#39;" }[c]!));
}
