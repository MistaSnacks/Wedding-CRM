"use client";

import { useEffect, useState } from "react";
import { SideNav } from "@/components/admin/SideNav";
import { signOut } from "@/app/admin/login/actions";

const STORAGE_KEY = "admin-sidebar-collapsed";

export function AdminSidebar({
  coupleNames,
  dateLabel,
  role,
}: {
  coupleNames: string;
  dateLabel: string | null;
  role: "owner" | "editor" | "viewer";
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Restore the last choice after hydration (default matches the server render).
  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const monogram = coupleNames.trim().charAt(0).toUpperCase() || "W";

  return (
    <aside
      className={`relative z-10 flex flex-shrink-0 flex-col overflow-hidden border-r border-[#e9e7da]/70 bg-paper/55 py-7 backdrop-blur-md transition-[width] duration-300 ease-out no-print ${
        collapsed ? "w-[68px] items-center gap-6 px-3" : "w-[236px] gap-7 px-5"
      }`}
    >
      {/* Collapse / expand toggle */}
      <div className={`flex ${collapsed ? "justify-center" : "justify-end"}`}>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sage-band hover:text-olive-deep"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`}
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      </div>

      {/* Brand */}
      {collapsed ? (
        <span className="font-display text-2xl font-semibold text-ink">{monogram}</span>
      ) : (
        <div className="px-2">
          <p className="font-display text-2xl font-semibold text-ink">{coupleNames}</p>
          {dateLabel && <p className="mt-0.5 text-xs font-medium text-muted">{dateLabel}</p>}
        </div>
      )}

      <SideNav collapsed={collapsed} role={role} />

      <form action={signOut} className={`mt-auto ${collapsed ? "flex justify-center" : "px-2"}`}>
        {collapsed ? (
          <button
            aria-label="Sign out"
            title="Sign out"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sage-band hover:text-rose"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        ) : (
          <button className="text-xs font-medium text-muted underline-offset-2 hover:text-rose hover:underline">
            Sign out
          </button>
        )}
      </form>
    </aside>
  );
}
