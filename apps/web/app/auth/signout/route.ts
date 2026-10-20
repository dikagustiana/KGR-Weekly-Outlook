import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { HOME_COOKIE } from "@/lib/home-cookie";

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  const r = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  // PRD v6 R127: the remembered home belongs to this user
  r.cookies.delete(HOME_COOKIE);
  return r;
}
