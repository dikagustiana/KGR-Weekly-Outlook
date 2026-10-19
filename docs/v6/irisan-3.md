# PRD v6 irisan 3 — konteks request, auth lokal, region

Isi: K82–K84, R125–R129. Tidak bergantung irisan 1–2; tidak ada flag (infra).

| Butir | File |
| --- | --- |
| Middleware: `getClaims()` (JWT diverifikasi lokal dengan JWKS yang di-cache) menggantikan `getUser()`; header `Server-Timing: auth;dur=` | `apps/web/middleware.ts` |
| `RequestContext` per request: klaim → `app_user`, semua `app_setting`, `week`, `schema_version()` satu putaran paralel | `apps/web/lib/request-context.ts`; `getViewer`/`requireViewer`, `schemaStatus`, `currentView` jadi pembungkus |
| Memo per klien untuk `app_setting` (semua kunci, satu query) dan daftar minggu; `forget` sesudah write | `apps/web/lib/request-memo.ts`; pembaca `app_setting?key=eq.*` di `lib/v3`, `v4`, `v5` dialihkan; `dataToday` membaca daftar minggu (tidak ada lagi `week?select=update_date`) |
| `/` jadi route handler; tujuan ditulis ke cookie `kgr_home` (30 hari, terikat Senin minggu itu); middleware mengalihkan 307 tanpa render; keluar menghapus cookie | `apps/web/app/route.ts`, `lib/home-cookie.ts`, `app/auth/signout/route.ts` |
| Region Vercel `icn1` | `apps/web/vercel.json`, `docs/handover.md` |

Tes: `lib/request-context.test.ts` (satu baca per sumber, `getUser` 0 kali), `lib/home-cookie.test.ts`.

Catatan:

- `getClaims()` jatuh ke `getUser()` bila JWT ditandatangani HS256 (perilaku `@supabase/auth-js`). KGR-OS memakai ES256 (K82). Stack e2e lokal masih HS256 (`tests/e2e/stack/keys.mjs`), jadi T30 "tidak ada `auth/v1/user`" baru bisa diuji sesudah mock memakai ES256 + `/.well-known/jwks.json` dan PostgREST diberi JWKS. Belum dikerjakan.
- `Server-Timing` dari Server Component tidak bisa ditulis sebagai header (Next.js); `ctx` dan `data` dicatat di log dan atribut halaman (irisan 2, `lib/timing.ts`).
- `getUser()` tetap di `/auth/callback` (tidak diubah).
