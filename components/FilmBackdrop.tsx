"use client";
import { useEffect, useState } from "react";
/** Static on admin/phones; video source is not mounted for reduced motion. */
export function FilmBackdrop({ animate = true }: { animate?: boolean }) {
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px) and (prefers-reduced-motion: no-preference)");
    const update = () => setPlay(animate && media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [animate]);
  return <>
    <div className="pointer-events-none fixed inset-0 bg-cover bg-center opacity-25" style={{ backgroundImage: "url(/video/hero-v5-poster.webp)" }} aria-hidden />
    {play && <video className="pointer-events-none fixed inset-0 h-full w-full object-cover opacity-25" autoPlay muted loop playsInline poster="/video/hero-v5-poster.webp" aria-hidden><source src="/video/hero-v5.mp4" type="video/mp4" /></video>}
  </>;
}
