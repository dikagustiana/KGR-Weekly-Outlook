import "server-only";
import { cache } from "react";
import { supabaseServer } from "./supabase";
import { isSchemaError } from "./loader";

/**
 * K57 (R44): a PostgREST error that names an object the code expects but the database does not have yet is a
 * "skema DB tertinggal" error, shown once as a banner in the header. Before B-R82 lands, the probe below stands in for
 * `schema_version()`; after B-R82 a separate PR (`v5.2/a1b-schema-version`) switches to the RPC and `EXPECTED_SCHEMA`.
 */
export const EXPECTED_SCHEMA = "5.1.0";

/** K57: which schema error and which object, when the error is a schema error. */
export function classifySchemaError(err: { code?: string; message?: string; details?: string }): { schema: boolean; object?: string } {
  if (!isSchemaError(err.code)) return { schema: false };
  const text = `${err.message ?? ""} ${err.details ?? ""}`;
  const m = text.match(/(?:column|relation|function|table|view|type) ["']?([\w.]+)["']?/i);
  return { schema: true, object: m?.[1] };
}

/**
 * R44 tahap 1 (before B-R82): probe the two v5.1 objects the code needs; a schema error returns the banner message
 * (once per request, cached). Other errors are logged and the probe stays silent (tiles still fail per tile).
 */
export const schemaStatus = cache(async (): Promise<string | null> => {
  const sb = await supabaseServer();
  const probes = await Promise.all([
    sb.from("price_list_week").select("deleted_at").limit(1),
    sb.from("parameter").select("po_unsized_mode").limit(1),
  ]);
  for (const [what, res] of [["price_list_week.deleted_at", probes[0]], ["parameter.po_unsized_mode", probes[1]]] as const) {
    if (res.error) {
      console.error(`[schema] ${what}: ${res.error.message}`);
      if (isSchemaError(res.error.code)) return `Skema database belum diperbarui ke v${EXPECTED_SCHEMA}; hubungi Admin (${what})`;
    }
  }
  return null;
});
