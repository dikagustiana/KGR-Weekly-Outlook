import "server-only";
/**
 * PRD v6 K83 / R126: one RequestContext per request (React `cache`). Identity comes from the JWT verified locally
 * (`getClaims()`, JWKS cached: K82), then app_user, every app_setting, the week list and schema_version() are read in one
 * parallel round. `getViewer`, `moduleSettings`, `weeksCached`, `schemaStatus` and the v5 flag reads are thin wrappers over
 * the same reads (request-memo), so a page asks for each of them once, whatever it calls.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { jakartaToday } from "@kgr/engine";
import { supabaseServer, type Supa } from "./supabase";
import { must } from "./loader";
import { moduleSettingsOf } from "./modules-read";
import { weeksOf } from "./request-memo";
import { schemaStatusOf } from "./schema";
import { VIEW_COOKIE, viewModeFor, type ViewMode } from "./view";
import { isModuleOn, type ModuleSettings } from "./modules-core";
import { readSnapshotsWith } from "./week-source";
import type { Role } from "./roles";
import type { WeekRow } from "./data";

export interface Viewer {
  email: string;
  role: Role;
  fullName: string | null;
}

export interface RequestContext {
  /** The signed-in email (lower case), or null without a valid session. */
  email: string | null;
  /** The allow-listed user, or null when signed in but not (or no longer) allowed. */
  viewer: Viewer | null;
  settings: ModuleSettings;
  weeks: WeekRow[];
  /** The schema banner (K57), or null when the database is current. */
  schema: string | null;
  view: ViewMode;
  /** The preparer's view toggle cookie, as stored (a "Lihat sebagai" role is judged with it too). */
  viewCookie: string | null;
  /** The wall date in WIB. */
  today: string;
  /** Milliseconds spent building this context (Server-Timing `ctx`, R121). */
  ms: number;
}

/**
 * K82: the email of the session's JWT, verified locally (ES256 + cached JWKS). An HS256 project (the local e2e stack)
 * falls back to GoTrue inside getClaims, as @supabase/auth-js does.
 */
export async function claimEmail(sb: Supa): Promise<string | null> {
  const { data, error } = await sb.auth.getClaims();
  if (error || !data?.claims) return null;
  const email = (data.claims as { email?: unknown }).email;
  return typeof email === "string" && email ? email.toLowerCase() : null;
}

export const getRequestContext = cache(async (): Promise<RequestContext> => {
  const t0 = performance.now();
  const sb = await supabaseServer();
  const email = await claimEmail(sb);
  const today = jakartaToday();
  if (!email) return { email: null, viewer: null, settings: {}, weeks: [], schema: null, view: "preparer", viewCookie: null, today, ms: Math.round(performance.now() - t0) };
  const [row, settings, weeks, schema, store] = await Promise.all([
    sb.from("app_user").select("email, role, full_name, active").eq("email", email).maybeSingle()
      .then((r) => must(r, "getViewer.app_user") as { role: Role; full_name: string | null; active: boolean } | null),
    moduleSettingsOf(sb),
    weeksOf(sb),
    schemaStatusOf(sb),
    cookies(),
  ]);
  const viewer: Viewer | null = row && row.active ? { email, role: row.role, fullName: row.full_name } : null;
  // PRD v6 R120 (flag v6_snapshot_read): the loaders this request runs with its client read week_snapshot
  if (viewer && isModuleOn(settings.v6_snapshot_read, viewer.role)) readSnapshotsWith(sb);
  const viewCookie = store.get(VIEW_COOKIE)?.value ?? null;
  const view = viewer ? viewModeFor(viewer.role, viewCookie) : "preparer";
  return { email, viewer, settings, weeks, schema, view, viewCookie, today, ms: Math.round(performance.now() - t0) };
});
