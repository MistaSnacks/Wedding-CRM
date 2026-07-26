"use server";

import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/admin-auth";
import { forWedding, type WeddingScope } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import * as comms from "@/lib/data/comms";
import { sendEmail, invitationHtml, reminderHtml, emailShell } from "@/lib/email/send";
import { emailStrings, localeOf } from "@/lib/email/strings";
import { reviewToken, splitRecipients, tokenMatches } from "@/lib/domain/campaign-review";
import type { CommType } from "@/lib/data/comms";
import type { HouseholdFilter, HouseholdRow } from "@/lib/types";

export type SendSummary = { sent: number; skippedNoEmail: number };

export type CampaignReview = {
  token: string;
  count: number;
  skippedNames: string[];
  previews: Array<{ locale: string; subject: string; html: string }>;
};

type Compose = {
  type: CommType;
  audience: HouseholdFilter | "not_responded";
  channel: "email" | "manual";
  customSubject: string;
  customBody: string;
};

function parseCompose(formData: FormData): Compose {
  return {
    type: String(formData.get("type") ?? "reminder") as CommType,
    audience: String(formData.get("audience") ?? "pending") as Compose["audience"],
    channel: String(formData.get("channel") ?? "email") as Compose["channel"],
    customSubject: String(formData.get("subject") ?? "").trim(),
    customBody: String(formData.get("body") ?? "").trim(),
  };
}

async function resolveAudience(scope: WeddingScope, audience: Compose["audience"]): Promise<HouseholdRow[]> {
  const filter: HouseholdFilter = audience === "not_responded" ? "pending" : (audience as HouseholdFilter);
  let targets = await households.search(scope, { filter, limit: 1000 });
  if (audience === "not_responded") {
    targets = targets.filter((h) => h.rsvp_status === "pending" || h.rsvp_status === "started");
  }
  return targets;
}

function renderFor(h: Pick<HouseholdRow, "access_token" | "invite_code" | "preferred_locale">, c: Compose): { subject: string; html: string } {
  if (c.type === "invitation") {
    return invitationHtml({ accessToken: h.access_token, inviteCode: h.invite_code, locale: h.preferred_locale });
  }
  if (c.type === "reminder") {
    return reminderHtml({ accessToken: h.access_token, locale: h.preferred_locale });
  }
  const s = emailStrings[localeOf(h.preferred_locale)];
  return {
    subject: c.customSubject || s.reminderSubject,
    html: emailShell({
      heading: c.customSubject || "A note from Juliet & Juan",
      body: c.customBody.replace(/\n/g, "<br/>"),
      cta: { label: s.reminderCta, url: `${process.env.NEXT_PUBLIC_APP_URL}/rsvp/h/${h.access_token}` },
    }),
  };
}

/** Computes who a campaign reaches and renders the exact email — sends nothing. */
export async function reviewCampaign(formData: FormData): Promise<CampaignReview> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const c = parseCompose(formData);

  const targets = await resolveAudience(scope, c.audience);
  const { emailable, skipped } = splitRecipients(targets);

  const seen = new Set<string>();
  const previews: CampaignReview["previews"] = [];
  for (const h of emailable) {
    const locale = localeOf(h.preferred_locale);
    if (seen.has(locale)) continue;
    seen.add(locale);
    previews.push({ locale, ...renderFor(h, c) });
  }
  // A campaign to zero emailable households still deserves a truthful review.
  if (!previews.length) {
    previews.push({
      locale: "en",
      ...renderFor({ access_token: "preview", invite_code: "XXXX-XXXX", preferred_locale: "en" }, c),
    });
  }

  return {
    token: reviewToken(emailable.length, c.audience, c.type),
    count: emailable.length,
    skippedNames: skipped.map((h) => h.display_name),
    previews,
  };
}

/** Sends the rendered campaign to the signed-in admin only; never recorded in History. */
export async function sendTestToMe(formData: FormData): Promise<void> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const c = parseCompose(formData);

  const targets = await resolveAudience(scope, c.audience);
  const sample =
    splitRecipients(targets).emailable[0] ??
    ({ access_token: "preview", invite_code: "XXXX-XXXX", preferred_locale: "en" } as HouseholdRow);
  const { subject, html } = renderFor(sample, c);
  await sendEmail({ to: admin.email, subject: `[Test] ${subject}`, html });
}

export async function sendCampaign(formData: FormData): Promise<void> {
  const admin = await requireEditor();
  const scope = forWedding(admin.weddingId);
  const c = parseCompose(formData);

  const targets = await resolveAudience(scope, c.audience);
  const { emailable } = splitRecipients(targets);

  // The send must match what was reviewed — if the audience changed in
  // between, push the admin back to review rather than surprising them.
  const token = String(formData.get("review_token") ?? "");
  if (c.channel === "email" && !tokenMatches(token, emailable.length, c.audience, c.type)) {
    throw new Error("This list changed since you reviewed it — please review the campaign again.");
  }

  const comm = await comms.create(scope, {
    type: c.type,
    channel: c.channel,
    subject: c.customSubject || undefined,
    audienceFilter: { audience: c.audience },
    sentBy: admin.userId,
    householdIds: targets.map((h) => h.id),
  });

  if (c.channel === "email") {
    for (const h of emailable) {
      const { subject, html } = renderFor(h, c);
      const { id } = await sendEmail({ to: h.email!, subject, html });
      if (id) await comms.setRecipientMessageId(scope, comm.id, h.id, id);
    }
  }

  revalidatePath("/admin/comms");
}
