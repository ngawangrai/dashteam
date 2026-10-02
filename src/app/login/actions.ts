"use server";

import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/auth/roles";
import { accessFrom, sessionInfoFor } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NOT_SET_UP_MESSAGE, accessEndedMessage, sendCodeErrorMessage, verifyCodeErrorMessage } from "./messages";
import { codeSchema, emailSchema, type SendCodeState, type VerifyCodeState } from "./schema";

export async function sendSignInCode(_previous: SendCodeState, formData: FormData): Promise<SendCodeState> {
  const raw = String(formData.get("email") ?? "");
  const email = emailSchema.safeParse(raw);
  if (!email.success) {
    return { status: "error", email: raw, message: email.error.issues[0]?.message ?? "Enter your email address." };
  }

  const supabase = await createSupabaseServerClient();
  // shouldCreateUser: false keeps DashTeam invite-only; people are added by an admin.
  const { error } = await supabase.auth.signInWithOtp({ email: email.data, options: { shouldCreateUser: false } });
  if (error) return { status: "error", email: email.data, message: sendCodeErrorMessage(error.code) };

  return { status: "sent", email: email.data, sentAt: Date.now() };
}

export async function verifySignInCode(_previous: VerifyCodeState, formData: FormData): Promise<VerifyCodeState> {
  const email = emailSchema.safeParse(String(formData.get("email") ?? ""));
  const code = codeSchema.safeParse(String(formData.get("code") ?? ""));
  if (!email.success) return { status: "error", message: "Start again with your email address." };
  if (!code.success) return { status: "error", message: code.error.issues[0]?.message ?? "Enter the 6 digits from the email." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: "email" });
  if (error || !data.user) {
    return { status: "error", message: verifyCodeErrorMessage(error?.code) };
  }

  // A valid code is not enough: people whose employment has ended no longer have access.
  const info = await sessionInfoFor(data.user.id);
  const access = info ? accessFrom(info) : "not_set_up";
  if (!info || access !== "ok") {
    await supabase.auth.signOut();
    const message = access === "ended" && info?.end_date ? accessEndedMessage(info.end_date) : NOT_SET_UP_MESSAGE;
    return { status: "error", message };
  }

  redirect(homePathFor(info.role));
}
