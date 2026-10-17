import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { supabaseServer, type Supa } from "./supabase";
import { assertSchemaCurrent } from "./schema";
import { requireViewer, type Viewer } from "./session";
import { WriteError } from "./write";
import { LoaderError } from "./loader";
import type { Role } from "./roles";
import { MODULE_KEYS, isModuleOn, k25On, parseSetting, type ModuleKey, type ModuleSettings } from "./modules-core";

export * from "./modules-core";

/** All module flags, once per request. Missing table / row = off. */
export const moduleSettings = cache(async (): Promise<ModuleSettings> => moduleSettingsOf(await supabaseServer()));

/** The module flags read with a given client (the cron reads them with the service client: no session there). */
export async function moduleSettingsOf(sb: Supa): Promise<ModuleSettings> {
  const { data, error } = await sb.from("app_setting").select("key, value").in("key", MODULE_KEYS);
  // K56 (R41): a failing read never makes the modules look off; only a missing table (42P01) is "no modules yet".
  if (error) {
    if (error.code === "42P01") {
      console.error(`[modules] app_setting belum ada (42P01): ${error.message}`);
      return {};
    }
    throw new LoaderError("moduleSettings", error.message);
  }
  const out: ModuleSettings = {};
  for (const r of (data as { key: string; value: unknown }[])) out[r.key as ModuleKey] = parseSetting(r.value);
  return out;
}

/** PRD v3 rule 5: is the module on for this viewer (or the signed-in user)? */
export async function moduleEnabled(key: ModuleKey, viewer?: Viewer | { role: Role }): Promise<boolean> {
  const v = viewer ?? (await requireViewer());
  return isModuleOn((await moduleSettings())[key], v.role);
}

/** K54: K25 for this viewer (v5_costing or v5_management on for the role). */
export async function k25Enabled(viewer: Viewer | { role: Role }): Promise<boolean> {
  return k25On(await moduleSettings(), viewer.role);
}

/** Pages of a module: 404 when the flag is off for the viewer, or the role may not open the page. */
export async function requireModulePage(key: ModuleKey, roles?: Role[]): Promise<Viewer> {
  const v = await requireViewer();
  if (!(await moduleEnabled(key, v))) notFound();
  if (roles && !roles.includes(v.role)) notFound();
  return v;
}

/** Server actions of a module: refuse when the flag is off for the caller. */
export async function requireModuleAction(key: ModuleKey, roles?: Role[]): Promise<Viewer> {
  const v = await requireViewer();
  if (!(await moduleEnabled(key, v))) throw new WriteError(`Modul ${key} belum aktif untuk peran Anda`);
  if (roles && !roles.includes(v.role)) throw new WriteError("Peran Anda tidak boleh melakukan ini");
  // K57 (R44): no write against a schema that is behind the code; the message is the banner's
  await assertSchemaCurrent();
  return v;
}
