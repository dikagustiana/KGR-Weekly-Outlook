import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase";
import { must } from "./loader";
import type { Role } from "./roles";

export interface Viewer {
  email: string;
  role: Role;
  fullName: string | null;
}

/** The signed-in user and their role from the allow-list; null when signed in but not (or no longer) allowed. */
export const getViewer = cache(async (): Promise<{ email: string | null; viewer: Viewer | null }> => {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const email = data.user?.email?.toLowerCase() ?? null;
  if (!email) return { email: null, viewer: null };
  const row = must(await sb.from("app_user").select("email, role, full_name, active").eq("email", email).maybeSingle(), "getViewer.app_user") as { email: string; role: Role; full_name: string | null; active: boolean } | null;
  if (!row || !row.active) return { email, viewer: null };
  return { email, viewer: { email, role: row.role as Role, fullName: row.full_name } };
});

export async function requireViewer(): Promise<Viewer> {
  const { email, viewer } = await getViewer();
  if (!email) redirect("/login");
  if (!viewer) redirect("/login?error=not-allowed");
  return viewer;
}
