import type { Locale } from "@/lib/types";
import type { WeddingFacts } from "@/lib/domain/wedding-details";
import { DEFAULT_LOCATION_LINE } from "@/lib/domain/wedding-details";
import { formatCalendarDate, formatInstantDay } from "@/lib/format/wedding-date";

/**
 * Localized strings for transactional emails.
 *
 * No string here contains a real date or city. The wedding day, the reply-by
 * date and the city come from the `weddings` row, so the couple can change them
 * in the admin and no developer edits this file. A string marks where a value
 * goes:
 *
 * - `{date}` is the wedding day, written in the email's language.
 * - `{deadline}` is the reply-by date, written in the email's language.
 * - `{place}` is the city line, for example "Guadalajara, México".
 * - `[[ ... ]]` is an optional part. It is dropped when a value inside it does
 *   not exist, so an invitation with no deadline does not say "RSVP by".
 *
 * Use `emailText` to read a string. Do not read `emailStrings` directly for a
 * string that has one of these marks.
 */
export const emailStrings: Record<
  Locale,
  {
    verifySubject: string;
    verifyHeading: string;
    verifyBody: string;
    verifyCta: string;
    verifyIgnore: string;
    confirmSubject: string;
    confirmHeading: string;
    confirmBody: string;
    confirmEditNote: string;
    confirmCta: string;
    confirmHotelBody: string;
    confirmHotelCta: string;
    inviteSubject: string;
    inviteHeading: string;
    inviteBody: string;
    inviteCta: string;
    inviteCodeLabel: string;
    reminderSubject: string;
    reminderHeading: string;
    reminderBody: string;
    reminderCta: string;
    footerLine: string;
  }
