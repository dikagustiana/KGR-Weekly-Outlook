import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

/** Per-request server client acting as the signed-in user (RLS applies). */
export async function supabaseServer() {
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
}

export type Supa = Awaited<ReturnType<typeof supabaseServer>>;
