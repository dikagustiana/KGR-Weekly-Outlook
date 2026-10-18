import "server-only";
import { cache } from "react";
import { supabaseServer } from "./supabase";
import { assertSchemaCurrent as assertWith, schemaStatusOf } from "./schema";

/**
 * R44 (K57, K65), the app edge of schema.ts: the schema banner of the page, once per request, read with the signed-in
 * user's client. Kept apart from schema.ts so the data builders (which import schema.ts for `schemaStatusOf`) never
 * reach `supabaseServer` (Q-v5.2-51, lib/rebuild-client.test.ts).
 */
export const schemaStatus = cache(async (): Promise<string | null> => schemaStatusOf(await supabaseServer()));

/** K57 (R44): a write action stops early, with the banner's message, while the schema is behind (session client). */
export async function assertSchemaCurrent(): Promise<void> {
  await assertWith(await supabaseServer());
}
