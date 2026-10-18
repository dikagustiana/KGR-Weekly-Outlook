import "server-only";
import { cache } from "react";
import { supabaseServer, type Supa } from "./supabase";
import { isSchemaError } from "./loader";
import { WriteError } from "./write";

/**
 * K57 (R44, B-R82 K65): the schema version the code needs. The database says its version through `schema_version()`
 * (v52_meta: highest version of `schema_registry`, compared by number). A database behind the code, or without the
 * function, is a "skema DB tertinggal" state, shown once as a banner in the header; writes, the rebuild and the release
 * stop early with the same message. Raise this constant in the PR whose code needs the newer objects, and merge that
 * PR only after the bundle is in KGR-OS (brief v5.2 Bab 4).
 */
export const EXPECTED_SCHEMA = "5.2.2";

/** Numeric comparison of dotted versions ("5.10.0" > "5.9.3"), as `schema_version()` orders them. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10));
  const pb = b.split(".").map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (Number.isNaN(d)) throw new Error(`Versi skema tidak dikenal: ${a} / ${b}`);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** K57: which schema error and which object, when the error is a schema error. */
export function classifySchemaError(err: { code?: string; message?: string; details?: string }): { schema: boolean; object?: string } {
  if (!isSchemaError(err.code)) return { schema: false };
  const text = `${err.message ?? ""} ${err.details ?? ""}`;
  const m = text.match(/(?:column|relation|function|table|view|type) ["']?([\w.]+)["']?/i);
  return { schema: true, object: m?.[1] };
}

/**
 * R44 (K57, K65): the database's schema version against EXPECTED_SCHEMA; the banner message when it is behind or has no
 * `schema_version()` (once per request, cached). Any other error is logged and the check stays silent (tiles still fail
 * per tile with their own message).
 */
export const schemaStatus = cache(async (): Promise<string | null> => schemaStatusOf(await supabaseServer()));

/** The check with a given client (the rebuild and the cron run with the service client). */
export async function schemaStatusOf(sb: Supa): Promise<string | null> {
  const { data, error } = await sb.rpc("schema_version");
  if (error) {
    console.error(`[schema] schema_version(): ${error.message}`);
    return classifySchemaError(error).schema ? schemaMessage("schema_version()") : null;
  }
  // an empty registry answers null: never "current"
  if (typeof data !== "string" || !data) return schemaMessage("schema_registry kosong");
  return compareVersions(data, EXPECTED_SCHEMA) < 0 ? schemaMessage(`DB v${data}`) : null;
}

/** The banner text (K57): one sentence for the header, the rebuild, the release and every write action. */
export const schemaMessage = (object: string) => `Skema database belum diperbarui ke v${EXPECTED_SCHEMA}; hubungi Admin (${object})`;

/** K57 (R44): rebuild, release and write actions stop early, with the banner's message, while the schema is behind. */
export async function assertSchemaCurrent(sb?: Supa): Promise<void> {
  const msg = sb ? await schemaStatusOf(sb) : await schemaStatus();
  if (msg) throw new WriteError(msg);
}
