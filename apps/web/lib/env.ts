/**
 * Supabase project the app talks to. The publishable key is public by design (it ships in the
 * browser bundle; RLS protects the data). The pilot project's values are the defaults for development and tests only;
 * a production deployment sets NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (fail-fast, PRD v5.1 R40).
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// PRD v5.1 R40: a production server or browser without the two variables stops with this message instead of talking
// to the pilot project; `next build` itself (NEXT_PHASE) and development / tests keep the pilot defaults
const production = process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
if (production && (!url || !key)) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY wajib diisi di production (env project Vercel); app tidak memakai project pilot.");
}
export const SUPABASE_URL = url || "https://uxqbtverhnpiryhzbenr.supabase.co";
export const SUPABASE_KEY = key || "sb_publishable_PtZIAxjxQsRGXlygCn3LJA_KkA-GV1R";
