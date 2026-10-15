# v3 — ringkasan (Fase 0 → 7)

Spesifikasi [`docs/PRD-v3-kgr-platform.md`](../PRD-v3-kgr-platform.md) · rencana [`docs/PLAN-v3.md`](../PLAN-v3.md) ·
bukti per fase [`README.md`](README.md) · keputusan dan target [`docs/open-questions.md`](../open-questions.md) §E ·
desain per fase `docs/v3/F<n>-design.md`. Fase 8 tidak dikerjakan (sesuai perintah).

Status per 15 Okt 2026:

- Semua fase F0 sampai F7 selesai sebagai 11 PR bertumpuk. Tidak ada yang di-merge.
- **Belum ada migrasi v3 yang diterapkan ke Supabase mana pun.**
  - Semua migrasi dan uji peran hanya dijalankan pada PostgreSQL 16 lokal dengan shim Supabase.
  - Tujuan baru yang disebut pemilik: project **KGR-OS** (`pczjhmzpkknzkziipvit`). Lihat §3.
- `computeWeek` dan golden v1 tidak bergeser di setiap commit:
  - `pnpm parity`: 17.161/17.161 sel, diff bersih.
  - `pnpm snapshot:diff`: kosong, SHA-256 snapshot minggu contoh tetap `947ce203…a83`.

## 1. Daftar PR (merge berurutan; setiap PR ber-base branch fase sebelumnya)

