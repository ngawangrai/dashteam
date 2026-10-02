import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth/session";

// Every signed-in person with access can open their own home and profile, admins included.
export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <AppShell user={user} width="narrow">
      {children}
    </AppShell>
  );
}
