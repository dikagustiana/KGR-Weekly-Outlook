# Irisan v5/5: layar Input, upload tervalidasi, grid kelengkapan

Branch `v5/5-input` di atas `v5/4-commercial-loop`. Rancangan: `docs/v5/irisan-5-design.md`. Flag `v5_input` (mati): selama mati nav "Upload" tetap ke wizard v4, `/input` 404, `release_week` sama dengan v4, dan builder tugas tidak menulis apa pun.

## Isi

- Engine `packages/engine/src/upload-validate.ts` (satu modul untuk browser dan server, juga diekspor sebagai `@kgr/engine/upload` untuk bundle klien): parsing (judul kolom, angka `1.234,5` / `36.705` / `Rp 43.086` / angka Excel, tanggal `YYYY-MM-DD` / `DD/MM/YYYY` / serial Excel, bulan, ukuran "Uk 1.3"), tempel TSV dan CSV tanpa library, template per jenis, `validateUpload` untuk `po_lines`, `costing_wp`, `yield_matrix`, `lb_supply`, `fixed_cost`, `supplier_invoice` (cek baris dan cek file §4.9, kode C50 / C51 / C56 / C22 / C23 / C38 / C58 / K32), `ok_count`, baris tersimpan, `needsReason`, fingerprint murni.
- Engine `packages/engine/src/input-tasks.ts`: aturan tenggat registry, instance per tanggal (minggu, tanggal potong, hari kerja, batch, bulan, event), status dari data, status efektif saat dibaca, sel grid, K35.
- Migrasi `20261023000100_v5_input.sql` (hanya menambah): `input_completeness_daily.due_at`; `input_reminder` (stamp, audit, RLS, indeks); kode override `K35` (cek kode kebijakan diperlebar, pola v3/v4) + kebijakan `K35` dan `C53` untuk Finance; aturan tugas `po_lines` (Sales); `release_week` (create or replace, tanda tangan sama) dengan cek K35 saat `v5_input` hidup.
- Web: `/input` (`app/input/page.tsx`, `actions.ts`), model `lib/v5/input.ts`, loader dan builder `lib/v5/input-data.ts`, simpan `lib/v5/input-save.ts`, validasi ulang server `lib/v5/input-check.ts`, panel klien `components/v5/UploadPanel.tsx` (SheetJS 0.18.5 build mini dimuat saat file .xlsx dipilih), contoh `lib/v5/upload-samples.ts`, nav "Input" menggantikan "Upload" saat flag hidup, pra-cek K35 di `lib/release.ts`, C51 layar PPIC memakai aturan "terdaftar" yang sama.
- Fixture `fixtures/upload-samples/`: `po_sample.xlsx`, `wp_sample.xlsx`, `yield_sample.xlsx` (ditulis dari `TPL[kind].sample` mockup oleh `apps/web/scripts/upload-samples.ts`), `samples.json`, `context.json`, `expected.json`.
- `xlsx@0.18.5` di `apps/web/package.json`; `pnpm-lock.yaml` hanya bertambah (entri xlsx 0.18.5 dan tujuh dependensinya, dibangkitkan pnpm di salinan scratch lalu disisipkan; `pnpm install --frozen-lockfile --lockfile-only` lolos).

## Persyaratan → bukti

