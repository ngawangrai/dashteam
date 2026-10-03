"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type UndoResult = { ok: true } | { ok: false; message: string };

type UndoneEntry = { table: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

/**
 * Reverts one change (everything one transaction wrote) for the person who made it, within 10 minutes.
 * The database checks ownership, time and that nothing has changed since; see undo_transaction().
 */
export async function undoChange(transactionId: number): Promise<UndoResult> {
  const user = await requireUser();
  const parsed = z.number().int().positive().safeParse(transactionId);
  if (!parsed.success) return { ok: false, message: "There’s nothing to undo." };

  let undone: UndoneEntry[];
  try {
    undone = await asUser({ sub: user.id, role: "authenticated" }, async (tx) => {
      const rows = await tx.execute<{ undone: UndoneEntry[] }>(sql`select public.undo_transaction(${parsed.data}) as undone`);
      return rows[0]?.undone ?? [];
    });
  } catch (error) {
    const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : "";
    if (/payroll_locked:/.test(message)) return { ok: false, message: "That month’s payroll is locked, so this can’t be undone." };
    if (/changed since/.test(message)) return { ok: false, message: "This was changed since, so it can’t be undone." };
    if (/no longer available/.test(message)) return { ok: false, message: "It’s too late to undo this." };
    return { ok: false, message: "We couldn’t undo that. Try again in a minute." };
  }

  // Undoing "add person" also removes the login created for them, unless it belongs to an admin.
  const removedPeople = undone.filter((entry) => entry.table === "people" && entry.before === null);
  const removedProfiles = removedPeople.map((entry) => entry.after?.profile_id).filter((id): id is string => typeof id === "string");
  if (removedProfiles.length) {
    const admin = createSupabaseAdminClient();
    for (const profileId of removedProfiles) {
      const role = await asUser({ sub: user.id, role: "authenticated" }, (tx) =>
        tx.execute<{ role: string }>(sql`select role from public.profiles where id = ${profileId}`),
      );
      if (role[0]?.role !== "admin") await admin.auth.admin.deleteUser(profileId);
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
