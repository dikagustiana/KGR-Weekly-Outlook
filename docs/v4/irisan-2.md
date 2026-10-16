# Irisan 2: outlook bulanan dan kas

Branch `v4/2-monthly-cash`, bertumpuk di atas `v4/1-design-system`. Semua yang tampil baru ada di belakang flag `v4_design` (default mati). Engine dan mart bulanan v4 berjalan saat `m4_monthly` hidup. Migrasi baru `20261017000400_v4_cash_split.sql` menambah kolom pemisahan kas pada `cash_position_daily`, termasuk `horizon`. Migrasi itu menunggu diterapkan manusia ke KGR-OS bersama migrasi irisan 0 dan 1.

## Requirement dan bukti

| Requirement | Bukti |
|---|---|
| K3 run-rate | `monthly.ts` `runrateRevenue`: rata-rata hari kerja dalam 7 hari kalender sampai cut-off, tanpa hari 0 dan 3σ. Fixture Agustus: jendela 20–26 Agu tanpa 25 Agu menghasilkan 310,4 jt. Tes `monthly.test.ts`, `month-v4.test.ts` |
| K4 golden | `fixtures/month-2026-08/golden-v4.json`, ditulis `packages/engine/scripts/month-golden.ts`, status "diusulkan". Target v3 tetap di `golden.json` sebagai `revoked_v3_targets` (Q27, Q28) |
| K5 GP P&L | margin acuan = GP P&L bulan berjalan ÷ revenue (5,44%). Hari run-rate: GP = revenue × margin, tanpa baris ekspedisi dan blasting tambahan. Hari ber-PO: HPP dikurangi COGS lain dari driver M5 (P6) |
| K6 template 8.3 | `drivers.ts`: `dailyFixed` dengan basis kalender atau kerja, `carryForwardFixed`, C43 `fixedFreshnessControl`. Kolom baru dipetakan di `lib/v3/drivers.ts`. Upload `fixed_cost` dan edit per baris di halaman Biaya tetap & driver |
| K9 versi | `v1LockDate` (Kamis ke-n), `lockBlockers` (tanggal, register, uji run-rate, kontrol C33/C34/C49, cost rencana), `lockVersionV4` (snapshot dengan SHA-256 dan `rule_version`; V2 butuh V1 dan C32 lulus) (Q24) |
| K11 revenue | `actualRowsV4`: jurnal ditambah DO yang belum difaktur |
| K12 hari hilang | 25 Agu tidak punya baris revenue, barisnya ditandai anomali dan dibuang dari run-rate. Register mencatatnya "belum disepakati" dengan pemilik Finance + Sales |
| P1–P14 | `packages/engine/src/month-v4.ts`: `monthPlanV4`, `monthSummaryV4`, `vsBudget`, `engineAssumptions`, `runrateTest`, `lockBlockers`, `versionDaysV4`, `bridgeV4` (revenue, GP, NIBT, sisa 0), `accuracyV4`, `accuracyDays`, `c49`, `c32`. Tes `month-v4.test.ts` (37) |
| Mart `pl_daily_v4` | builder "monthly v4" (`lib/v4/month.ts`, modul `m4_monthly`) menulis satu scope per tanggal lewat `mart_replace` dengan service role, menyinkronkan register, dan menulis pra-cek kunci ke `data_status` (`month_lock`). Builder mingguan irisan 1 dilewati selama M4 hidup (Q37) |
| §3.7 kas | `cashProjectionSplit` (operasi lawan pendanaan afiliasi, skenario tanpa fasilitas), `cashProjection12mOrNull`, `kasHorizon`. Builder kas menulis kolom baru dan `horizon`. Minggu contoh: terendah 289,7 jt pada 28 Agu, tanpa fasilitas −910,3 jt (Q32, Q33) |
| §4.4 upload | `fixed_cost` (template 8.3: COA berdriver Tetap, nominal > 0, periode tidak tumpang tindih, versi naik bila nominal berubah) dan `budget` (bulan × segmen × metrik, revisi = versi baru). Parser dan tes di `packages/parsers` |
| §6.2 Outlook bulan | `/m/[month]` dengan flag aktif: model `lib/v4/outlook-bulan.ts`, pembaca `lib/v4/outlook-bulan-data.ts`, 16 tile. Panel Finance (kunci V1/V2, bangun ulang, cut-off, budget, sepakati asumsi) hanya untuk Finance dan Admin di luar view manajemen |
| §6.3 Kas & solvabilitas | `/kas` dengan flag aktif: model `lib/v4/kas.ts`, pembaca `lib/v4/kas-data.ts`, 11 tile; tanpa basis outlook tile 12 bulan menulis "tidak tersedia" |
| §6.6 Biaya tetap & driver | `/m/[month]/biaya` dengan flag aktif: outlook pos tetap (input, actual, sisa, outlook, "belum diperbarui"), C33/C34/C43, template 8.3 per baris, biaya satu kali (`cost_event`), driver per akun |
| K17 satu angka | halaman membaca `pl_daily_v4`, `budget`, `assumption_register`, `month_outlook_version`, `cash_position_daily` (`horizon`), `ccc_daily`, `solvency_monthly`. Kartu bulan di Minggu ini kini membaca mart dan fungsi yang sama dengan Outlook bulan |
| §9.4 banding | `docs/v4/bukti/outlook-bulan-banding.md`, `kas-solvabilitas-banding.md`, `kas-solvabilitas-proyeksi-banding.md`. Above-fold lulus (415 px dan 679 px), grep DOM 0, kontras lulus |
| G2 RLS | `docs/v4/bukti/irisan-2-test-rls.txt`: 15 blok, tidak ada hasil (!). Blok baru: budget dan `cost_event` untuk Finance dan tertutup bagi Sales, budget terkunci direvisi lewat versi baru, register disepakati Finance saja, mart dan `data_status` tidak bisa ditulis klien, V1 dengan kolom v4 tidak bisa diubah, cek `day_basis` dan `posting_day`, `cost_event` masuk antrian rebuild |
| Migrasi | keempat migrasi v4 diterapkan dua kali pada salinan latihan KGR-OS (`kgr_os_rehearsal`) tanpa galat |
| Gate | `docs/v4/bukti/irisan-2-gates.txt`: typecheck lulus; tes engine 242 + 1 todo, parser 22, web 48; parity 17.161/17.161; snapshot EMPTY; build lulus |

