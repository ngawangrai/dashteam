import "server-only";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type JwtClaims, asUser } from "@/lib/db/client";
import type { AppRole } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { firstNameFrom, homePathFor } from "./roles";

export type Access = "ok" | "ended" | "not_set_up";

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  role: AppRole;
  /** The person record linked to this login, if any. Admins may have none. */
  personId: string | null;
  endDate: string | null;
  access: Access;
};

type SessionInfo = {
  role: AppRole;
  has_access: boolean;
  person_id: string | null;
  full_name: string | null;
  end_date: string | null;
} | null;

export function claimsFor(user: Pick<SessionUser, "id">): JwtClaims {
  return { sub: user.id, role: "authenticated" };
}

export async function sessionInfoFor(userId: string): Promise<SessionInfo> {
  const rows = await asUser({ sub: userId, role: "authenticated" }, (tx) =>
    tx.execute<{ info: SessionInfo }>(sql`select public.session_info() as info`),
  );
  return rows[0]?.info ?? null;
}

export function accessFrom(info: NonNullable<SessionInfo>): Access {
  if (info.has_access) return "ok";
  return info.end_date ? "ended" : "not_set_up";
}

// cache() dedupes the lookup across the layout and page of a single request.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  // getClaims verifies the JWT signature; never trust an unverified session cookie.
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  const info = await sessionInfoFor(claims.sub);
  if (!info) return null;

  const email = typeof claims.email === "string" ? claims.email : "";
  // An admin without a staff record still has the name given to their login.
  const metadata = claims.user_metadata as { full_name?: unknown } | undefined;
  const loginName = typeof metadata?.full_name === "string" ? metadata.full_name : null;
  return {
    id: claims.sub,
    email,
    firstName: firstNameFrom(info.full_name ?? loginName, email),
    role: info.role,
    personId: info.person_id,
    endDate: info.end_date,
    access: accessFrom(info),
  };
});

/** Signed in, with access. People whose employment has ended are signed out with a message. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.access !== "ok") redirect("/auth/ended");
  return user;
}

/** Call in every layout, page and server action that needs a role. Layouts alone are not enough. */
export async function requireRole(role: AppRole): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== role) redirect(homePathFor(user.role));
  return user;
}
