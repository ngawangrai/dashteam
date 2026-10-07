import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { publicEnv } from "@/lib/env/public";

const PUBLIC_PATHS = new Set(["/login"]);

// Refreshes the session cookie and sends signed-out people to /login.
// This is a convenience, not the security boundary: requireRole() and RLS are.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  // Signed-in people on /login are sent home by the login page itself, which knows their role.
  // Scheduled jobs carry their own secret instead of a session; their routes check it.
  const scheduledJob = request.nextUrl.pathname.startsWith("/api/cron/");
  if (!signedIn && !scheduledJob && !PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return redirectKeepingCookies(new URL("/login", request.url), response);
  }
  return response;
}

function redirectKeepingCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest).*)"],
};
