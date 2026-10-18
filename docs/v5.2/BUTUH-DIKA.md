# BUTUH-DIKA — data atau akses yang tidak ada di repo, berkas yang diberikan, maupun DB

Hanya data/akses, bukan keputusan (keputusan: `docs/v5/QUESTIONS.md` § "Keputusan v5.2"). Status per 18 Okt 2026.

**Paling membuka jalan (18 Okt): D1 + D4, dua langkah di dashboard, ±5 menit.**
1. **D1** Buat project `KGR-OS-staging` (org yang sama, Seoul `ap-northeast-2`, compute terkecil). Connector tidak bisa
   membuatnya (`create_project` timeout ×5, `create_branch` timeout).
2. **D4** Isi secret repo (Settings → Secrets and variables → Actions), connection string **session pooler port 5432**
   (Project → Connect → Session pooler; runner GitHub tanpa IPv6):
   `STAGING_DB_URL` (staging), `SUPABASE_DB_URL` (KGR-OS), `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` (KGR-OS, untuk
   bucket privat `backups`); untuk T19 juga `STAGING_SUPABASE_URL`, `STAGING_ANON_KEY`, `STAGING_SERVICE_ROLE_KEY`.

Sesudah itu agen menjalankan sendiri lewat workflow `db-ops` (PR #46): migrasi + seed staging, test:rls staging (T21),
bundel di staging, backup `pg_dump` KGR-OS ke bucket privat, uji kering + bundel v5.1 dan B2 ke KGR-OS, uji pulih (T23).
D3 (jaringan container ke `*.supabase.co`) tetap mempercepat B6 (upload lewat app ke KGR-OS) tetapi tidak lagi
memblokir B3/B4. Yang tetap butuh Dika: D2 (env Vercel dan promosi), D5 (email user), D7/D8/D9 (angka dan keputusan
yang tidak ada di sumber mana pun).

| # | Butuh | Kenapa agen tidak bisa | Memblokir | Cara paling cepat |
|---|---|---|---|---|
| D1 | **Konfirmasi biaya project `KGR-OS-staging`** (O34 b, compute terkecil, region `ap-northeast-2`, org yang sama dengan KGR-OS) | `create_project` lewat connector Supabase timeout 60 dtk lima kali (17 Okt ×4, 18 Okt 05.3x UTC ×1); alternatif `create_branch` dari KGR-OS (org Pro) juga timeout (18 Okt), tidak ada project/branch yang terbentuk (dicek `list_projects`, `list_branches`) | semua bundel/migrasi ke KGR-OS (aturan "staging dulu"), B0-3, B2–B5, T19, T21, T23 | **buat sendiri** project `KGR-OS-staging` (Seoul, Micro) di dashboard Supabase lalu kabari "staging sudah dibuat" (connector tidak bisa membuatnya); agen mengisi migrasi, seed, user uji |
| D2 | **Vercel `kgr-weekly-outlook`**: (a) env Production `CRON_SECRET` (`openssl rand -hex 32`), dan pastikan `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (KGR-OS) ada; (b) env Preview/Development → staging (D1), bukan KGR-OS; (c) matikan auto-assign domain production untuk push `main` (O35 b) | connector Vercel sesi ini: project/env/deployment → 404/403; `*.vercel.app` diblokir dari container | cron sukses di Vercel (DoD 2), mart production terisi (DoD 3), promosi manual, ukur latensi O37 | isi di Settings → Environment Variables; **atau** beri connector Vercel izin project (env, deployments) |
| D3 | **Akses jaringan container agen**: tambahkan `*.supabase.co`, `api.supabase.com`, `*.vercel.app`, `cdn.sheetjs.com` ke Allowed domains environment Claude Code | proxy menolak (403) | e2e T19 dari container ke staging, ukur latensi, `pnpm install` dengan xlsx 0.20.3 (sementara diganti 0.18.5 lokal; CI tetap 0.20.3) | environment → Edit → Network access (https://code.claude.com/docs/en/cloud-environments#network-access) |
| D4 | **Secret GitHub** untuk `db-ops` (`STAGING_DB_URL`, `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) dan T19 (`STAGING_SUPABASE_URL`, `STAGING_ANON_KEY`, `STAGING_SERVICE_ROLE_KEY`) | proxy menolak API secrets GitHub; repo **publik**, jadi kunci tidak boleh lewat input workflow/berkas | B3/B4 lewat `db-ops`, backup pg_dump, T23, T19 (journey T7 di Supabase sungguhan) | repo → Settings → Secrets and variables → Actions |
| D5 | `docs/v5.2/users.md`: email kerja, nama, role untuk 9 role (finance, commercial_lead, sales + assignment key, ppic, operations_director, cost_accounting, inventory_accounting, purchasing, management) | tidak ada di repo; repo publik — **jangan** commit email ke repo publik; kirim lewat chat, agen mengisi KGR-OS tanpa menulis email ke repo | B-R87, DoD 8 | daftar di chat |
| D6 | Berkas yang dipakai DeepSeek tetapi tidak ter-commit: `GL KGR Rev 1.xls`, `Detail Sales September.xls`, `Valuation detail.xls`; mutasi/saldo bank harian Agu–Sep; kartu stok per item akhir Agu dan akhir Sep | **GL Agu dan Sep sudah ditemukan** di workbook FS v2 (`Agt 26` 2.431 baris, `Sep 26` 1.930 baris) dan dipakai; yang tersisa hanya pembanding (`GL KGR Rev 1.xls` berbeda 12 baris / Σ 287,3 jt dari `Sep 26`), saldo bank harian, dan kartu stok per item | rekonsiliasi kas harian dan stok per item (saldo akhir bulan tetap dari BS/TB) | unggah berkas ke chat |
| D7 | Total Accurate minggu 24–30 Agu: kg penjualan aktual (laporan penjualan Accurate) dan nilai stok awal Senin 24 Agu (Inventory Valuation Accurate) — C8/C9 | tidak ada di repo; model Excel `Z_Kontrol` baris 12–13 juga "BELUM DIISI" | C8/C9 dengan `v4_release` hidup → rilis minggu contoh di production | dua angka + nama laporan Accurate |
| D8 | Data master PPIC: rentang min/maks/rata-rata kelas K/S/B, yield per kelas × pola, `size_class_map` (ukuran → kelas), kapasitas potong/chiller/ABF per hari | PRD v5 menyatakan angka mockup hanya ilustrasi (Q-v5.2-8) | kebutuhan per kelas (tanpa ini STD), C30/C47 kapasitas | tabel dari PPIC |
| D9 | **Finance: ekuitas FS b.77 selisih Rp 2,71** — laba ditahan awal di `BS - Management Report` b.71 (−2.698.434.665,91) ≠ TB/sheet `BS` (−2.698.434.668,62); FS sendiri tidak seimbang Rp −4,93 | temuan R68 (`docs/v5.2/fs-recon-fixture.md`); app tidak menyesuaikan angka (K62) | C59 ekuitas GAGAL tiap bulan pada toleransi Rp 1 (DoD 5 tetap terpenuhi lewat sebab tertulis) | koreksi b.71 di workbook FS, **atau** setujui override C59 bulanan oleh Finance dengan alasan ini |

Catatan keamanan (bukan permintaan): `.github/workflows/backup.yml` menyimpan `pg_dump` production sebagai artifact
workflow. Di repo publik artifact bisa diunduh pengguna GitHub mana pun. Jangan isi secret `SUPABASE_DB_URL` sebelum
langkah artifact dihapus (agen akan mengubah workflow di PR B berikutnya).
