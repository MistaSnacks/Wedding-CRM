"use client";
import { useLocale } from "next-intl";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const locale=useLocale();
  const copy=locale==='es'?["No pudimos cargar tu invitación.","Inténtalo de nuevo en un momento.","Intentar de nuevo"]:locale==='vi'?["Không thể tải lời mời của bạn.","Vui lòng thử lại sau giây lát.","Thử lại"]:["We couldn't load your invitation.","Please try again in a moment.","Try again"];
  return <div role="alert" className="mx-auto my-12 max-w-md rounded-xl bg-white p-6"><h1 className="text-xl">{copy[0]}</h1><p className="my-3">{copy[1]}</p><button onClick={reset} className="rounded-lg bg-olive-deep px-4 py-2 text-white">{copy[2]}</button></div>;
}