> = {
  en: {
    verifySubject: "Your RSVP link — Juliet & Juan",
    verifyHeading: "Here's your RSVP link",
    verifyBody: "Someone (hopefully you!) looked up your invitation for Juliet & Juan's wedding. Use the button below to open your RSVP.",
    verifyCta: "Open my RSVP",
    verifyIgnore: "If this wasn't you, you can safely ignore this email.",
    confirmSubject: "RSVP received — Juliet & Juan",
    confirmHeading: "Thank you — we've got your RSVP!",
    confirmBody: "Your response for Juliet & Juan's wedding[[ on {date}]] has been recorded.",
    confirmEditNote: "Need to make a change? You can edit your response any time[[ before {deadline}]] using your RSVP link.",
    confirmCta: "View or edit my RSVP",
    confirmHotelBody: "You mentioned you'd like hotel recommendations — we've put together our picks for where to stay in {place}.",
    confirmHotelCta: "See hotel recommendations",
    inviteSubject: "You're invited — Juliet & Juan[[, {date}]]",
    inviteHeading: "Juliet & Juan are getting married",
    inviteBody: "We would be honored to have you with us in {place}[[ on {date}]].[[ Please RSVP by {deadline}.]]",
    inviteCta: "RSVP now",
    inviteCodeLabel: "Your invitation code",
    reminderSubject: "A gentle reminder to RSVP — Juliet & Juan",
    reminderHeading: "We'd love to hear from you",
    reminderBody: "Just a friendly reminder to let us know if you can join Juliet & Juan[[ on {date}]].[[ RSVPs close {deadline}.]]",
    reminderCta: "RSVP now",
    footerLine: "[[{date} · ]]{place}",
  },
  es: {
    verifySubject: "Tu enlace de RSVP — Juliet & Juan",
    verifyHeading: "Aquí está tu enlace de RSVP",
    verifyBody: "Alguien (¡esperamos que tú!) buscó tu invitación para la boda de Juliet & Juan. Usa el botón para abrir tu RSVP.",
    verifyCta: "Abrir mi RSVP",
    verifyIgnore: "Si no fuiste tú, puedes ignorar este correo.",
    confirmSubject: "RSVP recibido — Juliet & Juan",
    confirmHeading: "¡Gracias — recibimos tu confirmación!",
    confirmBody: "Tu respuesta para la boda de Juliet & Juan[[ el {date}]] ha sido registrada.",
    confirmEditNote: "¿Necesitas hacer un cambio? Puedes editar tu respuesta[[ hasta el {deadline}]] con tu enlace de RSVP.",
    confirmCta: "Ver o editar mi RSVP",
    confirmHotelBody: "Nos dijiste que te gustaría recibir recomendaciones de hotel — aquí están nuestras sugerencias de dónde hospedarte en {place}.",
    confirmHotelCta: "Ver recomendaciones de hotel",
    inviteSubject: "Estás invitado — Juliet & Juan[[, {date}]]",
    inviteHeading: "Juliet & Juan se casan",
    inviteBody: "Sería un honor tenerte con nosotros en {place}[[ el {date}]].[[ Por favor confirma antes del {deadline}.]]",
    inviteCta: "Confirmar asistencia",
    inviteCodeLabel: "Tu código de invitación",
    reminderSubject: "Un recordatorio amable — Juliet & Juan",
    reminderHeading: "Nos encantaría saber de ti",
    reminderBody: "Un recordatorio amistoso para confirmarnos si puedes acompañar a Juliet & Juan[[ el {date}]].[[ Las confirmaciones cierran el {deadline}.]]",
    reminderCta: "Confirmar asistencia",
    footerLine: "[[{date} · ]]{place}",
  },
  vi: {
    verifySubject: "Liên kết phản hồi của bạn — Juliet & Juan",
    verifyHeading: "Đây là liên kết phản hồi của bạn",
    verifyBody: "Ai đó (hy vọng là bạn!) đã tìm thiệp mời của bạn cho đám cưới của Juliet & Juan. Nhấn nút bên dưới để mở trang phản hồi.",
    verifyCta: "Mở trang phản hồi",
    verifyIgnore: "Nếu không phải bạn, bạn có thể bỏ qua email này.",
    confirmSubject: "Đã nhận phản hồi — Juliet & Juan",
    confirmHeading: "Cảm ơn — chúng tôi đã nhận được phản hồi của bạn!",
    confirmBody: "Phản hồi của bạn cho đám cưới của Juliet & Juan[[ ngày {date}]] đã được ghi nhận.",
    confirmEditNote: "Cần thay đổi? Bạn có thể chỉnh sửa phản hồi bất cứ lúc nào[[ trước ngày {deadline}]] bằng liên kết của bạn.",
    confirmCta: "Xem hoặc chỉnh sửa phản hồi",
    confirmHotelBody: "Bạn cho biết muốn nhận gợi ý khách sạn — chúng tôi đã chọn sẵn vài nơi lưu trú ở {place} cho bạn.",
    confirmHotelCta: "Xem gợi ý khách sạn",
    inviteSubject: "Trân trọng kính mời — Juliet & Juan[[, ngày {date}]]",
    inviteHeading: "Juliet & Juan sắp kết hôn",
    inviteBody: "Chúng tôi rất hân hạnh được đón tiếp bạn tại {place}[[ vào ngày {date}]].[[ Vui lòng phản hồi trước ngày {deadline}.]]",
    inviteCta: "Phản hồi ngay",
    inviteCodeLabel: "Mã thiệp mời của bạn",
    reminderSubject: "Nhắc nhở nhẹ nhàng — Juliet & Juan",
    reminderHeading: "Chúng tôi mong tin bạn",
    reminderBody: "Một lời nhắc thân thiện: hãy cho chúng tôi biết bạn có thể tham dự cùng Juliet & Juan[[ ngày {date}]] không.[[ Hạn phản hồi là {deadline}.]]",
    reminderCta: "Phản hồi ngay",
    footerLine: "[[{date} · ]]{place}",
  },
};

export type EmailStringKey = keyof (typeof emailStrings)["en"];

export function localeOf(input: string | null | undefined): Locale {
  return input === "es" || input === "vi" ? input : "en";
}

/** The wedding values an email shows. A `WeddingFacts` object fits. */
export type EmailWedding = Pick<WeddingFacts, "weddingDate" | "rsvpDeadline" | "timeZone" | "locationLine">;

