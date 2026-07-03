import type { Locale } from "@/lib/types";

/** Localized strings for transactional emails. */
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
    inviteSubject: string;
    inviteHeading: string;
    inviteBody: string;
    inviteCta: string;
    inviteCodeLabel: string;
    reminderSubject: string;
    reminderHeading: string;
    reminderBody: string;
    reminderCta: string;
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
    confirmBody: "Your response for Juliet & Juan's wedding on June 12, 2027 has been recorded.",
    confirmEditNote: "Need to make a change? You can edit your response any time before April 12, 2027 using your RSVP link.",
    confirmCta: "View or edit my RSVP",
    inviteSubject: "You're invited — Juliet & Juan, June 12, 2027",
    inviteHeading: "Juliet & Juan are getting married",
    inviteBody: "We would be honored to have you with us in Tulum, México on June 12, 2027. Please RSVP by April 12, 2027.",
    inviteCta: "RSVP now",
    inviteCodeLabel: "Your invitation code",
    reminderSubject: "A gentle reminder to RSVP — Juliet & Juan",
    reminderHeading: "We'd love to hear from you",
    reminderBody: "Just a friendly reminder to let us know if you can join Juliet & Juan on June 12, 2027. RSVPs close April 12, 2027.",
    reminderCta: "RSVP now",
  },
  es: {
    verifySubject: "Tu enlace de RSVP — Juliet & Juan",
    verifyHeading: "Aquí está tu enlace de RSVP",
    verifyBody: "Alguien (¡esperamos que tú!) buscó tu invitación para la boda de Juliet & Juan. Usa el botón para abrir tu RSVP.",
    verifyCta: "Abrir mi RSVP",
    verifyIgnore: "Si no fuiste tú, puedes ignorar este correo.",
    confirmSubject: "RSVP recibido — Juliet & Juan",
    confirmHeading: "¡Gracias — recibimos tu confirmación!",
    confirmBody: "Tu respuesta para la boda de Juliet & Juan el 12 de junio de 2027 ha sido registrada.",
    confirmEditNote: "¿Necesitas hacer un cambio? Puedes editar tu respuesta hasta el 12 de abril de 2027 con tu enlace de RSVP.",
    confirmCta: "Ver o editar mi RSVP",
    inviteSubject: "Estás invitado — Juliet & Juan, 12 de junio de 2027",
    inviteHeading: "Juliet & Juan se casan",
    inviteBody: "Sería un honor tenerte con nosotros en Tulum, México el 12 de junio de 2027. Por favor confirma antes del 12 de abril de 2027.",
    inviteCta: "Confirmar asistencia",
    inviteCodeLabel: "Tu código de invitación",
    reminderSubject: "Un recordatorio amable — Juliet & Juan",
    reminderHeading: "Nos encantaría saber de ti",
    reminderBody: "Un recordatorio amistoso para confirmarnos si puedes acompañar a Juliet & Juan el 12 de junio de 2027. Las confirmaciones cierran el 12 de abril de 2027.",
    reminderCta: "Confirmar asistencia",
  },
  vi: {
    verifySubject: "Liên kết phản hồi của bạn — Juliet & Juan",
    verifyHeading: "Đây là liên kết phản hồi của bạn",
    verifyBody: "Ai đó (hy vọng là bạn!) đã tìm thiệp mời của bạn cho đám cưới của Juliet & Juan. Nhấn nút bên dưới để mở trang phản hồi.",
    verifyCta: "Mở trang phản hồi",
    verifyIgnore: "Nếu không phải bạn, bạn có thể bỏ qua email này.",
    confirmSubject: "Đã nhận phản hồi — Juliet & Juan",
    confirmHeading: "Cảm ơn — chúng tôi đã nhận được phản hồi của bạn!",
    confirmBody: "Phản hồi của bạn cho đám cưới của Juliet & Juan ngày 12 tháng 6, 2027 đã được ghi nhận.",
    confirmEditNote: "Cần thay đổi? Bạn có thể chỉnh sửa phản hồi bất cứ lúc nào trước ngày 12 tháng 4, 2027 bằng liên kết của bạn.",
    confirmCta: "Xem hoặc chỉnh sửa phản hồi",
    inviteSubject: "Trân trọng kính mời — Juliet & Juan, 12/06/2027",
    inviteHeading: "Juliet & Juan sắp kết hôn",
    inviteBody: "Chúng tôi rất hân hạnh được đón tiếp bạn tại Tulum, México vào ngày 12 tháng 6, 2027. Vui lòng phản hồi trước ngày 12 tháng 4, 2027.",
    inviteCta: "Phản hồi ngay",
    inviteCodeLabel: "Mã thiệp mời của bạn",
    reminderSubject: "Nhắc nhở nhẹ nhàng — Juliet & Juan",
    reminderHeading: "Chúng tôi mong tin bạn",
    reminderBody: "Một lời nhắc thân thiện: hãy cho chúng tôi biết bạn có thể tham dự cùng Juliet & Juan ngày 12 tháng 6, 2027 không. Hạn phản hồi là 12 tháng 4, 2027.",
    reminderCta: "Phản hồi ngay",
  },
};

export function localeOf(input: string | null | undefined): Locale {
  return input === "es" || input === "vi" ? input : "en";
}
