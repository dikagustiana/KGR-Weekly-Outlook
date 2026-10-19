import "server-only";
import type { Supa } from "./supabase";
import { MODULE_KEYS, parseSetting, type ModuleSettings } from "./modules-core";
import { appSettingsOf } from "./request-memo";

/**
 * The module flags read with a given client (the cron reads them with the service client: no session there). PRD v6
 * R126: from the one read of app_setting per client (request-memo). K56 (R41): a failing read never makes the modules
 * look off; only a missing table (42P01) is "no modules yet".
 */
export async function moduleSettingsOf(sb: Supa): Promise<ModuleSettings> {
  const all = await appSettingsOf(sb);
  const out: ModuleSettings = {};
  for (const k of MODULE_KEYS) if (k in all) out[k] = parseSetting(all[k]);
  return out;
}
