import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";
import type { Supa } from "./supabase";

/**
 * Server-only client for the data mart rebuild (PRD v4 §8 S1): mart_replace is granted to the service role only, so a
 * signed-in user cannot write computed rows. The key is read from SUPABASE_SERVICE_ROLE_KEY (server env, never
 * NEXT_PUBLIC_*). Without it the rebuild does not run and the queue waits (docs/v4/QUESTIONS.md Q2).
 */
export function supabaseService(): Supa | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as Supa;
}