type Field = "date" | "deadline" | "place";
const FIELDS: Field[] = ["date", "deadline", "place"];
const LOCALES: Locale[] = ["en", "es", "vi"];

/**
 * Merge fields: the text that stands in for a wedding value until the email
 * knows the real one.
 *
 * An email is often written before it is sent: a campaign waits for review, a
 * reminder template is saved once and used for months, a confirmation waits in
 * the outbox. If the real date went in at writing time, a later change to the
 * wedding day would leave the old date in that mail. So a builder that is not
 * given the wedding writes a merge field, and delivery puts the current value
 * in (`processOutbox` and `sendEmail`). The words differ for each language so
 * the value is written in the language of the email around it.
 */
const MERGE_FIELDS: Record<Locale, Record<Field, string>> = {
  en: { date: "[wedding date]", deadline: "[reply-by date]", place: "[wedding place]" },
  es: { date: "[fecha de la boda]", deadline: "[fecha límite]", place: "[lugar de la boda]" },
  vi: { date: "[ngày cưới]", deadline: "[hạn phản hồi]", place: "[nơi tổ chức]" },
};

const OPTIONAL_PART = /\[\[(.*?)\]\]/g;

function withMergeFields(template: string, locale: Locale): string {
  return template
    .replace(OPTIONAL_PART, "$1")
    .replace(/\{(date|deadline|place)\}/g, (_, field: Field) => MERGE_FIELDS[locale][field]);
}

/** Every optional part of every string, already written with merge fields. Longest first. */
const OPTIONAL_PARTS: Record<Locale, string[]> = (() => {
  const out = {} as Record<Locale, string[]>;
  for (const locale of LOCALES) {
    const parts = new Set<string>();
    for (const template of Object.values(emailStrings[locale])) {
      for (const match of template.matchAll(OPTIONAL_PART)) parts.add(withMergeFields(match[1], locale));
    }
    out[locale] = [...parts].sort((a, b) => b.length - a.length);
  }
  return out;
})();

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** True when `text` still has a merge field that delivery must fill. */
export function hasWeddingFields(text: string): boolean {
  return LOCALES.some((locale) => FIELDS.some((field) => text.includes(MERGE_FIELDS[locale][field])));
}

/**
 * Puts the wedding's current values in place of the merge fields.
 *
 * A value that does not exist takes its optional part with it: with no reply-by
 * date the sentence "Please RSVP by ..." is removed whole, not left as "by ".
 * Pass `html: true` for an email body, so a city such as "Tom & Jerry's" is
 * escaped. A subject line is plain text and is not.
 */
export function resolveWeddingFields(text: string, wedding: EmailWedding, opts: { html?: boolean } = {}): string {
  if (!hasWeddingFields(text)) return text;
  const place = wedding.locationLine.trim() || DEFAULT_LOCATION_LINE;
  let out = text;
  for (const locale of LOCALES) {
    const values: Record<Field, string | null> = {
      date: formatCalendarDate(wedding.weddingDate, locale),
      deadline: formatInstantDay(wedding.rsvpDeadline, wedding.timeZone, locale),
      place: opts.html ? escapeText(place) : place,
    };
    for (const field of FIELDS) {
      if (values[field] !== null) continue;
      for (const part of OPTIONAL_PARTS[locale]) {
        if (part.includes(MERGE_FIELDS[locale][field])) out = out.split(part).join("");
      }
    }
    for (const field of FIELDS) out = out.split(MERGE_FIELDS[locale][field]).join(values[field] ?? "");
  }
  return out;
}

/**
 * One email string in one language.
 *
 * With `wedding`, the real date, deadline and city are written in. Without it,
 * the string carries merge fields and delivery fills them. `html` is for a
 * string that goes into the email body; leave it off for a subject line.
 */
export function emailText(
  locale: string | null | undefined,
  key: EmailStringKey,
  wedding?: EmailWedding | null,
  opts: { html?: boolean } = {},
): string {
  const l = localeOf(locale);
  const text = withMergeFields(emailStrings[l][key], l);
  return wedding ? resolveWeddingFields(text, wedding, opts) : text;
}
