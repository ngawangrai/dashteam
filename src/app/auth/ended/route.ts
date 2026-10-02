import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Where requireUser() sends someone whose access has ended: sign them out and explain why.
// Does nothing to someone who still has access, so a link here can't sign people out.
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (user?.access === "ok") return NextResponse.redirect(new URL("/", request.url));

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  const login = new URL("/login", request.url);
  if (user?.access === "ended" && user.endDate) login.searchParams.set("ended", user.endDate);
  else if (user) login.searchParams.set("setup", "1");
  return NextResponse.redirect(login);
}
