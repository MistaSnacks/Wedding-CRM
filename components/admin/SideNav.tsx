"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/guests", label: "Guests" },
  { href: "/admin/seating", label: "Seating" },
  { href: "/admin/meals", label: "Meals" },
  { href: "/admin/comms", label: "Communications" },
  { href: "/admin/imports", label: "Imports & Exports" },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active =
          item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-2.5 text-[13.5px] transition-colors duration-150 ${
              active
                ? "bg-olive-deep font-semibold text-cream"
                : "font-medium text-[#4a5147] hover:bg-sage-band hover:text-olive-deep"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
