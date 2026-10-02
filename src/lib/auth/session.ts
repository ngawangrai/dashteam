import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { asUser } from "@/lib/db/client";
import { type AppRole, profiles } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { firstNameFrom, homePathFor } from "./roles";

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  role: AppRole;
};

export async function roleFor(userId: string): Promise<AppRole | null> {
  const rows = await asUser({ sub: userId, role: "authenticated" }, (tx) =>
    tx.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, userId)).limit(1),
  );
  return rows[0]?.role ?? null;
}

// cache() dedupes the lookup across the layout and page of a single request.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  // getClaims verifies the JWT signature; never trust an unverified session cookie.
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  const role = await roleFor(claims.sub);
  if (!role) return null;

  const email = typeof claims.email === "string" ? claims.email : "";
  const metadata = claims.user_metadata as { full_name?: unknown } | undefined;
  const fullName = typeof metadata?.full_name === "string" ? metadata.full_name : null;

  return { id: claims.sub, email, firstName: firstNameFrom(fullName, email), role };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Call in every layout, page and server action that needs a role. Layouts alone are not enough. */
export async function requireRole(role: AppRole): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== role) redirect(homePathFor(user.role));
  return user;
}
