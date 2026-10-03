"use client";

import { CalendarDays, CircleUser, House, type LucideIcon, Palmtree, Users } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/lib/db/schema";
import { Icon } from "./icon";

type NavItem = { href: Route; label: string; icon: LucideIcon; matches: (path: string) => boolean; badge?: "home" | "leave" };

/** In-app indicators: how many things wait for the admin, and whether a leave decision is unseen. */
export type NavBadges = { home: number; leave: number };

const home = (href: Route): NavItem => ({ href, label: "Home", icon: House, matches: (path) => path === href, badge: "home" });
const leave: NavItem = { href: "/leave", label: "Leave", icon: Palmtree, matches: (path) => path.startsWith("/leave"), badge: "leave" };
const calendar: NavItem = { href: "/admin/calendar", label: "Calendar", icon: CalendarDays, matches: (path) => path.startsWith("/admin/calendar") };
const people: NavItem = { href: "/admin/people", label: "People", icon: Users, matches: (path) => path.startsWith("/admin/people") };
const profile: NavItem = { href: "/profile", label: "Profile", icon: CircleUser, matches: (path) => path.startsWith("/profile") };

function itemsFor(role: AppRole): NavItem[] {
  return role === "admin" ? [home("/admin"), people, calendar, profile] : [home("/"), leave, profile];
}

function badgeFor(item: NavItem, badges: NavBadges): { label: string; count: number | null } | null {
  if (item.badge === "home" && badges.home > 0) return { label: `${badges.home} waiting for you`, count: badges.home };
  if (item.badge === "leave" && badges.leave > 0) return { label: "New decision on your leave", count: null };
  return null;
}

/** A count for things waiting, or a dot for something new. Read out with the link, never colour alone. */
function Badge({ badge, className = "" }: { badge: { label: string; count: number | null }; className?: string }) {
  return (
    <span className={`flex items-center justify-center rounded-full bg-danger text-on-danger ${badge.count === null ? "size-2.5" : "h-5 min-w-5 px-1.5 text-caption font-semibold tabular"} ${className}`}>
      {badge.count === null ? null : badge.count > 99 ? "99+" : badge.count}
      <span className="sr-only">{badge.label}</span>
    </span>
  );
}

/** Laptop: a quiet sidebar. Icons always sit beside their label. */
export function SidebarNav({ role, badges }: { role: AppRole; badges: NavBadges }) {
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
            <span className="flex-1">{item.label}</span>
            {(() => {
              const badge = badgeFor(item, badges);
              return badge ? <Badge badge={badge} /> : null;
            })()}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone: a tab bar at the bottom, in reach of the thumb. */
export function TabBarNav({ role, badges }: { role: AppRole; badges: NavBadges }) {
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
                <span className="relative">
                  <Icon icon={item.icon} size={24} strokeWidth={active ? 2 : 1.75} />
                  {(() => {
                    const badge = badgeFor(item, badges);
                    return badge ? <Badge badge={badge} className="absolute -top-1 -right-2.5" /> : null;
                  })()}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
