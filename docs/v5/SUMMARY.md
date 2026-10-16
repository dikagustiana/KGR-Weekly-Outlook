# PRD v5 — ringkasan pengiriman (irisan v5/0 sampai v5/6)

Semua irisan Bab 10 sudah dibangun, satu PR per irisan. Semua flag `v5_*` mati secara default; selama mati layar v4 tetap bekerja, `computeWeek` tidak disentuh, parity 17.161/17.161 dan snapshot v1 byte-identik di setiap commit. Tidak ada SQL yang dijalankan ke KGR-OS (`pczjhmzpkknzkziipvit`); perintah di bawah dijalankan manusia.

## PR

| Irisan | PR | Status | Isi |
|---|---|---|---|
| v5/0 foundation | [#24](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/24) | di-merge ke `main` | PRD v5, mockup ke `reference/design/v5/`, migrasi §5 (tabel/kolom kosong, kelas K/S/B tanpa angka, role `operations_director`, registry tugas, flag mati) |
| v5/1 costing | [#25](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/25) | di-merge ke `main` | biaya rencana/estimasi/sementara/final, `simulateLivebird`, revaluasi K22, biaya idle, C53/C54/C57, Commercial membaca biaya + status, label K25 |
| v5/2 pl | [#26](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/26) | di-merge ke `main` | beban tetap K29, laba rugi dua tampilan K30, kumulatif lima ukuran K31, C55 |
| v5/3 ppic-class | [#27](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/27) | di-merge ke `main` | ukuran PO → kelas → kg LB (K28), rencana harian per kelas, layar PPIC v5, C50/C51/C58 |
| v5/4 commercial-loop | [#28](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/28) | di-merge ke `main` | komitmen + kunci Jumat (K26), price list mingguan (K24), jawaban surplus, layar Commercial v5, C52 |
| v5/5 input | [#29](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/29) | di-merge ke `main` | `upload-validate.ts` bersama browser/server, layar Input semua role, template/tempel/simpan sebagian/fingerprint, grid kelengkapan, K35 di `release_week` |
| v5/6 management | [#30](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/30) | di-merge ke `main` | Manajemen v5: simulasi LB untuk Direktur Operasional + keputusan, perlu keputusan + status putaran, label sumber K36, "Lihat sebagai" K37 |

PR #27–#30 bertumpuk dan sudah di-merge berurutan #27 → #28 → #29 → #30.

## Migrasi untuk KGR-OS (urutan)

Status KGR-OS: diterapkan 16/10/2026 oleh pemilik dengan file sekaligus di SQL Editor; tabel cek akhir 11 baris `true` (sebelumnya: v3 lengkap, ke-10 migrasi v4 + v5 belum ada). Untuk database lain, dua cara dengan hasil yang sama:

- **Sekaligus**: `docs/v5/kgr-os-migrasi-v4-v5-sekaligus.sql` di SQL Editor, satu kali Run. Isinya 10 file `20261017000100` sampai `20261023000100` disambung urut nama tanpa diubah (sha256 tiap file di kepala), ditambah cek prasyarat v3 di awal dan tabel cek 11 baris di akhir (semua `true`). Satu Run = satu transaksi: error di mana pun membatalkan semuanya. Diuji di salinan latihan KGR-OS sebagai satu query: skema identik dengan penerapan per file (`pg_dump -s`), isi seed sama (tanpa id/cap waktu), Run kedua tetap lolos, error yang disisipkan di file ke-8 membatalkan semuanya, database tanpa v3 ditolak sebelum apa pun berubah.
- **Satu per satu**: migrasi v4 (`20261017*` sampai `20261020*`) urut nama, lalu file v5 di bawah, di SQL Editor atau psql (`PGCLIENTENCODING=UTF8`):

| Urutan | File | Irisan | Cek |
|---|---|---|---|
| 1 | `supabase/migrations/20261021000100_v5_foundation.sql` | v5/0 | `select count(*) from public.app_setting where key like 'v5\_%';` → 6 |
| 2 | `supabase/migrations/20261022000100_v5_costing.sql` | v5/1 | `select count(*) from pg_views where viewname = 'commercial_daily_sales_v5';` → 1 |
| 3 | `supabase/migrations/20261023000100_v5_input.sql` | v5/5 | `select count(*) from public.input_task_rule;` → 14; `select allowed_roles from public.release_override_policy where code = 'K35';` → `{finance}` |

v5/2, v5/3, v5/4 dan v5/6 tanpa migrasi. Semua migrasi hanya menambah dan bisa dijalankan ulang; sudah diterapkan dua kali pada salinan latihan KGR-OS dan diuji `test:rls` (22 blok) di PostgreSQL lokal.

## Flag (urutan menghidupkan)

Prasyarat v4: `v4_design`, `m1_costing`, `m2_ledger`, `m3_planning`, `m4_monthly`, `m6_cash`, `m7_commercial` (dan `m7_approval` untuk C38). Lalu, satu per satu, masing-masing diikuti Admin → Modul → "Bangun ulang data mart" untuk periode berjalan:

1. `v5_costing` — biaya + status di ledger, Commercial, P&L (bila revaluasi dihitung sejak tanggal tertentu: `{"enabled": true, "since": "YYYY-MM-DD"}`).
2. `v5_pl` — beban tetap dan laba rugi dua tampilan (Finance mengisi jadwal beban tetap bulan berjalan dulu).
3. `v5_ppic_class` — setelah PPIC mengisi rentang/rata-rata K/S/B, peta ukuran → kelas, yield per kelas; Purchasing supply per kelas.
4. `v5_commercial` — setelah `sales_assignment` lengkap.
5. `v5_input` — lalu "Perbarui status tugas" atau rebuild 7 hari terakhir supaya tugas dan grid terisi.
6. `v5_management` — terakhir (membaca semua di atas).

Flag bisa dihidupkan per role lebih dulu (`{"enabled": true, "roles": ["admin"]}`) untuk uji di production.

## Lampiran B dan C

| Acuan | Hasil | Tempat |
|---|---|---|
| B.1 simulasi live bird | direproduksi (±0,1 jt, ±2 Rp/kg; breakeven 23.961 vs 23.960, GP −11,7 vs −11,8, batch COGS 739,0 vs 739,1 — Q-v5-9) | `packages/engine/test/costing-v5.test.ts`, `fixtures/costing-sim-2026-08-24`, tile Manajemen |
| B.2 laba rugi Agustus | direproduksi (±0,1 jt; mingguan 19,7 vs 19,6 dan −125,6 vs −125,7 dari pembulatan, Q-v5-19); total outlook revenue 7.764,1, GP 296,4, NIBT 79,2, NIBT setelah beban tetap −7,8 | `packages/engine/test/pl-v5.test.ts`, `fixtures/pl-2026-08` (golden §9.2, ditambahkan di v5/6) |
| B.3 demand per ukuran → kelas | direproduksi dengan peta ukuran ilustrasi sebagai input tes berlabel (`placeholder: true`, Q-v5-29) | `packages/engine/test/ppic-class.test.ts`, `fixtures/plan-2026-08-24` blok `v5` |
| B.4 rencana harian per kelas | direproduksi (S 4.421 vs 4.420 ekor dari pembulatan, Q-v5-30) | idem |
| B.5 upload contoh | direproduksi: PO 7 → 4, WP 8 → 6 (Σ 6.782,8 vs 7.286,6, 6,9%, yield 73,4%), yield 18 → 0; "kelas S" hanya dengan rentang ilustrasi (golden: STD, Q-v5-41) | `fixtures/upload-samples`, `apps/web/lib/v5/upload-samples.test.ts` |
| C Commercial minggu contoh | tidak direproduksi dari fixture: angkanya dari mart KGR-OS `ebe4ad8`, bukan dari fixture minggu contoh (Q-v5-39); rumus diuji dengan baris Lampiran C | `packages/engine/test/commercial-v5.test.ts` |

Tidak ada tes v5 yang ditandai `todo` karena angka gagal direproduksi. Satu `todo` engine berasal dari v3: MA vs HPP ≥ 95% baris (fixture 88,2%), menunggu pengecualian tertulis Finance (O13, Q69 v4).

Golden §9.2: `plan-2026-08-24` blok v5 (v5/3), `pl-2026-08` (v5/6), `costing-sim-2026-08-24` (v5/1), `upload-samples` (v5/5).

## Default O1–O14 yang dipakai

| # | Default | Di mana |
|---|---|---|
| O1 | `cogs_line` | `parameter.revaluation_sold_mode` |
| O2 | satu harga LB semua kelas | `lb_price_decision.weight_class` null; keputusan dari Manajemen tanpa kelas |
| O3 | Uk 1.3 = 1,30–1,39 kg/ekor, titik tengah +0,05 | `SIZE_MID_OFFSET` |
| O4 | ukuran kolom terpisah `size_kg` | `item_map`, `sales_line`; kolom `ukuran` di template PO |
| O5 | K/S/B tanpa angka sampai diisi PPIC | seed `weight_class`; "terdaftar" = punya angka |
| O6 | C22 2%, susut 3%, yield karkas 68–76% | cek WP dan yield (`parameter`) |
| O7 | stok di atas umur per lot | kartu Manajemen (v4) |
| O8 | persetujuan parameter > 5% atau > Rp 5 jt per minggu | ditampilkan di Input; alur usulan belum dibangun (Q-v5-45) |
| O9 | grafik harian tanpa pilihan ukuran | Outlook bulan |
| O10 | rilis Kamis | `input_task_rule.release_week` |
| O11 | lantai by-product fresh tampil dengan C54 | Commercial |
| O12 | kunci service role di env server Vercel (manusia) | rebuild mart |
| O13 | belum ada pengecualian MA vs HPP; G3 terbuka | — |
| O14 | 1–2 Agu ditandai anomali | P&L per minggu |

Detail dan pertanyaan implementasi Q-v5-1 sampai Q-v5-53: `docs/v5/QUESTIONS.md`.

## Yang harus diisi atau diputuskan manusia

| Siapa | Apa |
|---|---|
| PPIC | rentang dan rata-rata kg LB kelas K/S/B; yield karkas dan by-product per kelas (upload yield di Input); peta ukuran → kelas (`size_class_map`); kapasitas harian |
| PPIC + Sales | arti "Uk x.x" (O3: 1,30–1,39 dengan titik tengah 1,35?) |
| Finance | jadwal beban tetap Agustus–Desember (gaji, penyusutan, bunga; template 8.3 atau upload `fixed_cost` di Input); budget; register asumsi |
| Direktur Operasional | harga LB per kelas atau satu harga (O2); keputusan harian di Manajemen atau Input |
| Kepala Sales / Admin | assignment pelanggan dan SKU per Sales (`sales_assignment`) |
| Pemilik produk | kunci service role untuk rebuild di env server Vercel (Q2 v4, O12); jadwal harian (cron) untuk memperbarui tugas (Q-v5-46); menaikkan `xlsx` web ke 0.20.3 saat cdn.sheetjs.com terjangkau (Q-v5-42) |
| Finance | pengecualian tertulis MA vs HPP 88,2% (Q69 v4, O13) |
| Admin | user dan password untuk role baru: Direktur Operasional (`operations_director`), Kepala Sales (`commercial_lead`) dan Cost Accounting bila belum ada — dibuat di Admin → Pengguna, tidak di repo |
| Pemilik produk | merge PR #27–#30, menerapkan migrasi di KGR-OS, menghidupkan flag |

## Bukti per irisan

`docs/v5/irisan-<n>.md` (requirement → bukti, gate, RLS, latihan migrasi, perintah manusia) dan `docs/v5/bukti/`.
