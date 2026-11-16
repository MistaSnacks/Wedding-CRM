import { getLocale } from "next-intl/server";
export default async function Loading() { const locale=await getLocale();return <p role="status" className="p-8 text-center text-sm">{locale==='es'?"Cargando tu invitación…":locale==='vi'?"Đang tải lời mời của bạn…":"Loading your invitation…"}</p>; }
