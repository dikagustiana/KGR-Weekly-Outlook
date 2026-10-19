import { NextResponse, type NextRequest } from "next/server";
import { mondayOf } from "@kgr/engine";
import { getRequestContext } from "@/lib/request-context";
import { v4Home, v4On } from "@/lib/v4/nav";
import { HOME_COOKIE, HOME_MAX_AGE, homeCookieValue } from "@/lib/home-cookie";

export const dynamic = "force-dynamic";

/**
 * `/`: the first page of the viewer's workspace. PRD v6 R127: computed from the RequestContext (no query of its own) and
 * remembered in the cookie kgr_home for this week, so the next `/` is a redirect from the middleware without a render.
 * A route handler, not a page: a Server Component cannot set a cookie.
 */
export async function GET(req: NextRequest) {
  const ctx = await getRequestContext();
  const go = (path: string, remember: boolean) => {
    const r = NextResponse.redirect(new URL(path, req.url), 307);
    if (remember) r.cookies.set(HOME_COOKIE, homeCookieValue(mondayOf(ctx.today), path), { path: "/", maxAge: HOME_MAX_AGE, httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:" });
    return r;
  };
  if (!ctx.email) return go("/login", false);
  if (!ctx.viewer) return go("/login?error=not-allowed", false);
  const { viewer, weeks, settings, today } = ctx;
  if (weeks.length === 0) return go(viewer.role === "admin" ? "/admin/minggu" : "/kosong", false);
  const thisMonday = mondayOf(today);
  const current = weeks.find((w) => w.week_start === thisMonday) ?? weeks.find((w) => w.status !== "closed") ?? weeks[0];
  // PRD v4 §5.4 (flag v4_design): the first page of the role's workspace
  if (v4On(settings, viewer.role)) {
    const home = v4Home(viewer.role, settings, { week: current.week_start, month: current.update_date.slice(0, 7), today });
    if (home) return go(home, true);
  }
  return go(`/w/${current.week_start}/outlook`, true);
}
