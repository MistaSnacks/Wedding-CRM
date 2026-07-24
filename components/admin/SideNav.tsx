"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavItem = { href: string; label: string; icon: ReactNode; ownerOnly?: boolean };

const NAV: NavItem[] = [
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
    href: "/admin/guests",
    label: "Guests",
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
    href: "/admin/comms",
    label: "Communications",
    icon: (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </>
    ),
  },
  {
    href: "/admin/imports",
    label: "Imports & Exports",
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
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  },
];

export function SideNav({
  collapsed = false,
  role,
}: {
  collapsed?: boolean;
  role: "owner" | "editor" | "viewer";
}) {
  const pathname = usePathname();
  return (
    <nav className={`flex flex-col gap-0.5 ${collapsed ? "items-center" : ""}`}>
      {NAV.filter((item) => !item.ownerOnly || role === "owner").map((item) => {
        const active =
          item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            title={collapsed ? item.label : undefined}
            className={`flex items-center rounded-lg text-[13.5px] transition-colors duration-150 ${
              collapsed ? "h-10 w-10 justify-center" : "gap-2.5 px-3 py-2.5"
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
            >
              {item.icon}
            </svg>
            {!collapsed && <span>{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
