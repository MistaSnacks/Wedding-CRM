"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type TourStep = { target: string; title: string; text: string };
type Placement = "top" | "bottom" | "inside";

/** A short walkthrough of anchored tooltips. Not modal: the page stays usable. */
export default function Tour({
  steps,
  onClose,
}: {
  steps: TourStep[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    arrow: number;
    placement: Placement;
  } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const step = steps[index];

  const target = () =>
    document.querySelector<HTMLElement>(`[data-tour="${step?.target}"]`);

  useLayoutEffect(() => {
    if (!step) return;
    const el = target();
    if (!el) {
      if (index < steps.length - 1) setIndex(index + 1);
      else onClose();
      return;
    }
    el.classList.add("venue-tour-target");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const place = () => {
      const r = el.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      const height = box.current?.offsetHeight ?? 160;
      const fitsBelow = r.bottom + height + 24 <= window.innerHeight;
      const fitsAbove = r.top - height - 24 >= 0;
      const placement: Placement = fitsBelow
        ? "bottom"
        : fitsAbove
          ? "top"
          : "inside";
      const left = Math.max(
        12,
        Math.min(
          window.innerWidth - width - 12,
          r.left + r.width / 2 - width / 2,
        ),
      );
      const top =
        placement === "bottom"
          ? r.bottom + 14
          : placement === "top"
            ? r.top - height - 14
            : Math.max(
                12,
                Math.min(r.top + 16, window.innerHeight - height - 12),
              );
      setPos({
        top: Math.max(12, top),
        left,
        placement,
        arrow: Math.max(20, Math.min(width - 20, r.left + r.width / 2 - left)),
      });
    };
    place();
    const tick = requestAnimationFrame(place);
    const timer = setTimeout(place, 450);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      el.classList.remove("venue-tour-target");
      cancelAnimationFrame(tick);
      clearTimeout(timer);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step?.target]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  if (!step) return null;
  const last = index === steps.length - 1;
  return (
    <div
      ref={box}
      className={`venue-tour is-${pos?.placement ?? "bottom"}`}
      style={{
        top: pos?.top ?? -1000,
        left: pos?.left ?? 12,
        ["--arrow" as string]: `${pos?.arrow ?? 40}px`,
        visibility: pos ? "visible" : "hidden",
      }}
      role="dialog"
      aria-label={`Tip ${index + 1} of ${steps.length}: ${step.title}`}
    >
      <strong>{step.title}</strong>
      <p>{step.text}</p>
      <div className="venue-tour-foot">
        <span>
          {index + 1} of {steps.length}
        </span>
        <div>
          {!last && (
            <button type="button" className="venue-tour-skip" onClick={onClose}>
              Skip
            </button>
          )}
          <button
            type="button"
            className="venue-tour-next"
            autoFocus
            onClick={() => (last ? onClose() : setIndex(index + 1))}
          >
            {last ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
