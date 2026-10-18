# BUTUH-DIKA — data atau akses yang tidak ada di repo, berkas yang diberikan, maupun DB

Hanya data/akses, bukan keputusan (keputusan: `docs/v5/QUESTIONS.md` § "Keputusan v5.2"). Status per 18 Okt 2026.

**Paling membuka jalan (18 Okt, ±08.20 UTC).** Skema KGR-OS sudah 5.2.4 tanpa staging (keputusan Dika), FS acuan Agu–Sep
sudah diimpor (B-R91). Yang tersisa untuk Definisi Selesai 2–5 butuh **app yang berjalan terhadap KGR-OS dan bisa
digerakkan**: bangun ulang mart, minggu September, jurnal 1–31 Agu dan 1–30 Sep lewat upload, posting DI, FINAL. Itu
tidak bisa dengan SQL saja (FINAL mengunci snapshot hasil hitung app).
1. **D2** Vercel Production: `SUPABASE_SERVICE_ROLE_KEY` (KGR-OS) dan `CRON_SECRET` (`openssl rand -hex 32`); tanpa kunci
   servis, rebuild dan cron berhenti dengan "server belum punya SUPABASE_SERVICE_ROLE_KEY". Kode cron yang benar (A1d,
   #54) sudah di `main`. **Deploy production sedang tertahan kuota Vercel** ("Deployment rate limited — retry in 24
   hours", sejak ±07.40 UTC; preview cabang kini dimatikan, #55): bila sampai besok belum ada deploy `main` yang
   "Ready", tekan *Redeploy* pada commit `main` terbaru di dashboard Vercel. Alternatif: beri connector Vercel izin
   project (env, deployments) — sekarang hanya bisa melihat daftar project (detail 404, deployment 403).
2. **D4** secret repo (`SUPABASE_DB_URL` session pooler 5432, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`): workflow
   `db-ops` (backup `pg_dump` ke bucket privat, bundel lewat `psql -1`) dan langkah data lewat runner GitHub.
3. **D5** daftar user (lewat chat, bukan repo): tanpa user Finance, upload dan FINAL hanya bisa oleh Admin.
4. **D1** staging hanya untuk T19/T21/T23 (bundel tidak lagi menunggu staging).

| # | Butuh | Kenapa agen tidak bisa | Memblokir | Cara paling cepat |
|---|---|---|---|---|
| D1 | **Konfirmasi biaya project `KGR-OS-staging`** (O34 b, compute terkecil, region `ap-northeast-2`, org yang sama dengan KGR-OS) | `create_project` lewat connector Supabase timeout 60 dtk lima kali (17 Okt ×4, 18 Okt 05.3x UTC ×1); alternatif `create_branch` dari KGR-OS (org Pro) juga timeout (18 Okt), tidak ada project/branch yang terbentuk (dicek `list_projects`, `list_branches`) | semua bundel/migrasi ke KGR-OS (aturan "staging dulu"), B0-3, B2–B5, T19, T21, T23 | **buat sendiri** project `KGR-OS-staging` (Seoul, Micro) di dashboard Supabase lalu kabari "staging sudah dibuat" (connector tidak bisa membuatnya); agen mengisi migrasi, seed, user uji |
| D1 (18 Okt ±11.45 UTC) | percobaan ke-6 `create_project` `KGR-OS-staging` (org KGR-OS, Seoul) dijawab `{"status":"cancelled"}`: konfirmasi biaya tidak diberikan; tidak diulang | — | T19/T21/T23 | buat sendiri di dashboard (compute terkecil), atau setujui konfirmasi biaya saat agen mencoba lagi |
| D2 | **Vercel `kgr-weekly-outlook`**: (a) env Production `CRON_SECRET` (`openssl rand -hex 32`), dan pastikan `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (KGR-OS) ada; (b) env Preview/Development → staging (D1), bukan KGR-OS; (c) matikan auto-assign domain production untuk push `main` (O35 b) | connector Vercel sesi ini: project/env/deployment → 404/403; `*.vercel.app` diblokir dari container | cron sukses di Vercel (DoD 2), mart production terisi (DoD 3), promosi manual, ukur latensi O37 | isi di Settings → Environment Variables; **atau** beri connector Vercel izin project (env, deployments) |
| D3 | **Akses jaringan container agen**: tambahkan `*.supabase.co`, `api.supabase.com`, `*.vercel.app`, `cdn.sheetjs.com` ke Allowed domains environment Claude Code | proxy menolak (403) | e2e T19 dari container ke staging, ukur latensi, `pnpm install` dengan xlsx 0.20.3 (sementara diganti 0.18.5 lokal; CI tetap 0.20.3) | environment → Edit → Network access (https://code.claude.com/docs/en/cloud-environments#network-access) |
| D4 | **Secret GitHub** untuk `db-ops` (`STAGING_DB_URL`, `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) dan T19 (`STAGING_SUPABASE_URL`, `STAGING_ANON_KEY`, `STAGING_SERVICE_ROLE_KEY`) | proxy menolak API secrets GitHub; repo **publik**, jadi kunci tidak boleh lewat input workflow/berkas | B3/B4 lewat `db-ops`, backup pg_dump, T23, T19 (journey T7 di Supabase sungguhan) | repo → Settings → Secrets and variables → Actions |
| D5 | `docs/v5.2/users.md`: email kerja, nama, role untuk 9 role (finance, commercial_lead, sales + assignment key, ppic, operations_director, cost_accounting, inventory_accounting, purchasing, management) | tidak ada di repo; repo publik — **jangan** commit email ke repo publik; kirim lewat chat, agen mengisi KGR-OS tanpa menulis email ke repo | B-R87, DoD 8 | daftar di chat |
| D6 | Berkas yang dipakai DeepSeek tetapi tidak ter-commit: `GL KGR Rev 1.xls`, `Detail Sales September.xls`, `Valuation detail.xls`; mutasi/saldo bank harian Agu–Sep; kartu stok per item akhir Agu dan akhir Sep | **GL Agu dan Sep sudah ditemukan** di workbook FS v2 (`Agt 26` 2.431 baris, `Sep 26` 1.930 baris) dan dipakai; yang tersisa hanya pembanding (`GL KGR Rev 1.xls` berbeda 12 baris / Σ 287,3 jt dari `Sep 26`), saldo bank harian, dan kartu stok per item | rekonsiliasi kas harian dan stok per item (saldo akhir bulan tetap dari BS/TB) | unggah berkas ke chat |
| D6 (18 Okt) | jurnal Agu dan Sep **siap unggah** (berkas dikirim di chat; `SIAP-PAKAI.md` §4b); sisa D6: saldo bank harian dan kartu stok per item | — | — | — |
| D7 | Total Accurate minggu 24–30 Agu: kg penjualan aktual (laporan penjualan Accurate) dan nilai stok awal Senin 24 Agu (Inventory Valuation Accurate) — C8/C9 | tidak ada di repo; model Excel `Z_Kontrol` baris 12–13 juga "BELUM DIISI" | C8/C9 dengan `v4_release` hidup → rilis minggu contoh di production | dua angka + nama laporan Accurate |
| D8 | Data master PPIC: rentang min/maks/rata-rata kelas K/S/B, yield per kelas × pola, `size_class_map` (ukuran → kelas), kapasitas potong/chiller/ABF per hari | PRD v5 menyatakan angka mockup hanya ilustrasi (Q-v5.2-8) | kebutuhan per kelas (tanpa ini STD), C30/C47 kapasitas | tabel dari PPIC |
| D9 | **Finance: ekuitas FS b.77 selisih Rp 2,71** — laba ditahan awal di `BS - Management Report` b.71 (−2.698.434.665,91) ≠ TB/sheet `BS` (−2.698.434.668,62); FS sendiri tidak seimbang Rp −4,93 | temuan R68 (`docs/v5.2/fs-recon-fixture.md`); app tidak menyesuaikan angka (K62) | C59 ekuitas GAGAL tiap bulan pada toleransi Rp 1 (DoD 5 tetap terpenuhi lewat sebab tertulis) | koreksi b.71 di workbook FS, **atau** setujui override C59 bulanan oleh Finance dengan alasan ini |

Catatan keamanan lama tentang artifact `pg_dump` di `backup.yml` sudah selesai: dump tidak lagi diunggah sebagai artifact (#43).
