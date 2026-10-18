# Kesiapan pilot 19 Okt 2026 — laporan review v5.2 (PRD v5.3 bab "Kesiapan pilot")

18 Okt 2026 malam (UTC) · Reviewer: Fable (agen) atas penugasan Dika · Basis kode: `main` `9d10f83` (= production per GitHub
Deployments 7156264852, 14.57 UTC) · Database: KGR-OS `pczjhmzpkknzkziipvit`, `schema_version()` 5.2.6 (dibaca lewat connector,
hanya SELECT, 18 Okt ±15.10 UTC).

Semua klaim "lulus" menyebut lingkungannya: **vitest** (klien memori, tanpa RLS), **PG16 lokal + shim** (`test-rls.sh`), **PG16
lokal + PostgREST 12 + mock auth** (stack e2e, *bukan Supabase*), **KGR-OS (connector)**, **CI run N**. Tidak ada klaim untuk
production selain yang dibaca dari GitHub Deployments dan KGR-OS.

## 1. Tiga status per area

| Area | Code complete | Deployed (production) | Business ready | Bukti |
|---|---|---|---|---|
| Login, role, navigasi per peran | ya | ya (`9d10f83`) | ya untuk Admin; peran lain **belum ada akunnya** (KGR-OS: 1 `app_user`) | CI run 39138187255 hijau; smoke `ops/smoke`; KGR-OS SELECT 18 Okt |
| Upload Finance / Inventory Accounting (TB, jurnal, DI, bank, stok) | ya | ya | **belum**: 0 `upload` di KGR-OS; jurnal hanya ekspor lama 1–26 Agu (1.840 baris) | KGR-OS SELECT; SIAP-PAKAI §4b |
| Rebuild mart + cron | ya (V8 diperketat, PR #66) | kode ya; **tidak jalan** tanpa D2 | **belum**: `data_status` 0 baris, 7 tanggal 24–30 Agu masih `queued`; 42 baris `done` adalah "di luar jendela data", bukan mart | `rebuild.ts:109` `REBUILD_NO_KEY`; KGR-OS SELECT |
| Komitmen Sales, price list, penugasan Sales | ya (V10 diperketat, PR #68) | ya | **belum**: 0 `sales_assignment`, 0 user Sales; minggu 19 Okt belum dibuat (hanya minggu 24 Agu) | KGR-OS SELECT; e2e A7, L hijau di CI main |
| Rencana PPIC (demand → kelas → batch) | ya | ya | **belum**: master kelas/yield/kapasitas (D8) belum ada → semua kelas STD | PRD v5.3 bab Masalah; e2e T7/O hijau |
| Keputusan harga LB (K25, tile simulasi) | ya | ya | **tidak**: input simulasi angka contoh (V4: breakeven 19.466 vs aktual 23.211–24.818); label "contoh" belum ada (R97, agen pembangun) | `supabase/seed/06_sku_price.sql`, `ppic-data.ts:179-187`; layar 18 Okt |
| Rilis minggu (JSON + PDF + `release_week`) | ya (V7 diperketat, PR #67) | ya | **belum**: 0 `release`; grid kelengkapan butuh rebuild (D2) → K45 menolak rilis sampai grid dibangun | `release.ts`; e2e P hijau |
| Manajemen (Minggu ini, P&L, kartu) | ya | ya | **tidak** sebagai angka resmi: kartu Stok/Kas bersumber seed/parity dengan label "belum ada" (V5); FS acuan ada tetapi `fs_line_map` 15 baris draft (V3) | tangkapan layar 1366/390 (PG16 lokal); KGR-OS SELECT |
| Flag v5 | ya | ya, 6 flag `v5_*` hidup untuk semua role | keputusan Dika (V11) | KGR-OS SELECT `app_setting` |

## 2. Status V1–V13 dan temuan baru

Tingkat: **P0** memblokir pemakaian terkontrol; **P1** salah atau tidak aman bila terjadi; **P2** konsistensi. "Terbukti" =
dibaca di kode/tes/DB, bukan dari dokumen.

| ID | Terbukti? | Jalur kegagalan | Lokasi | Tingkat | Tindakan |
|---|---|---|---|---|---|
| V1 | **ya** | Tanpa `SUPABASE_SERVICE_ROLE_KEY` `supabaseService()` null → `processRebuildQueue` kembali `REBUILD_NO_KEY`; cron 503; antrean diam. Halaman tetap terbuka (pesan, bukan crash): tes `fail-closed` "503 without key", `rebuild-client` "without a service key nothing is built", `release-rebuild` "tanpa kunci servis" (vitest) | `apps/web/lib/rebuild.ts:106-109`, `modules-core.ts:169`, `app/api/cron/rebuild/route.ts:20-21` | P0 (operasional) | **butuh Dika**: D2 lalu Redeploy; sesudah itu Admin → Modul → Bangun ulang (7 tanggal 24–30 Agu) |
| V2 | **ya** (tidak ada bukti e2e dengan pengguna nyata; e2e sintetis ada) | — | CI e2e: matrix 120, T7 58, A6 82, A7 78, L 38, P 16, R69 66, F19 16, volume 13 (PG16 lokal) | P0 untuk "business ready" | **butuh Dika**: akun per role (D5), satu siklus nyata minggu 19 Okt |
| V3 | **ya** | KGR-OS: `gl_line` s.d. 26 Agu; 0 `upload`, 0 `cash_daily`, 0 `stock_card_snapshot`, 0 `release`; `fs_line_map` 15 draft | KGR-OS SELECT 18 Okt | P0 untuk angka resmi | **butuh Dika**: B-R90 berurutan (SIAP-PAKAI §4b); kontrol tidak dipaksa hijau (K62) |
| V4 | **ya** | Seed `RPA|Karkas|n/a` 30.000 "contoh", Kepala 4.029, Ceker 3.101, Lemak Fresh kosong; tarif default `parameter` → breakeven 19.466 | `supabase/seed/06_sku_price.sql:20-32`, `ppic-data.ts:179-187` | P0 untuk Direktur Operasional | **ditunda ke R97/R96 (agen pembangun)**; sementara langkah data tanpa kode PRD v5.3 (Parameter, yield matrix, Harga, item_map) |
| V5 | **ya** | `loadSources` tidak menemukan kartu stok / `cash_daily` di periode → label "… · belum ada", padahal kartu berangka (685,4 jt / 289,7 jt di data uji; 2.782,2 jt / 289,7 jt di production) | `management-data.ts:236-243`, `management.ts:56` | P1 | **ditunda ke R97** (label "contoh"), Q-v5.3-5; tile K25 tidak disentuh reviewer |
| V6 | **ya** | Policy `batch_read`, `release_read` dibuat untuk semua `is_app_user()` (loop generik) → Sales membaca `lb_price`, `freight`, `maklon`, `release.snapshot` lewat PostgREST | `supabase/migrations/20261014000200_security.sql:158-164`; Q-v5.2-85/86 | P1; blocker bila rahasia | **butuh Dika** (keputusan). Perbaikan nyata = outlook Sales dihitung di server dengan klien servis (usulan v5.3), bukan pekerjaan satu malam |
| V7 | **ya** | Unggah JSON → unggah PDF → RPC; RPC menolak (cek ulang transaksi) atau PDF gagal → berkas tanpa baris rilis; sesi tidak punya policy delete | `release.ts:100-113` (sebelum) | P1 | **diperbaiki PR #67**: hapus kompensasi dengan klien servis, sisa dicatat per path; 6 tes vitest merah→hijau. Policy delete → Q-v5.3-1 |
| V8 | **ya** | `select … status='queued'` lalu `update status='running'` tanpa syarat → cron + tombol membangun tanggal yang sama dua kali (tes: 4 ≠ 2) | `rebuild.ts:125-146` (sebelum) | P1 | **diperbaiki PR #66**: klaim = update bersyarat + returning; 3 tes vitest merah→hijau |
| V9 | **ya** | `done` ditulis untuk "di luar jendela" (42 baris di KGR-OS, 0 `data_status`); `data_status.status` selalu `draft`; tidak ada completeness/freshness/reconciliation per mart | `rebuild.ts:120-123`, `20261017000200_v4_security.sql:45-50` | P1 | **ditunda**: butuh desain + skema (Q-v5.3-2); vonis "dashboard bukan angka resmi" tetap |
| V10 | **sebagian** | Akses **tidak** memakai nama (`sales_line_in_scope` per e-mail, `assignment_covers`). Nama hanya `sales_rep`: kunci unik + label scorecard/kontrol. Dua Sales bernama sama dengan key berbeda → satu rep di scorecard; penjaga lama hanya untuk key+pelanggan sama | `assignment.ts:90`, `actions.ts:66-69`, `v52_security.sql:215-223` | P2 (pelaporan), bukan akses | **diperbaiki PR #68**: nama rep milik e-mail lain ditolak apa pun key-nya; tes ganti nama dan deaktivasi ditambah. ID pengguna → Q-v5.3-3 |
| V11 | **ya** | 6 flag `v5_*` `{"enabled": true}` tanpa `roles` | KGR-OS SELECT `app_setting` | P1; keputusan | **butuh Dika** (tetap / `{"roles":["admin"]}`); reviewer tidak mengubah flag |
| V12 | **ya** | SIAP-PAKAI menyebut `85f7684`; REVIEW-CONTEXT `6f9757f`; production nyata `9d10f83` (GitHub Deployments, success 14.57 UTC). Kode aplikasi ketiganya sama; yang berbeda hanya dokumen | `docs/v5.2/SIAP-PAKAI.md` baris 3 | P2 | **diperbaiki** di PR dokumen ini: SIAP-PAKAI merujuk GitHub Deployments, bukan hash tetap |
| V13 | **ya** | CI run 39135162350 (`5a6613c`): hanya job e2e merah, T7 1b role sales `/w/2026-08-24/input/harga` React #418; a8.md §2.5: sebab tidak ditemukan | branch `v5.2/a8-fixes` | P2 | **ditunda**: tidak di-merge demi tanggal (§3.11); Q-v5.3-4. Dampak besok: Kepala Sales mengetik ulang komitmen bila simpan ditolak (Q-v5.2-114) |

Temuan baru:

| ID | Temuan | Lokasi | Tingkat | Tindakan |
|---|---|---|---|---|
| N1 | Satuan "Rp jt" terpotong ("Rp j") pada kartu 2 kolom di 390 px (Manajemen, Commercial, Outlook Agustus, Solvabilitas) | `apps/web/app/v4.css:171-173`, `.card-n` nowrap | P2 (mobile) | Q-v5.3-6; perbaikan CSS kecil di PR UI terpisah bila CI sempat; bukan penghalang pilot |
| N2 | Chip langkah PPIC di 390 px menempelkan nomor dan nama ("Langkah 1Demand") | komponen langkah Rencana PPIC | P2 (mobile) | dicatat; bersama N1 |
| N3 | Tidak ada menu mobile (hamburger); nav atas membungkus 3–4 baris di 390 px. Semua tautan tetap bisa diklik, tidak ada scroll samping halaman | `v4.css:165-170` | P2 | gap mobile; restyle besar tidak sebelum pilot |
| N4 | `rebuild_queue` baris `running` > 15 menit direset tanpa melihat apakah run masih hidup (K61) — bersama V8 risiko kecil: run lambat >15 menit bisa dibangun lagi oleh run berikutnya | `rebuild.ts:117` | P2 | diterima untuk pilot (budget cron 50 dtk, tombol 7 tanggal); catat |
| N5 | KGR-OS `rebuild_queue`: 7 baris 24–30 Agu `queued` sejak 17 Okt; tanpa D2 akan tetap begitu dan STALE menahan rilis minggu itu | KGR-OS SELECT | P0 (operasional) | sama dengan V1 |
| N6 | React #418 (hidrasi) intermiten **di `main`**: 2 dari 420 muatan sapuan (Admin `/w/…/input/harga` 1366, `/master/item` 390), sama dengan kegagalan CI A8. Halaman tetap berfungsi (React render ulang di klien) | belum diketahui; komponen klien bersama: `Shell` → `WeekSelect`, `ViewToggle` (`usePathname`/`useSearchParams`) | P2 (tidak merusak data; mengganggu CI e2e sewaktu-waktu) | ditunda: cari sebab dengan `next dev` di luar sandbox; Q-v5.3-4 diperluas. CI PR hari ini bisa merah karena ini — ulang sekali, bukan dilewati |
| N7 | Halaman 404 memakai bawaan Next berbahasa Inggris ("404: This page could not be found.") untuk setiap `notFound()` per role | tidak ada `app/not-found.tsx` | P2 | **diperbaiki PR UI**: `not-found.tsx` Bahasa Indonesia, status tetap 404 |
| N8 | Outlook bulan (`/m/2026-08`, Finance) scroll samping di 390 px: header tile P&L tidak membungkus | `v4.css` `.tile-h`/`.tile-x` | P2 (mobile) | **diperbaiki PR UI** |

## 3. GO / NO-GO 19 Okt per pemakaian

| Pemakaian 19 Okt | Vonis PRD | Vonis reviewer | Syarat |
|---|---|---|---|
| Admin dan uji pengguna | GO terbatas | **GO terbatas** | Tanpa D2 rebuild/cron/rilis tidak jalan; halaman tetap terbuka dengan pesan. D2 + Redeploy dulu kalau mau uji rebuild |
| Pelatihan Finance, Sales, PPIC dengan skenario terkontrol | GO sesudah D2, minggu 19 Okt, akun | **GO sesudah D2, minggu 19 Okt, akun pengguna, penugasan Sales** — dan **sesudah PR #66–#68 di-merge** (satu deploy) | Sales: tunggu keputusan V6 bila harga beli LB rahasia. Kepala Sales: tahu bahwa form komitmen kosong lagi bila ditolak (A8 tertahan) |
| Dashboard sebagai angka resmi operasional | NO-GO | **NO-GO** | V3 (data), V4/V5 (angka contoh berlabel "belum ada"), V9 (status mart) |
| Output sebagai laporan manajemen final | NO-GO | **NO-GO** | satu siklus nyata terekonsiliasi (C59 dengan `fs_line_map` disetujui Finance, C13, C8/C9) |

## 4. Yang dikerjakan reviewer (PR, semua dari `main` `9d10f83`)

| PR | Tema | Tes merah→hijau | Gate lokal | CI |
|---|---|---|---|---|
| #66 `v5.3/review-v8-rebuild-claim` `e4c492a` | V8 klaim antrean atomik | `rebuild-claim.test.ts` 3 (vitest) | typecheck 0; web 857; K41/K42/missing 0; parity dan snapshot tidak tersentuh | **hijau**: run 39140770684 (PR) dan 39140703069 (push): engine, lint, rls, e2e success |
| #67 `v5.3/review-v7-release-orphans` `87c1464` | V7 berkas rilis yatim | `release-orphans.test.ts` 6 (vitest) | typecheck 0; web 860; lint 0 | **hijau**: run 39140802143 (PR) dan 39140767441 (push). Run 39140705259 (`fb7390a`, sebelum amend) merah di lint K41 — diperbaiki sebelum PR dibuka |
| #68 `v5.3/review-v10-sales-rep` `22143ca` | V10 satu nama = satu Sales | `assignment-actions.test.ts` +3 (vitest) | typecheck 0; web 857; lint 0 | **hijau**: run 39140829745 (PR) dan 39140798126 (push) |
| PR UI (cabang `v5.3/review-ui-390`) | N1, N2, N7, N8: CSS 390 px dan `not-found.tsx` | tangkapan layar sebelum/sesudah (PG16 lokal); e2e matrix lokal | typecheck 0 | lihat PR |
| PR dokumen (cabang `v5.3/review-docs`) | V12 SIAP-PAKAI, Q-v5.3-1…6, CHANGELOG, laporan ini | — | — | lihat PR |

Baseline `main` sebelum perubahan: typecheck 0; vitest engine 467, parsers 31, web 854; parity 17.161/17.161; `snapshot:diff`
EMPTY; lint K41/K42/missing 0; `test-rls.sh` 48 blok, 0 `(!)`, check-query-columns 0 unknown (PG16 lokal + shim); e2e matrix 120
lulus (PG16 lokal + PostgREST 12 + mock auth, stack lokal reviewer).

Merge: dikumpulkan — satu kali ke `main` (tiga PR berurutan, deploy production terakhir yang dihitung), sesudah CI hijau di
masing-masing. Reviewer **tidak** melakukan merge sendiri; Dika yang menekan merge atau memberi izin di percakapan.

Tidak disentuh: KGR-OS (hanya SELECT), flag, env Vercel, user, `computeWeek`, golden v1, parity, snapshot, `v5.2/a8-fixes`.

## 5. Checklist UI (PG16 lokal + PostgREST 12 + mock auth, data e2e; 10 role × 21 alamat × 2 lebar = 420 muatan)

Sapuan Playwright (Chromium, `id-ID`, `Asia/Jakarta`; skrip reviewer, bukan bagian repo) pada stack e2e lokal dari `main`
`9d10f83`, jam uji 27 Agu 2026:

| Ukuran | Hasil |
|---|---|
| Status HTTP | 328 × 200, 92 × 404. Semua 404 adalah `notFound()` per role (mis. Sales → `/kas`, PPIC → `/komersial`) atau alamat tebakan reviewer (`/w/…/ppic` tidak ada; PPIC = `/w/…/rencana`). Tidak ada 5xx |
| Pengalihan per role | `/admin/*` dialihkan ke halaman awal role (Kepala Sales → `/komersial`, Finance → `/m/2026-08`, PPIC → `/w/…/rencana`, …); Manajemen dan Direktur Operasional dialihkan dari halaman input ke `/minggu-ini` |
| Galat JS halaman | **2 × React #418** (hidrasi) dari 420 muatan: Admin 1366 `/w/2026-08-24/input/harga`, Admin 390 `/master/item`. Sama dengan kegagalan CI A8 (T7 1b, role sales, `/input/harga`): **ada di `main`, bukan khusus A8**, intermiten (~0,5%). React 19 memulihkan dengan render ulang di klien; pengguna tidak melihat halaman rusak. Sebab belum ditemukan (a8.md §2.5); dicatat di Q-v5.3-4 |
| Scroll samping di 390 px | 5 muatan, semuanya Finance di `/m/2026-08` (Outlook bulan; `scrollWidth` 431): header tile P&L (segmen "Actual vs run-rate · Per minggu · cara hitung") tidak membungkus. **Diperbaiki** di PR UI (`.tile-h, .tile-x { flex-wrap: wrap }` ≤ 899 px). Halaman lain 0 |
| Judul, deskripsi, ikon | `<title>` "KGR Weekly Outlook" dan `meta description` di semua 348 halaman 200; `icon.svg` di semua. Halaman 404 berjudul "404: This page could not be found." (bawaan Next, Inggris) — **diperbaiki** di PR UI (`app/not-found.tsx` Bahasa Indonesia). Judul per halaman belum ada (gap kecil, ditunda) |
| `<h1>` | ada di semua halaman 200 |
| Kata placeholder | hanya sebagai label angka contoh ("yield per kelas (placeholder sampai diisi PPIC)", catatan `yield_matrix` "Placeholder: yield v1 × …", entri audit) — sesuai aturan: diberi label, tidak dihapus. Tidak ada teks UI kosong/lorem |
| Tombol nonaktif | hanya yang berarti: "Pratinjau" sebelum berkas dipilih, "Cek tempelan" sebelum tempel, "Salin ke batch rencana" saat gerbang salin menahan, "Kunci V1/V2" bila sudah terkunci, "Alokasikan hari ini"/"Cut-off" bagi role yang bukan PPIC/Admin, "Rilis outlook" saat kontrol menahan. Alasannya tertulis di dekat tombol |
| Teks error vs kosong | "gagal dimuat (…)" hanya bila pembacaan gagal (K41); "belum ada" / "BELUM DIISI" untuk data kosong. Tidak ada tile error yang tampil sebagai "belum ada" di sapuan ini |

Tangkapan layar yang dibaca reviewer (1366 dan 390): Manajemen Minggu ini, Commercial (Sales), Rencana PPIC, Penugasan Sales,
Input Finance, Kas, Upload, Admin → Modul. Temuan N1–N3, N8 di §2.

Yang sudah terlihat dari tangkapan layar:

- **Konsistensi**: warna, ukuran huruf, radius dari `v4.css` (`--fs-*`, `--radius`, `--accent`); komponen kartu/tile sejenis
  tampil sama di Manajemen, Commercial, PPIC. Belum ada `DESIGN.md`; `reference/design/tokens.css` dan `grammar.css` adalah sumber.
- **390 px**: tidak ada scroll samping halaman; tabel scroll di dalam tile (kolom pertama sticky). Kartu 2 kolom memotong satuan
  (N1). Nav membungkus tanpa menu mobile (N3). Target tap ≥ 44 px untuk tombol dan segmen (`v4.css:178`).
- **State**: loading = streaming tile; kosong vs error dibedakan per tile (K41: "gagal dimuat (…)" vs "belum ada"); form
  komitmen/penugasan menampilkan galat di bawah form, pesan berhasil/gagal dari server action.
- **Judul, deskripsi, favicon**: `layout.tsx` metadata satu untuk semua halaman ("KGR Weekly Outlook"); `icon.svg` ada. Tidak ada
  judul per halaman (`<title>` sama di semua halaman) — gap kecil, dicatat.
- **Placeholder**: teks "placeholder" muncul sebagai label data ("yield per kelas (placeholder sampai diisi PPIC)"), bukan teks
  UI kosong — itu label angka contoh, sesuai aturan (jangan dihapus, diberi label).
- **Arah Manajemen (BI ala samb-bi)**: gap = tidak ada filter global (periode/segmen) lintas tile, tidak ada drill-down dari kartu
  ke tabel sumber selain "cara hitung", tidak ada perbandingan periode di kartu selain Δ minggu lalu, tidak ada ekspor data per
  tile. Tidak di-restyle sebelum pilot.

## 6. Daftar untuk Dika, berurutan

1. **Putuskan tiga hal di percakapan** (tidak ada yang bisa dikerjakan agen tanpa ini): (a) V6 — apakah harga beli LB, angkut,
   maklon dan `release.snapshot` rahasia bagi Sales; bila ya, akun Sales menunggu; (b) V11 — flag v5 tetap untuk semua role atau
   `{"roles":["admin"]}`; (c) peserta pilot dan cakupan.
2. **D2** — Vercel → `kgr-weekly-outlook` → Settings → Environment Variables → Production: `SUPABASE_SERVICE_ROLE_KEY` (Supabase →
   KGR-OS → Project Settings → API Keys → service_role) dan `CRON_SECRET` (`openssl rand -hex 32`). Jangan Redeploy dulu.
3. **Merge PR #66, #67, #68** (urutan bebas; semua dari `main` yang sama; cek CI hijau di tiap PR), lalu PR dokumen. Satu deploy
   production dihasilkan tiap merge; kuota Hobby cukup (4 deploy). Sesudah merge terakhir: GitHub → Deployments → Production
   harus "success" pada commit merge terakhir; env D2 ikut terbaca oleh deploy itu (tidak perlu Redeploy terpisah).
4. **Admin → Modul → "Bangun ulang"**: 7 tanggal 24–30 Agu selesai tanpa pesan kunci servis. Bila masih "server belum punya
   SUPABASE_SERVICE_ROLE_KEY", deploy belum memuat env: Vercel → Deployments → Redeploy.
5. **Admin → Minggu → "Buat minggu kosong"**: minggu 19 Okt 2026, tanggal TB.
6. **Admin → Pengguna**: buat akun per peran pilot (e-mail kerja, nama, peran; kata sandi sementara ≥ 10 karakter). Dua Sales
   tidak boleh bernama persis sama (PR #68 menolak; beri pembeda).
7. **Komersial → Penugasan Sales** (`/komersial/assignment`): key dasar (`RPA|Karkas`) per Sales yang membuat komitmen.
8. **Langkah data tanpa kode PRD v5.3** untuk simulator K25 minggu 19 Okt: Input → Parameter (susut 6,2%, angkut 549, maklon
   1.464, yield atas kg diproses); Input → Upload "PPIC — yield matrix" (kelas STD, berlaku 19 Okt); Input → Harga (price list
   Commercial; Kepala, Ceker, Lemak wajib; Karkas n/a kosong); Master → item_map karkas. Cek: nilai jual ≈ 25.990/kg LB,
   breakeven ≈ 24.070 pada harga September.
9. **Upload jurnal Agustus dan September** (SIAP-PAKAI §4b) sebagai Admin/Inventory Accounting, lalu DI, bank, stok, FINAL per
   bulan (B-R90). Sampai ini selesai, dashboard bukan angka resmi.
10. **Beri tahu agen cabang `v5.2/a8-fixes`** bahwa A8 tidak di-merge untuk 19 Okt; lanjutkan mencari sebab #418.
