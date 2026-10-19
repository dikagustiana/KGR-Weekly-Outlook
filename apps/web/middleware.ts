import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "./lib/env";
import { HOME_COOKIE, homeFromCookie, jakartaMonday } from "./lib/home-cookie";

// /api/cron/: called by Vercel Cron without a session; the route checks `Authorization: Bearer ${CRON_SECRET}` itself
const PUBLIC = ["/login", "/auth/", "/api/cron/"];

export async function middleware(request: NextRequest) {
  const t0 = performance.now();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });
  // PRD v6 K82 / R125: the session's JWT is verified locally (ES256 against the cached JWKS), no GoTrue round trip; an
  // expired access token is refreshed by @supabase/ssr through setAll first. Invalid or expired → /login?next=
  const { data, error } = await supabase.auth.getClaims();
  const signedIn = !error && !!data?.claims;
  const path = request.nextUrl.pathname;
  if (!signedIn && !PUBLIC.some((p) => path.startsWith(p))) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(login);
  }
  // R127: "/" goes straight to the home page remembered for this week (cookie written by app/route.ts), without a render
  if (signedIn && path === "/") {
    const home = homeFromCookie(request.cookies.get(HOME_COOKIE)?.value, jakartaMonday());
    if (home) {
      const to = request.nextUrl.clone();
      to.pathname = home;
      to.search = "";
      const r = NextResponse.redirect(to, 307);
      response.cookies.getAll().forEach((c) => r.cookies.set(c));
      return r;
    }
  }
  // R121: Server-Timing carries the middleware's share (auth); ctx and data are logged by the page (lib/timing.ts)
  response.headers.set("Server-Timing", `auth;dur=${(performance.now() - t0).toFixed(1)}`);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
