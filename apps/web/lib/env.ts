/**
 * Supabase project the app talks to. The publishable key is public by design (it ships in the
 * browser bundle; RLS protects the data), so the pilot project's values are the defaults and a
 * fresh Vercel import works without setting env vars. Set NEXT_PUBLIC_SUPABASE_URL /
 * NEXT_PUBLIC_SUPABASE_ANON_KEY to point a deployment at another project.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://uxqbtverhnpiryhzbenr.supabase.co";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_PtZIAxjxQsRGXlygCn3LJA_KkA-GV1R";
