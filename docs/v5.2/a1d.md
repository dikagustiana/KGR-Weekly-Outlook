# PRD v5.2-A irisan A1d — builder dan cron memakai klien dari pemanggil (Q-v5.2-51)

Cabang `v5.2/a1d-cron-client`, di atas main `9431b44` (A5 sudah di main lewat #52). Menutup temuan A5 **Q-v5.2-51**
(`docs/v5.2/a5.md`): rebuild lewat route cron menulis mart yang berbeda dari rebuild sesi Finance. Tidak ada migrasi;
`supabase/**` tidak diubah.

## Keputusan (diputuskan agen atas delegasi Dika)

Route cron dan setiap builder memakai **klien yang diberikan pemanggil**: klien servis di cron, klien sesi di app.
`supabaseServer()` tidak pernah dipanggil di dalam builder.

## Akar masalah

`computeForWeek(weekStart)` membuka klien sesi sendiri (`supabaseServer()`). Builder bulan (`monthly`, `monthly v4`) dan
builder kas (`cash`) memanggilnya untuk membaca minggu. Di route cron tidak ada sesi: klien itu anon, RLS membuat minggu
terbaca kosong, sehingga cron tidak menulis `solvency_monthly` maupun `ccc_daily`, dan mengganti baris forecast `po` di
`pl_daily_v4` dengan `runrate`. Di rebuild lewat tombol (app) pembaca itu klien sesi Finance, jadi hasilnya lain.

## Perubahan

| Berkas | Perubahan |
|---|---|
| `apps/web/lib/data.ts` | `computeForWeek(sb, weekStart)`: klien eksplisit. Memo per klien (`WeakMap` klien → minggu → promise); kegagalan tidak diingat. `weeksCached` dihapus dari sini (tidak ada lagi `supabaseServer` di `data.ts`). |
| `apps/web/lib/supabase.ts` | `supabaseServer` dibungkus `cache` React: satu klien sesi per request. Tanpa ini, halaman yang membuat klien sendiri-sendiri (119 pemanggil) kehilangan memo minggu per request (satu minggu terbaca dua kali). |
| `apps/web/lib/v3/cash.ts`, `v3/monthly.ts`, `v4/month.ts`, `v5/komersial-data.ts` | meneruskan `sb` yang sudah mereka terima ke `computeForWeek`. |
| `apps/web/lib/page.ts` | `weekContext` membuat klien sesi sekali dan meneruskannya; `weeksCached(sb)` pindah ke sini (dipakai juga `app/page.tsx`). |
| `apps/web/app/**` (master item, master coa, sku, tiga route `/api/w/[week]/…`) | meneruskan klien sesi halamannya ke `computeForWeek`. |
| `apps/web/lib/rebuild.ts` | `processRebuildQueue(settings, { client })`: klien eksplisit (cron memberi klien servis yang sudah dipegangnya); tanpa `client`, klien servis dibuat seperti sebelumnya. Tidak pernah klien sesi: `mart_replace` hanya untuk role servis (PRD v4 S1). |
| `apps/web/app/api/cron/rebuild/route.ts` | meneruskan `client: svc`; membaca flag lewat `modules-read.ts`. |
| `apps/web/lib/modules-read.ts` (baru) | `moduleSettingsOf(sb)` dipisah dari `modules.ts` (yang memegang `moduleSettings()` berbasis sesi); `modules.ts` mengekspornya ulang, pemanggil lama tidak berubah. |
| `apps/web/lib/schema.ts`, `schema-session.ts` (baru) | `schemaStatusOf(sb)` dan `assertSchemaCurrent(sb)` tetap di `schema.ts` (klien wajib); `schemaStatus()` dan `assertSchemaCurrent()` berbasis sesi pindah ke `schema-session.ts` (dipakai `Shell`, `modules.ts`). Alasan: `rebuild.ts` mengimpor `schema.ts`, jadi setiap impor `supabaseServer` di sana masuk ke gugus builder. |
| `tests/e2e/journey-F19.cjs` | empat XFAIL Q-v5.2-51 jadi cek biasa. |
| `.github/workflows/ci.yml` | langkah `e2e` memakai `E2E_STRICT_XFAIL=1` (tidak ada XFAIL tersisa: yang lulus tetapi masih bertanda XFAIL menggagalkan job). |

Memo per klien dan jendela hidupnya:

- App: satu klien sesi per request (`supabaseServer` ter-cache), jadi satu minggu dimuat sekali per request, seperti sebelumnya.
- Rebuild dan cron: satu klien servis per run, jadi satu minggu dimuat sekali per run. Builder hanya menulis mart, tidak menulis tabel yang dibaca `computeForWeek`, jadi memo di dalam run aman. Route handler tanpa konteks render tidak punya memo `cache`; memo per klien tetap berlaku di sana.

## Tes

`apps/web/lib/rebuild-client.test.ts` (10 tes, memakai klien memori `memSb` dan minggu emas fixture lewat `test-support/week-rows.ts`):

1. Statis: gugus impor runtime `lib/rebuild.ts` (semua builder terdaftar; 46 berkas) dan gugus route cron tidak memuat `supabaseServer`, `next/headers`, `cookies(`, `getViewer`, `requireViewer`, `moduleSettings()`, `schemaStatus()` atau `weeksCached`; setiap pemanggilan `computeForWeek` di `lib`, `app`, `components` menyerahkan klien lebih dulu; route cron menyerahkan `client: svc`.
2. `computeForWeek(sb, minggu)`: memuat dari klien yang diberikan, sekali per klien; klien lain = pembacaan lain (klien kosong/anon tidak melihat minggu, klien penuh melihat); kegagalan tidak diingat.
3. Cron = Finance: cron (klien servis diberikan, sesi kosong) menulis `pl_daily_v4` dengan angka minggu itu dan `solvency_monthly`; baris `mart_replace` identik dengan rebuild aplikasi untuk dua kasus sesi (data Finance penuh, atau kosong); klien sesi tidak pernah dibuka dan tidak pernah dibaca.

Bukti tes merah di kode lama: tes yang sama dijalankan terhadap tahap sebelum perubahan (berkas sumber di-stash, tes dan fixture tetap). Hasil (filter `cron`, 7 tes dijalankan): 5 gagal; cron tidak menulis `solvency_monthly` dan barisnya berbeda dari rebuild Finance (persis temuan F19), dan gugus builder memuat `lib/data.ts`, `lib/schema.ts`, `lib/supabase.ts`.

## Gate

| Gate | Hasil |
|---|---|
| `pnpm typecheck` | lulus |
| `pnpm test` | engine 460, parsers 27, web 639 (10 baru) |
| `pnpm parity` | 17161/17161; `docs/parity.md` dan `docs/parity-cells.csv` tidak berubah |
| `pnpm snapshot:diff` | EMPTY, byte-identical |
| `scripts/test-lint.sh`, `lint-k41.sh`, `lint-k42.sh`, `lint.py missing` | semua 0 hit |
| `pnpm test:rls` (DB `a1d_rls`, socket `/tmp`) | OK |
| `E2E_STRICT_XFAIL=1 pnpm e2e` lokal | HIJAU: prepare 3, matrix 120, T7 49, **F19 16 (0 XFAIL)**, volume 13; tak terduga 0 |
| CI | lihat bagian bukti CI di bawah |

F19 sesudah perbaikan: cron ke-1 = ke-2 (idempoten), `solvency_monthly` ditulis ulang oleh cron, dan sidik `solvency_monthly` dan `pl_daily_v4` Agustus
sesudah cron = sesudah rebuild sesi Finance (sebelumnya empat XFAIL). Tidak ada XFAIL tersisa di e2e.

## Pertanyaan baru (Q-v5.2-80 … 89)

- **Q-v5.2-80 — `supabaseServer` kini satu klien per request (cache React).** Perlu agar memo minggu per klien tetap sekali per request tanpa mengubah 119 pemanggil.
  Efek samping yang diperiksa: aksi login/logout (klien yang sama dalam satu aksi, lalu `redirect`), `setAll` cookie (satu klien menyegarkan token sekali). Route handler tidak mendapat
  memo `cache` (perilaku React di luar render), sehingga di sana tiap panggilan tetap klien baru, seperti sebelumnya. Konfirmasi dari pemilik bila ada alasan klien harus baru per panggilan.
- **Q-v5.2-81 — rebuild lewat tombol (app) kini membaca minggu dengan klien servis, bukan sesi Finance.** Sebelumnya pembaca minggu di dalam builder adalah sesi pemanggil, jadi
  hasilnya bergantung pada RLS role pemanggil (Finance/Admin). Sekarang cron dan tombol identik. Tidak ada selisih di T7, matriks, F19, dan volume di e2e; di production, bila ada
  baris yang disembunyikan RLS dari Finance tetapi terlihat servis, mart akan memuatnya sekarang (itu yang dimaksud: mart bersama tidak bergantung pada siapa yang menekan tombol).
- **Q-v5.2-82 — halaman yang menghitung dengan klien sesi (`loadCash`, `computeMonth`, kunci versi) tetap memakai RLS pemanggilnya.** Itu benar untuk tampilan; mart tetap dari klien servis.
  Bila suatu role dengan RLS lebih sempit membuka halaman bulan/kas, angka tampilan langsung bisa berbeda dari mart; hal ini tidak diuji di e2e. Tidak diubah di irisan ini.

## Terbuka

- `E2E_STRICT_XFAIL=1` di CI berarti irisan lain yang menambahkan `xcheck` harus menghapus penandanya begitu perbaikannya masuk main.
- Builder lain yang membaca lewat helper berbasis request (di luar daftar yang dipindai) akan tertangkap tes statis hanya bila memakai nama yang dipindai; aturannya ditulis di komentar `SESSION_BOUND` pada tes.
