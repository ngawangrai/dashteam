import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth/session";
import { SidebarNav, TabBarNav } from "./app-nav";
import { SignOutButton } from "./sign-out-button";

type AppShellProps = { user: SessionUser; width: "narrow" | "wide"; children: ReactNode };

/** Sidebar on laptops, tab bar on phones. Content leads; the chrome stays quiet. */
export function AppShell({ user, width, children }: AppShellProps) {
  return (
    <div className={`md:flex md:min-h-dvh ${width === "wide" ? "[--page-width:48rem]" : "[--page-width:36rem]"}`}>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col justify-between border-r border-separator/60 px-3 pt-5 pb-4 md:flex">
        <div className="flex flex-col gap-5">
          <span className="px-3 text-body font-semibold">DashTeam</span>
          <SidebarNav role={user.role} />
        </div>
        <div className="flex flex-col gap-1 px-3">
          <span className="truncate text-secondary text-label-secondary">{user.email}</span>
          <SignOutButton className="-mx-3 justify-start" />
        </div>
      </aside>
      <div className="min-w-0 flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">{children}</div>
      <TabBarNav role={user.role} />
    </div>
  );
}
