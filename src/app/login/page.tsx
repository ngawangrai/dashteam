import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/auth/roles";
import { getSessionUser } from "@/lib/auth/session";
import { LoginFlow } from "./login-flow";
import { NOT_SET_UP_MESSAGE, accessEndedMessage } from "./messages";

export const metadata = { title: "Sign in" };

type LoginPageProps = { searchParams: Promise<{ ended?: string; setup?: string }> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const user = await getSessionUser();
  if (user?.access === "ok") redirect(homePathFor(user.role));

  const { ended, setup } = await searchParams;
  const notice = ended && /^\d{4}-\d{2}-\d{2}$/.test(ended) ? accessEndedMessage(ended) : setup ? NOT_SET_UP_MESSAGE : null;

  return (
    <main className="flex min-h-dvh flex-col px-4 pt-[max(12dvh,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-sm">
        <p className="mb-2 text-secondary font-semibold text-label-secondary">DashTeam</p>
        <LoginFlow notice={notice} />
      </div>
    </main>
  );
}