| # | Fase | Branch | PR | Migrasi |
| --- | --- | --- | --- | --- |
| 1 | F0 Fondasi, koreksi data D1–D9, backup, uji RLS di CI | `v3/f0-data-fixes` → `main` | [dikagustiana/KGR-Weekly-Outlook#7](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/7) | `20261016000100_v3_foundation.sql` + skrip `supabase/fixes/F0-*.sql` (manual) |
| 2 | F1 M1 Costing per batch → SKU | `v3/f1-costing` | [dikagustiana/KGR-Weekly-Outlook#8](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/8) | `20261016000200_m1_costing.sql`, `20261016000300_m1_backfill.sql` |
| 3 | F2 M2 Lot ledger + stok per SKU | `v3/f2-ledger` | [dikagustiana/KGR-Weekly-Outlook#9](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/9) | `20261016000400_m2_ledger.sql`, `20261016000500_m2_backfill.sql` |
| 4 | F3a M3 Demand → rencana mingguan/harian | `v3/f3a-demand` | [dikagustiana/KGR-Weekly-Outlook#10](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/10) | `20261016000600_m3_planning.sql`, `20261016000700_m3_backfill.sql` |
| 5 | F3b M3 Alokasi FEFO + cut-off | `v3/f3b-alokasi` | [dikagustiana/KGR-Weekly-Outlook#11](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/11) | `20261016000800_m3_allocation.sql` |
| 6 | F4a M5 Biaya dengan driver | `v3/f4a-drivers` | [dikagustiana/KGR-Weekly-Outlook#12](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/12) | `20261016000900_m5_drivers.sql` |
| 7 | F4b M4 Outlook bulanan | `v3/f4b-monthly` | [dikagustiana/KGR-Weekly-Outlook#13](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/13) | `20261016001000_m4_monthly.sql` |
| 8 | F5 M6 Kas, CCC, solvabilitas | `v3/f5-cash` | [dikagustiana/KGR-Weekly-Outlook#14](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/14) | `20261016001100_m6_cash.sql` |
| 9 | F6a M7 Commercial view | `v3/f6a-commercial` | [dikagustiana/KGR-Weekly-Outlook#15](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/15) | `20261016001200_m7_commercial.sql` |
| 10 | F6b M7 Approval diskon + scorecard | `v3/f6b-approval` | [dikagustiana/KGR-Weekly-Outlook#16](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/16) | `20261016001300_m7_approval.sql` |
| 11 | F7 Rilis bulanan, PDF, mobile, management view v3, ringkasan ini | `v3/f7-release` | [dikagustiana/KGR-Weekly-Outlook#17](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/17) | — |

Aturan migrasi:

- Hanya file baru, bernomor setelah `20261014000600`, dan idempoten. Setiap file diterapkan dua kali di uji lokal.
- Tanpa `drop table`, `drop column`, atau rename kolom.
- Setiap tabel baru punya `tg_stamp`, `tg_audit`, RLS, index, dan blok uji di `supabase/tests/rls_roles.sql`.

Bukti terakhir di `v3/f7-release` (lengkap per fase di [`README.md`](README.md)):

```
pnpm typecheck → exit 0
pnpm test      → engine 182 passed + 3 todo · parsers 20 · web 14
pnpm parity    → 17161/17161, git diff --exit-code docs/parity.md docs/parity-cells.csv bersih
pnpm snapshot:diff → EMPTY (byte-identical)
pnpm build     → sukses
pnpm test:rls (PG16 lokal) → 19 migrasi, v3 diterapkan 2×, seed, 136 hasil uji peran, 0 bertanda (!)
```

CI GitHub:

- Sejak sekitar 15:18 UTC 15 Okt, setiap job Actions di PR berhenti dalam 3 detik tanpa runner (`runner_id 0`), kemungkinan kuota atau billing Actions. Re-run lewat API ditolak (403).
- Catatan di [PR #11](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/11#issuecomment-6196101597).
- Semua pemeriksaan di atas dijalankan lokal. CI perlu dijalankan ulang setelah kuota pulih.

## 2. Migrasi ke project Supabase yang sekarang dipakai aplikasi (`uxqbtverhnpiryhzbenr`)

Urutan untuk manusia, setelah setiap PR di-merge berurutan. Rinciannya di README per fase.

1. **Backup dulu.**
   - Isi secret GitHub `SUPABASE_DB_URL`. Opsional: `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`.
   - Jalankan workflow **Backup** (Actions → Backup → *Run workflow*) dan pastikan `kgr-*.dump` ada.
2. Disarankan: `pg_dump` production → restore ke Supabase branch. Jalankan langkah 3–5 di branch itu dulu, lalu `SUPABASE_DB_URL=<url branch> pnpm test:rls`.
3. Terapkan migrasi:

   ```bash
   supabase db push      # atau: supabase db push --db-url "$SUPABASE_DB_URL"
   ```

   Urutan yang diterapkan: `20261016000100` → `000200` → `000300` → `000400` → `000500` → `000600` → `000700` → `000800` → `000900` → `001000` → `001100` → `001200` → `001300`.
   Boleh per PR, mengikuti nomor di tabel §1. Boleh juga sekaligus setelah #17 di-merge.
4. SQL Editor, berurutan, setelah `000100`. Periksa output tiap skrip:

   ```
   supabase/fixes/F0-D3.sql
   supabase/fixes/F0-D4.sql
   supabase/fixes/F0-D7-D9-runrate.sql
   supabase/fixes/F0-D8.sql
   ```

5. Flag modul tetap off sampai §4.

## 3. Project baru KGR-OS (`pczjhmzpkknzkziipvit`, ap-northeast-2)

Keadaan KGR-OS saat diperiksa 15 Okt 2026:

- Kosong: 0 migrasi, 0 tabel di `public`.
- Tanpa repo terhubung.
- Ditandai PRODUCTION oleh Supabase (branch `main`).

**Apa yang sudah dilakukan.** Claude Code membaca isi project (hanya baca) lewat Supabase MCP. Penerapan migrasi diblokir oleh izin sesi (dikategorikan *production deploy*). Tidak ada yang ditulis ke KGR-OS. Penerapan butuh izin eksplisit pemilik, atau dijalankan manusia dengan urutan di bawah.

Urutan berikut sudah dicoba pada database kosong (PostgreSQL 16 lokal, `kgr_os_pathb`) dan dibandingkan dengan gladi bersih "v1 → seed → v3":

- 62 dari 64 tabel `public` identik (jumlah baris + md5 kolom stabil).
- `closing_adjustment` isinya identik (md5 kode/uraian/nominal sama); yang beda hanya `month_outlook_id` acak.
- `rebuild_queue` berisi lebih banyak tanggal antrian (29 vs 7) — tidak berbahaya, diproses oleh "Proses antrian".
- `rls_roles.sql` pada gladi bersih: 136 hasil, 0 bertanda `(!)`.

Catatan CLI: bila `supabase db push --db-url` meminta `supabase/config.toml` (repo tidak menyimpannya), ada dua jalan:

- jalankan `supabase init` lokal dulu, dan jangan commit hasilnya;
- atau terapkan `supabase/migrations/*.sql` berurutan dengan `psql`. Cara ini tidak mengisi riwayat `supabase_migrations`.

```bash
# connection string dari Dashboard KGR-OS → Connect. Simpan di shell saja, jangan di repo.
export KGR_OS_DB_URL='postgresql://…'

# 1. skema: 19 migrasi (v1 20261014000100…000600 + v3 20261016000100…001300), tercatat di supabase_migrations
supabase db push --db-url "$KGR_OS_DB_URL"

# 2. master (I_Master, I_Item, I_COA) + minggu contoh 24–30 Agu 2026. Tidak membuat app_user.
for f in supabase/seed/*.sql; do psql "$KGR_OS_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f" || break; done

# 3. ulangi migrasi v3 (idempoten) supaya backfill M1/M3/M5 berlaku pada data seed
#    (grup SKU, Order → Confirmed, driver coa_map, antrian rebuild)
for f in supabase/migrations/20261016*.sql; do psql "$KGR_OS_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f" || break; done

# 4. uji peran (selalu rollback; tidak meninggalkan baris)
SUPABASE_DB_URL="$KGR_OS_DB_URL" pnpm test:rls
```

Setelah itu, oleh manusia:

1. **Admin pertama** (SQL Editor KGR-OS, sekali). Login lain dibuat Admin di aplikasi (Admin → Pengguna).

   ```sql
   insert into public.app_user (email, role) values ('dika.g.irawan@gmail.com', 'admin') on conflict do nothing;
   select public.set_login_password('dika.g.irawan@gmail.com', '<kata sandi kuat>');
   ```

2. **Aplikasi ke KGR-OS.**
   - `apps/web/lib/env.ts` masih menunjuk ke `uxqbtverhnpiryhzbenr`. Aturan sesi melarang Claude Code mengubah file itu dan env Vercel.
   - Isi env Vercel `NEXT_PUBLIC_SUPABASE_URL=https://pczjhmzpkknzkziipvit.supabase.co` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon/publishable key KGR-OS>`, lalu redeploy.
   - Region fungsi Vercel `hnd1` (Tokyo); KGR-OS ada di Seoul. Latensi naik sedikit, tidak wajib diubah.
3. **Data lama.** Bila project lama sudah berisi minggu nyata (pilot), pindahkan dulu, lalu jalankan langkah 3 di atas.
   - Caranya: `pg_dump --data-only` dari project lama → restore ke KGR-OS **setelah langkah 1, sebagai pengganti langkah 2**.
   - Bila belum ada data nyata, seed langkah 2 cukup.
4. Auth KGR-OS: isi Site URL / Redirect URL (`https://<domain>/auth/callback`). Aktifkan *leaked password protection* bila tersedia.
5. Bucket `uploads`, `releases`, `backups` dibuat oleh migrasi.

## 4. Feature flag (Admin → Modul; semua default off)

Nyalakan per tahap: admin dulu → peran pemakai → semua. Halaman modul yang off = 404, aksi yang off = `WriteError`.

| Urutan | Flag | Syarat sebelum on | Peran (bertahap) |
| --- | --- | --- | --- |
| 1 | `m1_costing` | `000200`–`000300`; WP potong + daftar PI di-upload | admin, cost_accounting → finance, management, ppic (sales tidak pernah melihat Costing) |
| 2 | `m2_ledger` | `000400`–`000500`; **Proses antrian** membangun ledger dari backfill | admin → semua kecuali sales |
| 3 | `m3_planning` | `000600`–`000800`; yield PPIC diganti, kapasitas harian diisi | admin → sales, commercial_lead, ppic, finance, management |
| 4 | `m5_drivers` | `000900`; nominal jadwal biaya tetap diisi Finance | admin, finance |
| 5 | `m4_monthly` | `001000`; `m5_drivers` on; `/m/[bulan]` "Bangun ulang" dibandingkan dengan P&L mingguan | admin → semua |
| 6 | `m6_cash` | `001100`; template kas harian di-upload, C35 LULUS | admin, finance, management |
| 7 | `m7_commercial` | `001200`; `m2_ledger` on; `sales_assignment` + harga lantai diperiksa | admin, commercial_lead → sales, management |
| 8 | `m7_approval` | `001300`; `m7_commercial` berjalan (order di bawah lantai langsung ditolak) | admin, commercial_lead, finance → sales |

Tampilan manajemen mingguan:

- Selalu menampilkan **Input** dan **HPP** dari hasil engine minggu itu, walau semua flag off.
- Headline bulan, kas terendah 13 minggu, SKU jual hari ini, demand, dan akurasi muncul saat modulnya on.

## 5. Target PRD v3 §8 — tercapai / tidak

Rinci di `docs/open-questions.md` §E.4.

| Modul | Target | Hasil |
| --- | --- | --- |
| M1 | Kolom L `Pot_ISA`/`Pot_AGRO` per SKU ± Rp 1 | **Tercapai** — 26 sheet, 637 baris SKU |
| M2 | Saldo 24 Agu = stok awal per key | **Tercapai** — 34 key, 162.687,92 kg, Rp 3.954.932.012 |
| M2 | Roll-forward 162.687 → 156.956 kg | **Tercapai** — 156.956,05 kg (30 Agu); setiap hari × key = O_Stok ± 0,01 kg |
| M2 | MA per key = `hpp_actual` ± Rp 1/kg di ≥ 95% baris | **Tidak** — 88,2% (30/34). Selisih JLB0790 +17,25, JLB0856 +180,28, JLB0922 +259,38, JLB0988 +196,32 Rp/kg. Dugaan: recost GRN Agustus di Accurate tidak ada di fixture |
| M2 | C25 % assumed | **Tercapai** — 100% |
| M3 | 7.051 ekor, BLD binding, profit Base 70,8 jt | **Tercapai** — B20 = 7.051, B16 = BLD, Base 70.817.907 (± Rp 1) |
| M3 | B_Alokasi_Stok 2.000 kg dari 100 t | **Tercapai** — teralokasi 2.000, sisa 98.000 |
| M3 | Alur [1]–[4] + cut-off → blast_event | **Engine tercapai** (27 Agu: 36 alokasi FEFO 12.964,33 kg; cut-off 40 lot; C29/C31 LULUS). UI belum diuji di Supabase |
| M5 | Sewa RPA 94,48 jt/bulan mulai 1 Nov 2026 | **Tercapai** — 1.133.790.000 ÷ 12 = 94.482.500 |
| M5 | Biaya tetap tidak dihitung dua kali | **Tercapai** — depresiasi Agu = jurnal, Sep = jadwal |
| M4 | Aktual s.d. 26 Agu: revenue 6.385,9 / GP 347,4 jt | **Tercapai** (± Rp 1) |
| M4 | 27–29 Agu 457,8 / 232,1 / 378,0; 30 Agu 0 | **Tercapai ± 0,1 jt** — 457,74 / 232,08 / 378,00 |
| M4 | Run-rate 31 Agu 258,7 jt | **Tidak** — app 319,29 jt (+60,6). Belasan definisi jendela dicoba; tidak ada yang 258,7 |
| M4 | Forecast 1.326,5 / GP −54,0; outlook 7.712,4 / 293,4; 80,5% ber-PO | **Tidak** — app 1.387,12 / −35,17; 7.773,00 / 312,24; 77,0%. Komponen PO cocok (1.067,82 jt); selisih seluruhnya dari hari run-rate |
| M4 | Bridge V1 → V2 = 0; akurasi vs FINAL | **Engine tercapai (aturan)**; UI belum diuji di Supabase |
| M6 | Ekuitas 702,6 jt, modal 5.000 jt, afiliasi 9.845,9 jt | **Tercapai** — 702.553.474,90 / 5.000.000.000 / 9.845.918.888,89 |
| M6 | DI-01…DI-04 | **Tercapai** — 48.354.462 / 48.084.680 / 12.000.000 / 62.450.000 + 69.661.617 |
| M6 | Template kas → posisi harian, C35, 13 minggu / 12 bulan, CCC, solvabilitas | **Engine tercapai (aturan)**; UI belum diuji di Supabase |
| M7 | View sales tanpa cost pool / batch_ref / SI | **Tercapai** (view model + RLS) |
| M7 | Ranking berubah saat umur berubah | **Tercapai** — frozen 10 → 35 hari pindah #2 → #1 |
| M7 | Order < harga lantai ditolak tanpa approval | **Tercapai** (aturan + trigger DB) |
| M7 | Scorecard mingguan | **Tercapai (aturan)**; UI belum diuji di Supabase |

Tiga target yang tidak tercapai ditandai `it.todo`. Angka aplikasi saat ini dikunci sebagai uji regresi.

## 6. Default Q1–Q20 yang dipakai (PRD v3 §9)

Semua bisa diubah lewat parameter/master tanpa ubah kode. Dampaknya di `docs/open-questions.md` §E.2.

| Q | Default |
| --- | --- |
| Q1 | By-product `joint` (share relative sales value) — `parameter.by_product_method` |
| Q2 | Cost pool = PI + akrual GL, tie-out C23 |
| Q3 | Harga alokasi = harga daftar WP / `sku_price` minggu potong; key fresh ≠ frozen |
| Q4 | Gap hasil potong 8–10% = susut proses; C22 toleransi 2% |
| Q5 | Ekor = `batch.head_count`, kosong → `lb_kg / 2,0 kg` |
| Q6 | Tanpa lot di DO → FIFO per key, `assumed=true` (C25) |
| Q7 | Tabel substitusi kosong |
| Q8 | Fresh window 48 jam, cut-off 14:00 |
| Q9 | 63% frozen ditampilkan sebagai `rp_downgrade`, tidak diputuskan sistem |
| Q10 | Approval downgrade > Rp 25 jt/minggu |
| Q11 | MA per item Accurate; agregat per key |
| Q12 | V1 dikunci hari kerja ke-20 |
| Q13 | Toleransi forecast ±10% |
| Q14 | DO unbilled masuk actual (`do_unbilled`), harga PO |
| Q15 | Margin acuan = harga list dan realisasi 7 hari |
| Q16 | Budget bulanan per pl_line |
| Q17 | Sales melihat cost/kg MA, lantai, margin; tidak melihat cost pool, biaya batch, SI per lot |
| Q18 | Fresh > 24 jam = jual hari ini; frozen > 21 hari = minggu ini; > 30 hari = di atas batas umur |
| Q19 | Commercial lead ≤ Rp 500/kg, di atasnya Finance |
| Q20 | Bobot Tentative 70%, Forecast 50% |

Pilihan implementasi V1–V46 (mis. V5 grain `batch_output_sku`, V13 tanggal PO, V32 tanda DI) ada di §E.3.

## 7. Yang perlu manusia

| Siapa | Item | Di mana |
| --- | --- | --- |
| Pemilik | Pilih project Supabase tujuan (KGR-OS atau project lama). Jalankan §2 atau §3, atau beri izin eksplisit agar Claude Code menerapkannya lewat Supabase MCP | §2, §3 |
| Pemilik / Admin | Env Vercel bila pindah ke KGR-OS. Merge PR #7 → #17 berurutan. Pulihkan kuota GitHub Actions lalu jalankan ulang CI | Vercel, GitHub |
| Admin | Admin pertama di project baru. Login peran baru **Kepala Sales** (`commercial_lead`) dan **Cost Accounting** (`cost_accounting`) lewat Admin → Pengguna → "Set kata sandi" | §3, aplikasi |
| Admin | Secret workflow Backup (`SUPABASE_DB_URL`, opsional `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`). Skrip `supabase/fixes/F0-*.sql` di SQL Editor setelah dicoba di branch | GitHub, SQL Editor |
| PPIC | **D1**: gap hasil potong 8–10% (susut atau output tak ditimbang?). **D2**: output SKU batch Pot_AGRO28/29/30. Yield matrix pengganti placeholder, kelas berat, kapasitas harian | upload WP, "PPIC — yield matrix", `/w/[minggu]/rencana` |
| Finance | Nominal `fixed_cost_schedule`: **GAJI** (FS Agu 85.565.549 / Sep 82.677.332), **SEWA-ABF-NMG**, **BUNGA**; `cash_day_of_month` per pos; konfirmasi depresiasi September (FS 0) dan driver default | `/m/[bulan]/biaya` |
| Finance | Tanda **DI-02 / DI-03** (V32), posting penyesuaian September, budget bulanan, batas diskon Rp 500/kg | `/m/[bulan]/tutup-buku`, Parameter |
| Finance | Template kas harian semua rekening (C35 harus LULUS sebelum headline kas dipakai) | `reference/templates/Template_Kas_Harian.xlsx` |
| Commercial lead | **`sales_assignment`** (sales_rep, **email login**, key/customer), `sales_target` mingguan, cek aturan harga lantai dan biaya simpan per kg/hari | `/komersial` |
| Inventory Accounting | Data recost GRN Agustus Accurate (untuk target MA 95%). Upload saldo stok per item untuk C26 | upload |
| Finance / Management | Sumber mockup "Bulanan" (jendela run-rate 258,7 jt) untuk menutup target M4 | `docs/open-questions.md` §E.4 |
| QA | Uji UI end-to-end di preview: alur M3 [1]–[4], M4 V1/V2/FINAL, M6 upload kas, M7 approval + scorecard. Tidak bisa di sesi ini karena tidak ada Supabase auth lokal | Vercel preview |

## 8. Yang tidak dilakukan Claude Code (sesuai aturan)

- Tidak ada `db push` / penerapan migrasi ke Supabase mana pun.
- Tidak membuat atau menghapus user `app_user`.
- Tidak mengubah `apps/web/lib/env.ts`, `vercel.json`, atau env Vercel.
- Tidak ada merge PR.
- Tidak mengubah fixture `fixtures/week-2026-08-24/*`.
- Tidak menghapus bagian tampilan manajemen.
- Tidak ada dependensi berat.
- Tidak ada perhitungan angka laporan di SQL view.
