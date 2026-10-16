# Irisan v5/5 — rancangan: layar Input, upload tervalidasi, grid kelengkapan (K34, K35)

PRD v5 §4.9, §6.4, C51, C56, K34, K35, journey N, O, P, G12. Flag `v5_input` (mati): selama mati nav "Upload" tetap ke wizard v4 dan `release_week` sama dengan v4.

## Engine

`packages/engine/src/upload-validate.ts` — satu modul untuk browser dan server (murni, decimal.js, tanpa I/O):

```ts
type Cell = string | number | boolean | null; type Grid = Cell[][];
parseTsv(text): Grid                         // tempel dari Excel: tab, baris, tanda kutip
normHeader(h)                                // huruf kecil, spasi → "_"
upNum(v): Decimal | null                     // 1.234,5 · 36.705 · Rp 43.086 · angka Excel
upDate(v): ISODate | null                    // YYYY-MM-DD · DD/MM/YYYY · tanggal Excel (serial)
UPLOAD_TEMPLATES[kind]                       // kolom (wajib/opsional), petunjuk, nama file template
validateUpload(kind, grid, ctx): UploadResult // { checks[], rows[], ok_count, total, summary, needsReason[], fingerprint }
uploadFingerprint(kind, grid, result)        // hash murni (2 × 53-bit) atas grid ternormalisasi + hasil cek
```

Kind: `po_lines`, `costing_wp`, `yield_matrix`, `lb_supply`, `fixed_cost`, `supplier_invoice` (tabel §4.9). `ctx` dibangun server dari data (item map, lantai harga = biaya/kg mart Commercial, kelas berat, batch, parameter yield/susut/toleransi, assignment Sales, COA tetap, jadwal beban tetap, jurnal per dokumen) dan dikirim apa adanya ke browser; server membangunnya lagi saat simpan.

Cek mengikuti `validate()` mockup `Input.dc.html` dengan perbedaan Lampiran D: toleransi Σ SKU vs hasil potong = C22 2% (`ctx.tolerance`, O6), target susut dari `parameter.target_shrink`, yield karkas dari `parameter.yield_karkas_min/max`.

- **Kelas terdaftar** (C51) = kelas di `weight_class` yang sudah punya angka (rata-rata atau rentang). Seed v5/0 menyiapkan kode K/S/B tanpa angka (O5); kelas itu "belum terdaftar" sampai PPIC mengisinya — sama dengan mockup ("1 dari 3 · baru STD 2,0 kg"). `registeredClasses()` dipakai juga oleh C51 layar PPIC.
- **Kelas batch WP** = kelas terdaftar yang rentangnya memuat kg/ekor. Rentang K/S/B mockup ilustrasi (Lampiran D): golden memakai keadaan seed (STD 1,8–2,2) → kelas STD; "kelas S" Lampiran B.5 diuji dengan rentang ilustrasi sebagai input tes berlabel, bukan golden.
- **Ukuran karkas** (C50 di upload PO) dari kolom opsional `ukuran` → `item_map.size_kg` → nama item ("Uk 1.3"); kunci karkas RPA fresh dan n/a wajib ukuran (mockup).
- **Lantai** = biaya/kg SKU (v5/1). Bila Sales tidak boleh melihat biaya (`sales_sees_cost` false) lantai tidak dikirim; cek lantai menjadi `info` dan approval C38 tetap berjalan saat simpan.

`packages/engine/src/input-tasks.ts`:

```ts
parseDueRule("batch.date + 1 day 12:00") → { anchor, days, time } | { event: true }
dueAt(rule, anchorDate) → "YYYY-MM-DDTHH:MM:00+07:00"
taskInstances(rules, facts, date) → InputTask[]   // status dari data: belum / menunggu / masuk / lolos cek / terlambat
effectiveStatus(task, now)                        // belum + lewat tenggat = terlambat (dibaca layar dan rilis)
completenessCells(tasks) → CompletenessCell[]     // per tanggal × input: passed / noted / late / not_due
k35({ cells, now, override }) → { ok, red[] }     // sel merah minggu yang dirilis tanpa override K35
```