| Rujukan | Isi | Bukti |
|---|---|---|
| §4.9 parsing | sheet pertama, baris kosong dilewati, judul dinormalisasi, angka dan tanggal Indonesia/Excel | `upload-validate.test.ts` "aturan parsing" |
| §4.9 `po_lines` | kode di master (C56), karkas RPA wajib ukuran (C50), tanggal kirim ≥ hari ini, kg dan harga > 0, harga < lantai → `warn` + approval (C38), pelanggan sesuai assignment (K32) | tes PO; G12 |
| §4.9 `costing_wp` | kode di master, kg > 0, kg LB vs batch, kg/ekor → kelas, Σ SKU vs kg LB × (1 − susut) dalam C22 2% (Lampiran D #1), yield karkas 68–76%; selisih → alasan wajib | tes WP; G12 |
| §4.9 `yield_matrix` | kelas terdaftar (C51), Σ yield per kelas ≤ 100%, yield karkas 68–76% | tes yield; G12 |
| §4.9 `lb_supply`, `fixed_cost`, `supplier_invoice` | kelas terdaftar + C58; COA tetap + periode tidak tumpang tindih; batch ada + tie GL (C23) | "cek per jenis lain" |
| K34 simpan | server validasi ulang payload mentah, tolak bila fingerprint beda, simpan hanya baris tanpa `fail`, idempoten (`line_key`, `code`, kunci upsert), antre rebuild | `upload-samples.test.ts` "server menolak payload yang diubah"; `input-save.ts` |
| G12 | tiga file contoh → cek dan `ok_count` identik browser (SheetJS → grid) dan server (grid JSON → validasi ulang) | `upload-samples.test.ts` (golden `expected.json`) |
| §4.9 registry | instance dan status dari data; tenggat WIB; status efektif | `input-tasks.test.ts` |
| K35 | grid input × hari; sel merah menahan rilis kecuali override K35 Finance | `input-tasks.test.ts` "K35"; RLS blok "v5/5" (`release_week` ditolak / lolos dengan override; flag mati = v4) |
| §6.4 | layar Input semua role = mockup (koordinat tile), role ganti untuk admin/management (baca saja), panel per role, grid Finance, pengingat, "Rilis dengan alasan" | `input-screens.test.tsx` |
| §6.4 role wajib | Cost Accounting, Sales, Kepala Sales, PPIC, Purchasing, Inventory Accounting (wizard v4), Finance, Direktur Operasional (keputusan harga LB) | `INPUT_ROLES`, `ROLE_KINDS`, form keputusan LB |
| journey N | PO: ukuran kosong ditahan dengan tindakan; di bawah lantai ke approval; baris lolos tersimpan; demand PPIC diperbarui (rebuild) | tes PO B.5; `input-save.ts` po_lines |
| journey O | WP: dua kode tak dikenal ditahan; selisih hasil potong wajib alasan, batch tetap sementara; lot → sementara (trigger v5/1); Commercial membaca biaya baru setelah rebuild | tes WP B.5; `input-save.ts` costing_wp |
| journey P | Finance: sel merah menahan rilis; pengingat ke pemilik; rilis dengan alasan → `release_override` K35 | RLS "v5/5"; `remindAction`, `k35OverrideAction` |

## Lampiran B.5 — direproduksi

`docs/v5/bukti/irisan-5-b5.txt` (konteks golden `fixtures/upload-samples/context.json`):

| File | Baris | Lolos | Cek |
|---|---|---|---|
| PO | 7 | 4 | X-999 tidak dikenal; JLB1857 tanpa ukuran; kirim 26/08 lewat; harga kosong; 5 baris di bawah lantai → approval (36.705 < 37.400; 43.086 < 47.199) |
| WP B260826 | 8 | 6 | X-HATI dan KPL-01 tidak dikenal; 7.512,0 kg / 3.902 ekor = 1,93 kg/ekor; Σ SKU 6.782,8 vs 7.286,6 kg (LB − susut 3%) selisih 6,9% → perlu penjelasan; yield karkas 73,4% lolos |
| Yield | 18 | 0 | K, S, B belum terdaftar (C51); Σ 89,2% / 89,9% / 90,4%; karkas 70,2% / 71,5% / 72,4% |

"Kelas S" untuk 1,93 kg/ekor memakai rentang K/S/B mockup (ilustrasi, Lampiran D): diuji sebagai input tes berlabel (`upload-validate.test.ts` "Lampiran B.5 'kelas S'"), tidak di golden. Dengan keadaan seed (STD 1,8–2,2; K/S/B tanpa angka) golden mencatat "kelas STD" (Q-v5-41).

## Bukti

Gate (`docs/v5/bukti/irisan-5-gates.txt`):
```
== typecheck
packages/engine typecheck: Done
packages/parsers typecheck: Done
apps/web typecheck: Done
== test
packages/engine test:  Test Files  25 passed (25)
packages/engine test:       Tests  345 passed | 1 todo (346)
packages/parsers test:  Test Files  3 passed (3)
packages/parsers test:       Tests  23 passed (23)
apps/web test:  Test Files  17 passed (17)
apps/web test:       Tests  110 passed (110)
== parity
parity: 17161/17161 cells match → docs/parity.md, docs/parity-cells.csv
docs/parity.md, docs/parity-cells.csv: tidak berubah
== snapshot
diff vs baseline (without block2.action, block7[].audience, controls_v3 (v3), costing (v3), ledger (v3), demand (v3), plan (v3), allocation (v3), monthly (v3), drivers (v3), cash (v3), ccc (v3), solvency (v3), commercial (v3)): EMPTY — byte-identical
== build
 ✓ Compiled successfully in 19.8s
├ ƒ /input                               24.6 kB         130 kB
```

RLS (PostgreSQL 16 lokal, `DATABASE_URL=… bash scripts/test-rls.sh`, 22 blok, semua migrasi diulang dua kali):
```
RLS-RESULTS v5/5 (rolled back): grid due_at column=1;
  PO task rule=1;
  K35 policy finance=1;
  finance reminds: OK;
  sender stamped=t35-fin@x.test;
  finance writes grid: denied;
  finance turns cell green rows=0;
  owner reads reminder=1;
  cost accounting reminds: denied;
  edit reminder rows=0;
  cost accounting K35 override: denied;
  flag off red cell: released;
  flag on red cell: rejected (K35 cells named);
  finance K35 override: OK;
  flag on with K35 override: released;
  override unknown code: rejected;
test:rls OK
```

Migrasi v4 + v5 (`2026101[7-9]*`, `2026102*`) diterapkan dua kali pada salinan latihan KGR-OS (`kgr_os_rehearsal` → `kgr_os_v5`): `pass 1 done`, `pass 2 done`; `input_task_rule` = 14, kebijakan K35 dan C53 = Finance, `v5_input` mati.

## Perintah untuk manusia (KGR-OS)

Sesudah migrasi v5/0 dan v5/1, di SQL Editor atau psql (`PGCLIENTENCODING=UTF8`):
```
supabase/migrations/20261023000100_v5_input.sql
```
Cek: `select count(*) from public.input_task_rule;` → 14; `select allowed_roles from public.release_override_policy where code = 'K35';` → `{finance}`; `select count(*) from pg_policies where tablename = 'input_reminder';` → 2.

Menghidupkan (keputusan pemilik produk, bukan bagian PR ini): Admin → Modul → `v5_input`. Lalu Admin → Modul → "Bangun ulang data mart" untuk 7 hari terakhir (atau tombol "Perbarui status tugas" di layar Input) supaya `input_task` dan `input_completeness_daily` terisi. Builder memakai kunci service role (O12, Q2 v4). Jadwal harian (cron) untuk memperbarui tugas tanpa upload belum ada di repo; menambah cron Vercel adalah perubahan env/proyek oleh manusia (Q-v5-46). Vercel memasang `xlsx@0.18.5` dari registry npm saat build (lockfile sudah memuatnya).

## Default dan pertanyaan

O6 (C22 2%, susut 3% dari `parameter.target_shrink`, yield karkas 68–76% dari parameter), O8 (aturan persetujuan parameter ditampilkan; alur usulan belum dibangun, Q-v5-45), O10 (rilis Kamis, aturan `release_week`). Pertanyaan baru: Q-v5-41 sampai Q-v5-48.

## Snapshot dan parity

Tidak berubah (lihat gate). `computeWeek` tidak disentuh; layar, builder, dan cek K35 hanya bekerja saat flag hidup.
