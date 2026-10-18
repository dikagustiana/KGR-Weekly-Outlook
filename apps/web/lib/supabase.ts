import "server-only";
import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

/**
 * Per-request server client acting as the signed-in user (RLS applies). R-A1d (Q-v5.2-51): one client per request
 * (React `cache`), so everything a page reads in one request shares it — and so `computeForWeek(sb, week)`, memoised per
 * client, still loads a week once per request. Only the app edge (pages, actions, route handlers) calls this; a data
 * builder receives its client from the caller (lib/rebuild-client.test.ts keeps it that way).
 */
export const supabaseServer = cache(async () => {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch { // k41-ok: cookies() hanya-baca di Server Component (pola resmi @supabase/ssr)
          // called from a Server Component: the middleware refreshes the session instead
        }
      },
    },
  });
});

export type Supa = Awaited<ReturnType<typeof supabaseServer>>;