## Data (migrasi `20261023000100_v5_input.sql`, hanya menambah)

- `input_completeness_daily.due_at` (tenggat sel; rilis menghitung sel `not_due` yang sudah lewat tenggat sebagai merah).
- `input_reminder` (pengingat Finance ke pemilik input; stamp, audit, RLS: tulis finance/admin, baca semua pengguna aplikasi; indeks per tanggal).
- `release_override_policy`: cek kode diperlebar dari `C\d{1,2}` ke `C\d{1,2}|K35` (pola v3/v4: `drop constraint if exists` lalu cek yang lebih lebar); baris kebijakan `K35` (Finance) dan `C53` (Finance).
- `release_week` (create or replace, tanda tangan sama): bila `v5_input` hidup, sel `late` (atau `not_due` lewat tenggat) di minggu itu menolak rilis kecuali ada override `K35` untuk minggu itu.
- Builder mart `v5_input` (`input_task`, `input_completeness_daily`) didaftarkan di registry rebuild; tidak ada cron di repo (jadwal harian = tugas manusia, QUESTIONS).

## Simpan (server action)

Browser: file (.xlsx/.xls via SheetJS 0.18.5 build mini, impor dinamis; .csv dan tempel TSV tanpa library) → `Grid` → `validateUpload` → pratinjau + fingerprint. Simpan mengirim `kind`, grid mentah, fingerprint, alasan. Server: bangun `ctx` lagi → `validateUpload` → tolak bila fingerprint beda ("data berubah sejak pratinjau") → simpan hanya baris tanpa `fail` → `upload` (committed, checks, ok_count, preview_fingerprint, file_sha256 = SHA-256 grid) → antre rebuild tanggal terdampak.

| Kind | Tujuan | Kunci idempoten |
|---|---|---|
| `po_lines` | `sales_line` Order (Confirmed), `size_kg` dari kolom `ukuran`; di bawah lantai → `discount_approval` (C38) | `line_key` = no_po \| kode \| n |
| `costing_wp` | `batch_output_sku` (WP) per batch; selisih di atas C22 wajib alasan, batch tetap sementara | (batch, key, kode) |
| `yield_matrix` | `yield_matrix` (pola `karkas`, berlaku hari ini) | (kelas, pola, kunci, mulai) |
| `lb_supply` | `lb_supply` status confirmed | (tanggal, pemasok, kelas) |
| `fixed_cost` | `fixed_cost_schedule` per COA × bulan | `code` = `v5:<coa>:<bulan>` |
| `supplier_invoice` | `cost_pool_line` (Accurate, LB) + `batch.invoice_status` | `line_key` = `PI|<no_faktur>|n` |

## Layar `/input` (mockup `Input.dc.html`)

Peran (tombol per role dengan jumlah tugas gagal/terlambat; admin dan management bisa berganti role, management baca saja) · hari ini (cut-off LB 12.00, fresh dari `parameter.cut_off_time`) · headline · 4 kartu per role · tugas saya · upload dan cek (pilih file / tempel / contoh / template; cek; baris; "Simpan N baris yang lolos"; ringkasan efek) · form parameter (nilai berlaku + tempat mengubahnya; usulan dengan persetujuan O8 dicatat) · riwayat dan siapa yang menunggu · kelengkapan data (Finance: grid input × hari, pengingat, "Rilis dengan alasan" → override K35). Role wajib: Cost Accounting, Sales, Kepala Sales, PPIC, Purchasing, Inventory Accounting (jurnal/stok lewat wizard v4), Finance, Direktur Operasional (keputusan harga LB).

## Snapshot v1

`computeWeek` tidak disentuh. Gate: snapshot EMPTY, parity 17.161/17.161.
