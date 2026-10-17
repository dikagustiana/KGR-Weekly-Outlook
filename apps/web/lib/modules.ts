import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { supabaseServer } from "./supabase";
import { requireViewer, type Viewer } from "./session";
import { WriteError } from "./write";
import type { Role } from "./roles";
import { MODULE_KEYS, isModuleOn, k25On, parseSetting, type ModuleKey, type ModuleSettings } from "./modules-core";

export * from "./modules-core";

/** All module flags, once per request. Missing table / row = off. */
export const moduleSettings = cache(async (): Promise<ModuleSettings> => {
  const sb = await supabaseServer();
  const { data, error } = await sb.from("app_setting").select("key, value").in("key", MODULE_KEYS);
  if (error || !data) return {};
  const out: ModuleSettings = {};
  for (const r of data as { key: string; value: unknown }[]) out[r.key as ModuleKey] = parseSetting(r.value);
  return out;
});

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
  return v;
}
