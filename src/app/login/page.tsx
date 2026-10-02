import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/auth/roles";
import { getSessionUser } from "@/lib/auth/session";
import { LoginFlow } from "./login-flow";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user.role));

  return (
    <main className="flex min-h-dvh flex-col px-4 pt-[max(12dvh,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-sm">
        <p className="mb-2 text-secondary font-semibold text-label-secondary">DashTeam</p>
        <LoginFlow />
      </div>
    </main>
  );
}
