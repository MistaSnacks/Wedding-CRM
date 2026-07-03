"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { forWedding } from "@/lib/data/scope";
import * as households from "@/lib/data/households";
import * as comms from "@/lib/data/comms";
import { sendEmail, invitationHtml, reminderHtml, emailShell } from "@/lib/email/send";
import { emailStrings, localeOf } from "@/lib/email/strings";
import type { CommType } from "@/lib/data/comms";
import type { HouseholdFilter } from "@/lib/types";

export type SendSummary = { sent: number; skippedNoEmail: number };

export async function sendCampaign(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const scope = forWedding(admin.weddingId);

  const type = String(formData.get("type") ?? "reminder") as CommType;
  const audience = String(formData.get("audience") ?? "pending") as HouseholdFilter | "not_responded";
  const channel = String(formData.get("channel") ?? "email") as "email" | "manual";
  const customSubject = String(formData.get("subject") ?? "").trim();
  const customBody = String(formData.get("body") ?? "").trim();

  const filter: HouseholdFilter = audience === "not_responded" ? "pending" : (audience as HouseholdFilter);
  let targets = await households.search(scope, { filter, limit: 1000 });
  if (audience === "not_responded") {
    targets = targets.filter((h) => h.rsvp_status === "pending" || h.rsvp_status === "started");
  }

  const comm = await comms.create(scope, {
    type,
    channel,
    subject: customSubject || undefined,
    audienceFilter: { audience },
    sentBy: admin.userId,
    householdIds: targets.map((h) => h.id),
  });

  if (channel === "email") {
    for (const h of targets) {
      if (!h.email) continue;
      let subject: string;
      let html: string;
      if (type === "invitation") {
        ({ subject, html } = invitationHtml({ accessToken: h.access_token, inviteCode: h.invite_code, locale: h.preferred_locale }));
      } else if (type === "reminder") {
        ({ subject, html } = reminderHtml({ accessToken: h.access_token, locale: h.preferred_locale }));
      } else {
        const s = emailStrings[localeOf(h.preferred_locale)];
        subject = customSubject || s.reminderSubject;
        html = emailShell({
          heading: customSubject || "A note from Juliet & Juan",
          body: customBody.replace(/\n/g, "<br/>"),
          cta: { label: s.reminderCta, url: `${process.env.NEXT_PUBLIC_APP_URL}/rsvp/h/${h.access_token}` },
        });
      }
      const { id } = await sendEmail({ to: h.email, subject, html });
      if (id) await comms.setRecipientMessageId(scope, comm.id, h.id, id);
    }
  }

  revalidatePath("/admin/comms");
}
