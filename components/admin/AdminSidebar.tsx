"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Restore the last choice after hydration (default matches the server render).
  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  // Navigating closes the phone drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const monogram = coupleNames.trim().charAt(0).toUpperCase() || "W";

  return (
    <>
    {/* Phone: hamburger sits over the header bar; the rail below is hidden. */}
    <button
      type="button"
      onClick={() => setDrawerOpen(true)}
      aria-label="Open menu"
      className="fixed left-3 top-2.5 z-30 flex h-9 w-9 items-center justify-center rounded-lg text-ink md:hidden no-print"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
    {drawerOpen && (
      <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-label="Menu">
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
          className="absolute inset-0 bg-black/30"
        />
        <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-7 overflow-y-auto bg-paper px-5 py-7 shadow-[0_0_40px_rgba(0,0,0,0.2)]">
          <div className="px-2">
            <p className="font-display text-2xl font-semibold text-ink">{coupleNames}</p>
            {dateLabel && <p className="mt-0.5 text-xs font-medium text-muted">{dateLabel}</p>}
          </div>
          <SideNav collapsed={false} role={role} />
          <form action={signOut} className="mt-auto px-2">
            <button className="text-xs font-medium text-muted underline-offset-2 hover:text-rose hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </div>
    )}
    <aside
      className={`relative z-10 flex flex-shrink-0 flex-col overflow-hidden border-r border-[#e9e7da]/70 bg-paper/55 py-7 backdrop-blur-md transition-[width] duration-300 ease-out no-print max-md:hidden ${
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
    </>
  );
}
