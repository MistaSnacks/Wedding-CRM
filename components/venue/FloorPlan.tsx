"use client";
import { useState } from "react";
import { clampPosition, type LayoutTable } from "@/lib/venue/model";
import type { DropPreview } from "./drag";

export default function FloorPlan({
  tables,
  selected,
  canMove,
  onSelect,
  onMove,
  dropPreview,
}: {
  tables: LayoutTable[];
  selected: string;
  /** Arrange mode: tables can be dragged. Otherwise a press only selects. */
  canMove: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, z: number) => void;
  dropPreview: DropPreview;
}) {
  const [drag, setDrag] = useState<{
    id: string;
    ox: number;
    oz: number;
    x: number;
    z: number;
  } | null>(null);
  function point(e: React.PointerEvent<SVGSVGElement>) {
    const matrix = e.currentTarget.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
  }
  return (
    <svg
      className="venue-plan"
      viewBox="-15.5 -16 31 32"
      aria-label="Reception floor plan"
      onPointerDown={(e) => {
        const id = (e.target as Element)
          .closest("[data-table]")
          ?.getAttribute("data-table");
        const t = tables.find((t) => t.id === id),
          p = point(e);
        if (!t || !p) return;
        onSelect(t.id);
        if (!canMove) return;
        setDrag({ id: t.id, ox: t.x - p.x, oz: t.z - p.y, x: t.x, z: t.z });
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = point(e),
          t = tables.find((t) => t.id === drag.id);
        if (p && t) {
          const pos = clampPosition(t, p.x + drag.ox, p.y + drag.oz);
          setDrag({ ...drag, ...pos });
        }
      }}
      onPointerUp={() => {
        if (drag) onMove(drag.id, drag.x, drag.z);
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <defs>
        <pattern
          id="venue-grid"
          width="1"
          height="1"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 1 0 L 0 0 0 1"
            fill="none"
            stroke="#d6dbd0"
            strokeWidth=".025"
          />
        </pattern>
      </defs>
      <rect
        x="-14"
        y="-14"
        width="28"
        height="28"
        fill="#f8f8f0"
        stroke="#667760"
        strokeWidth=".12"
      />
      <rect x="-14" y="-14" width="28" height="28" fill="url(#venue-grid)" />
      <text x="0" y="-15" textAnchor="middle" fontSize=".6" fill="#586453">
        Entrance side
      </text>
      <rect
        x="-4.5"
        y="-2"
        width="9"
        height="4"
        fill="#e8ddc6"
        stroke="#bda77f"
        strokeDasharray=".15 .15"
        strokeWidth=".04"
      />
      <text x="0" y=".2" textAnchor="middle" fontSize=".45" fill="#806e4f">
        Dance floor
      </text>
      {tables.map((t) => {
        const p = drag?.id === t.id ? drag : t;
        const fill =
          dropPreview?.id === t.id
            ? dropPreview.valid
              ? "#80b28c"
              : "#d48a79"
            : selected === t.id
              ? "#c39655"
              : "#f0e8d9";
        return (
          <g
            key={t.id}
            data-table={t.id}
            transform={`translate(${p.x} ${p.z})`}
            role="button"
            tabIndex={0}
            aria-label={`${t.name}, ${t.guestIds.length} of ${t.capacity} seats taken`}
            aria-pressed={selected === t.id}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(t.id);
              }
            }}
            style={{ cursor: canMove ? "grab" : "pointer" }}
          >
            <g transform={`rotate(${t.rotation})`}>
              {Array.from({ length: t.capacity }, (_, i) => {
                const a = (i / t.capacity) * Math.PI * 2;
                return (
                  <circle
                    key={i}
                    cx={Math.sin(a) * (t.width / 2 + 0.38)}
                    cy={Math.cos(a) * (t.depth / 2 + 0.38)}
                    r=".2"
                    fill={i < t.guestIds.length ? "#728b7c" : "#d5cbb9"}
                  />
                );
              })}
              {t.shape === "round" ? (
                <circle
                  r={t.width / 2}
                  fill={fill}
                  stroke="#8b795e"
                  strokeWidth=".04"
                />
              ) : (
                <rect
                  x={-t.width / 2}
                  y={-t.depth / 2}
                  width={t.width}
                  height={t.depth}
                  fill={fill}
                  stroke="#8b795e"
                  strokeWidth=".04"
                />
              )}
            </g>
            <text
              textAnchor="middle"
              y="-.05"
              fontSize=".5"
              fontWeight="600"
              fill="#26392c"
              stroke="#f7f3ea"
              strokeWidth=".12"
              paintOrder="stroke"
              pointerEvents="none"
            >
              {t.name}
            </text>
            <text
              textAnchor="middle"
              y=".5"
              fontSize=".4"
              fill="#4c5a4a"
              stroke="#f7f3ea"
              strokeWidth=".1"
              paintOrder="stroke"
              pointerEvents="none"
            >
              {t.guestIds.length}/{t.capacity}
            </text>
          </g>
        );
      })}
      <text x="0" y="15.5" textAnchor="middle" fontSize=".45" fill="#586453">
        Lake side
      </text>
    </svg>
  );
}
