import type { ReactNode } from "react";
import { AppBar } from "@/components/app-bar";
import { requireUser } from "@/lib/auth/session";

// Every signed-in person can open their own home, admins included: the admin delegate may also take leave.
export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return (
    <div className="[--page-width:32rem]">
      <AppBar />
      {children}
    </div>
  );
}
