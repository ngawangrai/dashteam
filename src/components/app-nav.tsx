"use client";

import { CircleUser, House, type LucideIcon, Users } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/db/schema";
import { Icon } from "./icon";

type NavItem = { href: Route; label: string; icon: LucideIcon; matches: (path: string) => boolean };

const home = (href: Route): NavItem => ({ href, label: "Home", icon: House, matches: (path) => path === href });
const people: NavItem = { href: "/admin/people", label: "People", icon: Users, matches: (path) => path.startsWith("/admin/people") };
const profile: NavItem = { href: "/profile", label: "Profile", icon: CircleUser, matches: (path) => path.startsWith("/profile") };

function itemsFor(role: AppRole): NavItem[] {
  return role === "admin" ? [home("/admin"), people, profile] : [home("/"), profile];
}

/** Laptop: a quiet sidebar. Icons always sit beside their label. */
export function SidebarNav({ role }: { role: AppRole }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {itemsFor(role).map((item) => {
        const active = item.matches(path);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="flex min-h-11 items-center gap-3 rounded-control px-3 text-body text-label transition-colors duration-150 hover:bg-fill aria-[current=page]:bg-fill aria-[current=page]:font-semibold"
          >
            <Icon icon={item.icon} size={20} className={active ? "text-accent" : "text-label-secondary"} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone: a tab bar at the bottom, in reach of the thumb. */
export function TabBarNav({ role }: { role: AppRole }) {
  const path = usePathname();
  const items = itemsFor(role);
  return (
    <nav
      aria-label="Main"
      className="bg-bar fixed inset-x-0 bottom-0 z-20 border-t border-separator/60 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 md:hidden"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = item.matches(path);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-caption text-label-secondary aria-[current=page]:text-accent"
              >
                <Icon icon={item.icon} size={24} strokeWidth={active ? 2 : 1.75} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