## Selisih mockup lawan halaman

Semua selisih terjelaskan. Belum ada persetujuan pemilik, jadi statusnya "diusulkan".

Outlook bulan (`outlook-bulan-banding.md`, 7 selisih):

| Tile | Selisih | Sebab |
|---|---|---|
| `headline`, `c-forecast`, `c-outlook` | GP 296,4 bukan 296,2; GP forecast −51,0 bukan −51,2; batas atas 7.901,9 bukan 7.902,0; NIBT 79,2 bukan "belum diisi" | Q28: margin 5,44% tidak dibulatkan; rentang dari angka tanpa pembulatan; NIBT dihitung dari biaya run-rate actual bulan berjalan |
| `ch-kumulatif` | batas atas di catatan 7.901,9 | sama dengan di atas |
| `register` | catatan "8 dari 8 belum disepakati" | Q36 |
| `akurasi` | catatan menyebut bulan dan dasar persen, bukan penyebab selisih | penyebab selisih (penyesuaian tutup buku) baru bisa ditulis dari data saat FINAL dikunci di v4 (irisan 4); Q25 |
| `solvabilitas` | Agustus, bukan September | Q42 |

Kas & solvabilitas per 30 Sep, hanya dengan FS (`kas-solvabilitas-banding.md`, 3 selisih): catatan dasar CCC di tile siklus kas; judul tabel arus kas (mockup menyebut minggu tertentu, halaman per minggu); tabel arus kas kosong karena belum ada template kas harian.

Kas & solvabilitas per 26 Agu dengan rencana kas minggu contoh (`kas-solvabilitas-proyeksi-banding.md`): halaman diisi data, sementara mockup menggambarkan keadaan kosong per 30 Sep. Selisihnya bukan kesalahan; berkas ini menunjukkan semua tile terisi dan muat di grid.

## Cara menjalankan

```
cd apps/web
npx tsx --tsconfig scripts/tsconfig.json scripts/v4-fixture.tsx <dir>
node scripts/v4-screens.mjs ../../reference/design/outlook-bulan.html <dir>/outlook-bulan.html outlook-bulan ../../docs/v4/bukti
node scripts/v4-screens.mjs ../../reference/design/kas-solvabilitas.html <dir>/kas-solvabilitas.html kas-solvabilitas ../../docs/v4/bukti
pnpm --filter @kgr/engine exec tsx scripts/month-golden.ts      # tulis ulang golden-v4.json
DATABASE_URL=postgresql://… bash scripts/test-rls.sh             # database sekali pakai, bukan project Supabase
```

## Yang belum

- FINAL, tutup buku, akurasi per hari (`forecast_accuracy_daily`), dan PDF bulanan masih jalur v3 sampai irisan 4 (Q38).
- Cost rencana untuk porsi PO yang tidak tertutup stok (P6) menunggu M3 di irisan 3 (Q26).
- Upload `delivery` pindah ke irisan 3 (Q39).
- Builder belum dijalankan terhadap Supabase: lingkungan ini tidak punya PostgREST maupun service key. Engine diuji lewat fixture, dan skema serta kebijakan lewat PostgreSQL lokal.
- Bukti screenshot berasal dari fixture, bukan halaman preview yang login dengan flag hidup.
