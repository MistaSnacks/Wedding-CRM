"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavItem = { href: string; label: string; icon: ReactNode; ownerOnly?: boolean; editorOnly?: boolean };
type NavGroup = { heading: string | null; items: NavItem[] };

/*
 * The menu follows the order a couple plans in: see where things stand, then
 * people, then money, then sending. Each group has a plain heading so a
 * bridesmaid who opens this for the first time can guess where a thing lives.
 */
const GROUPS: NavGroup[] = [
  {
    heading: null,
    items: [
      {
        href: "/admin",
        label: "Overview",
        icon: (
          <>
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </>
        ),
      },
      {
        href: "/admin/attention",
        label: "To do",
        icon: (
          <>
            <path d="M9 11l3 3 8-8" />
            <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
          </>
        ),
      },
    ],
  },
  {
    heading: "Guests",
    items: [
      {
        href: "/admin/guests",
        label: "Guest list",
        icon: (
          <>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </>
        ),
      },
      {
        href: "/admin/events",
        label: "Events & dates",
        editorOnly: true,
        icon: (
          <>
            <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
            <path d="M3 9.5h18" />
            <path d="M8 2.5v4" />
            <path d="M16 2.5v4" />
          </>
        ),
      },
      {
        href: "/admin/meals",
        label: "Meals",
        icon: (
          <>
            <path d="M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2" />
            <path d="M7 2v20" />
            <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
          </>
        ),
      },
      {
        href: "/admin/seating",
        label: "Seating",
        icon: (
          <>
            <path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3" />
            <path d="M3 11v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z" />
            <path d="M5 18v2" />
            <path d="M19 18v2" />
          </>
        ),
      },
      {
        href: "/venue-preview",
        label: "3D venue",
        icon: (
          <>
            <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
            <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
          </>
        ),
      },
      {
        href: "/admin/reports",
        label: "Reports",
        icon: (
          <>
            <path d="M4 20V10" />
            <path d="M10 20V4" />
            <path d="M16 20v-7" />
            <path d="M22 20H2" />
          </>
        ),
      },
    ],
  },
  {
    heading: "Money & vendors",
    items: [
      {
        href: "/admin/budget",
        label: "Budget",
        icon: (
          <>
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v1.5" />
            <rect x="3" y="7.5" width="18" height="12" rx="2.5" />
            <path d="M16.5 13.5h2.5" />
          </>
        ),
      },
      {
        href: "/admin/vendors",
        label: "Vendors",
        icon: <path d="M3 21h18V7H3zM8 7V3h8v4M3 12h18" />,
      },
      {
        href: "/admin/documents",
        label: "Documents",
        icon: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5" />,
      },
    ],
  },
  {
    heading: "Send & share",
    items: [
      {
        href: "/admin/comms",
        label: "Emails",
        icon: (
          <>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </>
        ),
      },
      {
        href: "/admin/imports",
        label: "Import & export",
        icon: (
          <>
            <path d="m3 16 4 4 4-4" />
            <path d="M7 20V4" />
            <path d="m21 8-4-4-4 4" />
            <path d="M17 4v16" />
          </>
        ),
      },
      {
        href: "/admin/team",
        label: "Team",
        ownerOnly: true,
        icon: (
          <>
            <circle cx="8" cy="15" r="4" />
            <path d="M11 12l9-9" />
            <path d="M16 7l3 3" />
          </>
        ),
      },
    ],
  },
];

/** The longest matching link wins, so /admin/vendors/tasks lights up Vendors only. */
function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const group of GROUPS)
    for (const item of group.items) {
      const match =
        item.href === "/admin" ? pathname === "/admin" : pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (match && (!best || item.href.length > best.length)) best = item.href;
    }
  return best;
}

export function SideNav({
  collapsed = false,
  role,
}: {
  collapsed?: boolean;
  role: "owner" | "editor" | "viewer";
}) {
  const pathname = usePathname();
  const current = activeHref(pathname);
  return (
    <nav aria-label="Planning sections" className={`flex flex-col ${collapsed ? "items-center gap-2" : "gap-4"}`}>
      {GROUPS.map((group, index) => {
        const items = group.items.filter(
          (item) => (!item.ownerOnly || role === "owner") && (!item.editorOnly || role !== "viewer"),
        );
        if (!items.length) return null;
        return (
          <div key={group.heading ?? "top"} className={`flex flex-col gap-0.5 ${collapsed ? "items-center" : ""}`}>
            {group.heading &&
              (collapsed ? (
                index > 0 && <span aria-hidden className="mb-1.5 h-px w-6 bg-[#dcdccd]" />
              ) : (
                <p className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">
                  {group.heading}
                </p>
              ))}
            {items.map((item) => {
              const active = item.href === current;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center rounded-lg text-[13.5px] transition-colors duration-150 ${
                    collapsed ? "h-10 w-10 justify-center" : "gap-2.5 px-3 py-2"
                  } ${
                    active
                      ? "bg-olive-deep font-semibold text-cream"
                      : "font-medium text-[#4a5147] hover:bg-sage-band hover:text-olive-deep"
                  }`}
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
                    className="shrink-0"
                    aria-hidden
                  >
                    {item.icon}
                  </svg>
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
