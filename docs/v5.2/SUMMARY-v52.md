# PRD v5.2 — ringkasan penutupan

Tanggal: 18 Okt 2026 · Pelaksana: agen Claude Code atas delegasi Dika (brief 17 Okt 2026; keputusan "langsung aja merge di
database utama gak usah staging", 18 Okt). Dokumen rinci: status per requirement `docs/v5.2/status-r.md`, langkah dan bukti
`docs/v5.2/PROGRESS.md`, semua perubahan di KGR-OS `docs/v5.2/kgr-os-log.md`, keputusan `docs/v5/QUESTIONS.md` (Q-v5.2-1…102),
kebutuhan dari Dika `docs/v5.2/BUTUH-DIKA.md`.

**Status: penutupan sesi 18 Okt.** Langkah Dika untuk mulai memakai app 19 Okt: `docs/v5.2/SIAP-PAKAI.md`.

## 1. Definisi Selesai (brief Bab 2)

| # | Butir | Status | Lingkungan dan bukti |
|---|---|---|---|
| 1 | KGR-OS v5.2, `schema_version()` = `EXPECTED_SCHEMA` | **lulus** | KGR-OS 5.2.6 (connector, 18 Okt 09.47 UTC); Production deploy 7152837375 `85f7684`, `EXPECTED_SCHEMA` 5.2.6 |
| 2 | Antrean 0 queued/failed; cron sukses di Vercel | **belum** | 7 queued 24–30 Agu. Cron dan rebuild butuh `SUPABASE_SERVICE_ROLE_KEY` + `CRON_SECRET` di Vercel (D2). Kode cron yang benar (A1d #54) sudah di production |
| 3 | Mart production 24 Agu–30 Sep | **belum** | butuh 2, dan data Sep (D2, D3/D4, D5) |
| 4 | FINAL Agu & Sep, C12/C49 LULUS | **belum** | butuh 3 dan jurnal 27–31 Agu, 1–30 Sep lewat app (B-R90) |
| 5 | FS v2 diimpor, C59 Agu/Sep | **sebagian** | FS Agu–Sep diimpor ke KGR-OS (B-R91, cek 11/11, angka PRD cocok); penilaian C59 butuh mart (3) dan `fs_line_map` disetujui Finance; D9 (ekuitas Rp 2,71, sebab tertulis) |
| 6 | CI `main` engine/lint/rls/e2e hijau; T7 di CI dan staging; matriks R72 | **sebagian** | CI `main` 4 job hijau: matriks 120, O 15, T7 58, A6 82, L 34, P 16, R69 65, F19 16, volume 13, 0 XFAIL (PG16 + PostgREST 12 + mock auth). Smoke production dari runner GitHub (`ops/smoke`) lulus. T19 di staging belum (D1, D4) |
| 7 | Parity 17.161/17.161, snapshot byte-identik | **lulus** | `pnpm parity` 17161/17161, `snapshot:diff` EMPTY (container cloud, gate tiap irisan; terakhir A6 `b3982bb`) |
| 8 | Flag v5 untuk semua role sesudah T19 | **sebagian** | 6 flag `v5_*` dibuka untuk semua role 18 Okt ±10.10 UTC atas arahan "siap dipakai besok" (Q-v5.2-103, menunggu konfirmasi Dika), **tanpa** T19 |
| 9 | R41–R79, B-R80–B-R94 berstatus | **lulus** (dokumen ada) | `docs/v5.2/status-r.md`: 43 lulus (semua R41–R79), 8 sebagian, 3 belum (B-R87, B-R90, B-R92) |

## 2. Yang diterapkan di KGR-OS (`pczjhmzpkknzkziipvit`)

Setiap langkah: backup dalam DB (`bak_<UTC>`, Q-v5.2-1) lebih dulu; bundel satu panggilan atomik; tabel cek harus semua true;
sesudahnya sidik skema (kolom, fungsi, policy, trigger, view, indeks, constraint, ACL) dibandingkan dengan PG16 lokal yang memuat
migrasi yang sama.

| Waktu (UTC) | Langkah | Hasil |
|---|---|---|
| 17 Okt (WIB) | B0 flag/antrean, B1 jadwal beban tetap, B-R89 `coa_map` | cek 3/3, 5/5 |
| 18 Okt 06.14–06.27 | bundel v5.1, B2, B5 | cek 12/12, 24/24, 26/26; sidik 9/9 (sesudah perbaikan `norm_code` karena transport mengubah `\uXXXX`) → 5.2.4 |
| 06.42 | mode memo O24(b) | `v5_pl.costing_rows_mode = memo` |
| 08.09 | B-R91 impor FS Agu–Sep | cek 11/11; md5 146 baris = lokal |
| 08.21 | B6 (Sales tanpa `plan_week`/`demand_weekly`), sesudah A1c di production | cek 15/15; sidik 9/9 → 5.2.5 |
| 08.30 | B7 (Sales tanpa `plan_day` dan turunannya) | cek 16/16; sidik 9/9 → 5.2.6 |

Data: tidak ada baris yang diubah selain yang disebut (verifikasi manifest `bak_20261018t0612`). Staging tidak dipakai atas
keputusan Dika; T19/T21/T23 tetap butuh staging.

## 3. Kode (PR ke `main`, semua CI hijau sebelum merge)

| PR | Isi |
|---|---|
| #37, #38 | A1 gagal-tertutup R41–R47, lint K41/K42 |
| #40 | BT-1 parser GL gagal-tertutup |
| #41, #47 | B2 (meta, keamanan, rilis), B5 (costing, FS) |
| #42, #49 | A4 rekonsiliasi FS R68–R69, C59 |
| #43, #46, #48 | backup.yml tanpa artifact dump; workflow `db-ops` |
| #44, #50 | A1b K69 `update_date`, banner `schema_version()` |
| #45 | A2 putaran PPIC–Komersial R48–R58 |
| #51 | A3 costing dan P&L R59–R67, lint `missing` |
| #52 | A5 e2e + job CI `e2e` R70–R74 |
| #53 | A1c objek B5 di kode, Sales tanpa baca rencana (sisi kode); perbaikan `test-rls.sh` (pipa + pipefail) |
| #54 | A1d cron dan builder memakai klien pemanggil (Q-v5.2-51) |
| #55 | Vercel deploy hanya `main` (kuota deploy habis oleh preview) |
| #56 | dokumen + `scripts/fs_import.py` (B-R91) |
| #57, #58 | B6, B7 (sudah di KGR-OS sebelum merge) |
| #59 | `EXPECTED_SCHEMA` 5.2.6 |
| #60 | A6 R75–R79, O16/O17/O19, Q-v5.2-36/50/52, layar 1366/899/390 |
| #61 | A5b bukti e2e R48, R69 (impor FS → C59 → FINAL), R70 (journey O, L, P) |
| #62 | A7 layar Penugasan Sales (Admin, Kepala Sales); key dasar di `commercialView` |

## 4. Batas yang diputuskan (bukan lupa)

- **Q-v5.2-85/86**: `release.snapshot` dan `batch` (termasuk `lb_price`) masih terbaca Sales lewat API, karena mesin outlook v1
  menghitung dengan sesi pengguna untuk setiap role. Usulan v5.3: outlook Sales dihitung di server dengan klien servis, lalu baca
  mentah ditutup.
- **Q-v5.2-90**: `apps/web` `xlsx` 0.18.5 (parse di browser, berkas milik pengguna) sampai `cdn.sheetjs.com` terjangkau (D3).
- **Q-v5.2-100**: galat hidrasi #418 sekali di `/komersial`, tidak terulang; diamati.
- `cost_snapshot`, `sales_stock_age_v52`, `save_class_plan` tidak dibangun (O33 b; B-R85 sebagian).

## 5. Yang dibutuhkan untuk menuntaskan (urut dampak; rinci di BUTUH-DIKA)

1. **D2** Vercel Production: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` → rebuild, cron, mart (DoD 2–3).
2. **D5** daftar user (lewat chat) → upload dan FINAL oleh Finance (DoD 4), B-R87.
3. **D4** secret repo → `db-ops` (backup `pg_dump`, langkah data lewat runner); **D1** staging → T19/T21/T23 (DoD 6, 8).
4. **D6–D9** data dan persetujuan Finance (bank/stok harian, C8/C9, master PPIC, ekuitas b.71).
