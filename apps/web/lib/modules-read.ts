import "server-only";
import type { Supa } from "./supabase";
import { LoaderError } from "./loader";
import { MODULE_KEYS, parseSetting, type ModuleKey, type ModuleSettings } from "./modules-core";

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
