import type { ReactNode } from "react";
import { AppBar } from "@/components/app-bar";
import { requireRole } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireRole("admin");
  return (
    <div className="[--page-width:48rem]">
      <AppBar />
      {children}
    </div>
  );
}
