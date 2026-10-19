import "server-only";
/**
 * PRD v6 R126 / R128: reads that every page repeats (all of app_setting, the week list, schema_version()) happen once per
 * client. The app edge has one client per request (`supabaseServer` is cached), so "once per client" is "once per
 * request"; a rebuild run holds one service client, so it reads them once per run. A failure is not remembered (the next
 * caller reads again). A write that changes one of these tables calls `forget` so the same request reads it fresh.
 */
import type { Supa } from "./supabase";
import { LoaderError, isSchemaError, mustRows } from "./loader";
import type { WeekRow } from "./data";

type Key = "app_setting" | "weeks";
const memo = new WeakMap<object, Map<Key, Promise<unknown>>>();

function perClient<T>(sb: Supa, key: Key, read: () => Promise<T>): Promise<T> {
  let byKey = memo.get(sb);
  if (!byKey) memo.set(sb, (byKey = new Map()));
  let p = byKey.get(key) as Promise<T> | undefined;
  if (!p) {
    const own = byKey;
    p = read().catch((e: unknown) => { own.delete(key); throw e; });
    own.set(key, p);
  }
  return p;
}

/** After a write to `week` or `app_setting` in this request: the next read goes to the database. */
export function forget(sb: Supa, key: Key): void {
  memo.get(sb)?.delete(key);
}

/**
 * Every row of app_setting as key → value, one query (R126: "app_setting (semua kunci, satu query)"). K56: a failing read
 * throws; only a missing table (42P01, a database before v3) reads as no settings.
 */
export function appSettingsOf(sb: Supa): Promise<Record<string, unknown>> {
  return perClient(sb, "app_setting", async () => {
    const { data, error } = await sb.from("app_setting").select("key, value");
    if (error) {
      if (error.code === "42P01") {
        console.error(`[settings] app_setting belum ada (42P01): ${error.message}`);
        return {};
      }
      throw new LoaderError("app_setting", error.message, isSchemaError(error.code), error.code);
    }
    const out: Record<string, unknown> = {};
    for (const r of data as { key: string; value: unknown }[]) out[r.key] = r.value;
    return out;
  });
}

/** One app_setting value (null when the key has no row). */
export async function settingValue(sb: Supa, key: string): Promise<unknown> {
  const all = await appSettingsOf(sb);
  return key in all ? all[key] : null;
}

/** The week list, newest first, once per client (R126: "week (satu query select *)"). */
export function weeksOf(sb: Supa): Promise<WeekRow[]> {
  return perClient(sb, "weeks", async () => mustRows(await sb.from("week").select("*").order("week_start", { ascending: false }), "listWeeks.week") as WeekRow[]);
}
