Diamendemen oleh docs/PRD-v5.2-A-kode.md dan -B-db.md sejak 17 Okt 2026; lihat Bab 1.3.

# PRD v5.1 — Perbaikan hasil review v5 (K35, akses, costing, jam data, DB sungguhan)

Status: Draft untuk review pemilik produk, lalu handoff ke Claude Code · Owner: Dika (Group Project Finance, SAMB) · Tanggal: 17 Okt 2026 (WIB)
Repo: dikagustiana/KGR-Weekly-Outlook · Basis: origin/main 67c7f03 (merge PR #31) · Supabase aplikasi: KGR-OS pczjhmzpkknzkziipvit (tidak disentuh dari Claude Code) · Vercel kgr-weekly-outlook

Dokumen ini **mengamendemen** PRD v5, tidak menggantikannya. Semua pasal PRD v5 tetap berlaku kecuali yang disebut di Bab 1.3. Sumber: review kode v5 ebe4ad8..67c7f03 tanggal 17 Okt 2026 (engine, loader/builder/action, migrasi/RLS, UI/PR #31). Setiap requirement di Bab 3 menunjuk temuan review (A.n / B.n) supaya jejaknya jelas.

**Cara baca untuk Claude Code.** Bab 1 (keputusan) mengikat. Bab 3 adalah daftar requirement R1–R40 dengan lokasi file:baris pada 67c7f03, spesifikasi perbaikan, dan bukti yang diminta. Bab 4 membagi R ke lima irisan berurutan; **satu branch dan satu PR per irisan; berhenti di akhir tiap irisan untuk sign-off**. Bab 7 adalah checklist eksekusi yang wajib diikuti urutannya; jangan mengerjakan item irisan berikutnya sebelum irisan berjalan di-sign-off. Bila dua pasal tampak bertentangan atau sebuah R butuh keputusan yang belum ada di Bab 1, berhenti dan tanya dengan menyebut nomor R dan pasalnya. Jangan menjalankan SQL ke KGR-OS production, jangan mengaktifkan flag di production, jangan merge.

Konvensi angka dan format: PRD v5 (titik ribuan, koma desimal, "jt", minus U+2212).

---

## 0. Ringkasan masalah

Review 17 Okt menemukan 27 temuan pasti dan 12 dugaan. Polanya:

1. **Putaran mingguan tidak bisa berjalan pada database sungguhan dengan role selain Admin.** K35 memblokir rilis dengan sel tugas "rilis" itu sendiri; Sales dengan assignment per SKU ditolak trigger saat membuat komitmen; layar Manajemen terbuka untuk semua role; C53 tidak pernah memblokir rilis; kunci komitmen tidak atomik.
2. **"Hari ini" ganda.** `dataToday` dipakai untuk tanggal potong keputusan harga LB, padahal `week.update_date` adalah kolom manual yang tidak dimajukan upload apa pun. Rebuild hanya untuk tanggal pemicu, sehingga mart s.d. tanggal data tidak pernah diperbarui.
3. **Angka 0 di tempat missing.** Biaya SKU tanpa harga acuan = 0 di mode final; harga LB kosong → biaya dihitung dengan 0; beban tetap tanpa nominal tampil 0; Kas 0,0 masih ada di Outlook bulan.
4. **Error ditelan.** Semua loader v5 mengubah error PostgREST menjadi "belum ada / tanpa basis". Ini kelas bug yang lolos sebelum PR #31 dan masih terbuka.
5. **Beberapa pasal PRD v5 diputuskan sendiri oleh implementasi** dan dicatat sebagai "default" (C50 fail vs PERIKSA; stok bebas tanpa komitmen; tata letak journey K; grid 76 px). PRD v4 §2 butir 8 mewajibkan bertanya.

Tujuan v5.1: journey K, L, M, N, O, P (PRD v5 §9.3) lulus pada **PostgREST sungguhan** dengan **role sebenarnya** (bukan Admin) dan **flag dinyalakan bertahap**, tanpa mengubah computeWeek, golden v1, paritas, dan snapshot.

---

## 1. Keputusan

### 1.1 Keputusan yang dipertahankan

Semua K1–K37 PRD v5 dan O1–O14 dengan default yang tercatat di docs/v5/QUESTIONS.md tetap berlaku, kecuali yang diubah di 1.2.

### 1.2 Keputusan baru

"Ditetapkan" = diputuskan pemilik produk 17 Okt 2026. "Default" = dipakai sampai pemiliknya mengubah. "Usulan" = dibangun di belakang parameter; implementasi tidak boleh memfinalkan.

| # | Keputusan | Isi | Pemilik | Status |
|---|---|---|---|---|
| K38 | Dua "hari ini", satu aturan | **Tanggal data** (`dataToday`) hanya untuk membaca mart dan menentukan cut-off aktual/outlook. **Jam dinding WIB** untuk semua tenggat, status terlambat, cut-off jam, stempel waktu, **tanggal potong keputusan harga LB (besok = jam dinding + 1)**, jendela tugas dan grid Input, dan "spot hari ini". Satu fungsi `clock()` di `apps/web/lib/clock.ts` mengembalikan `{ data: ISODate, wall: ISODate, now: ISO }`; semua loader memakainya, tidak ada lagi `jakartaNow()`/`dataToday()` langsung di loader v5. | Pemilik produk | ditetapkan |
| K39 | `update_date` dimajukan oleh data | `week.update_date` tidak lagi manual saja: setiap commit upload jurnal (`gl_daily`), stok (`stock_daily`), atau WP untuk tanggal d dalam minggu berjalan menaikkan `update_date` ke `max(update_date, d + 1)` (data aktual = transaksi sampai kemarin, v1), dibatasi `week_start + 7`. Form parameter tetap bisa mengubahnya ke belakang. | Finance + Inventory Accounting | default |
| K40 | Rebuild menutup jarak ke tanggal data | Setiap upload/aksi yang mengantrekan rebuild men-queue **semua tanggal dari tanggal terdampak sampai tanggal data** (inklusif), bukan hanya tanggal terdampak dan hari ini. Batas 62 hari; lebih dari itu ditolak dengan pesan "rebuild manual dari Admin". | Pemilik produk | ditetapkan |
| K41 | Error tidak pernah menjadi "belum diisi" | Loader, builder, dan action tidak menelan error PostgREST. Tile yang sumbernya gagal tampil `state: error` dengan `error.message` (komponen Card/Table/Chart sudah punya state error, v4 §5.3) dan dicatat `console.error` di server dengan nama loader. "belum diisi"/"tanpa basis" hanya untuk hasil kosong yang sah. Lint: `rg "catch \(\) \{|catch \(e\) \{ *return|\.catch\(\(\) =>|data \?\? \[\]\)" apps/web/lib/v5 apps/web/lib/v4` harus 0 hit di luar whitelist Bab 5.3. | Pemilik produk | ditetapkan |
| K42 | Batas baris dan panjang URL | Setiap query mart/transaksi memakai `fetchAll`; `.limit(n)` dengan n > 1000 dilarang. `.in()` dipotong 200 nilai per request (helper `inChunks`). | Pemilik produk | ditetapkan |
| K43 | Satu "key" assignment | `sales_assignment.key` boleh berisi key SKU penuh atau key dasar. Trigger dan view membandingkan dengan `base_key(x) = regexp_replace(x, '\|(Fresh|Frozen|n/a)$', '')` di kedua sisi. | Kepala Sales + Admin | default |
| K44 | Sel "rilis" bukan syarat rilis | Rule `release_week` tetap sebagai tugas Finance di "Tugas saya", tetapi tidak masuk grid kelengkapan K35 dan tidak dinilai `release_week()`. | Finance | ditetapkan |
| K45 | K35 menolak grid yang belum dibangun | Bila `v5_input` hidup dan tidak ada baris `input_completeness_daily` untuk minggu yang dirilis, rilis ditolak: "grid kelengkapan belum dibangun; Admin → Modul → Perbarui status tugas". | Finance | ditetapkan |
| K46 | Kunci komitmen satu transaksi | Kunci komitmen + price list minggu depan lewat satu RPC `lock_commitments(p_week_start, p_price_frozen jsonb)` SECURITY DEFINER: validasi semua draft (alasan untuk versi > 1), supersede versi lama, kunci, isi `price_list_week.price_fresh` **dan** `price_frozen` (dari form, kolom baru; bila kosong = `sku_price` frozen minggu berjalan berlabel). Gagal satu = gagal semua. Engine membaca hanya versi `locked` tertinggi per key. | Kepala Sales | ditetapkan |
| K47 | C53 memblokir rilis di DB | `release_week()` menilai `controls_v3` untuk kode `C53` dengan override `release_override code='C53'` (policy sudah di-seed). C55 tetap hanya menahan kunci V1 di app (Q-v5-24). | Finance | ditetapkan |
| K48 | Manajemen dibatasi role | `/minggu-ini/[week]` (dan tile sim-lb, t-input) hanya untuk admin, management, operations_director, finance. Role lain → `notFound()`. Nav tidak berubah. | Pemilik produk | ditetapkan |
| K49 | K32 ditegakkan di RLS | Trigger `tg_sales_line_scope` pada `sales_line` untuk role sales: `customer` dan `base_key(item → key)` harus ada di `sales_assignment` aktif (key null = semua SKU). Soft-delete baris PO oleh upload hanya untuk baris yang `line_key`-nya diawali `upload_id` pengunggah atau pelanggan ter-assign. | Kepala Sales | ditetapkan |
| K50 | Missing tetap missing di costing | `allocateBatch` mengeluarkan `costPerKg: null` dan `canBeFinal: false` untuk SKU tanpa harga acuan; lot dari batch itu `cost_status` tidak boleh 'final'. Harga LB kosong (tanpa keputusan, tanpa `batch.lb_price`, tanpa `parameter.lb_price_today`) → `planCost` tidak dijalankan, C57 BELUM DIISI, `cost_per_kg` null. | Finance + Cost Accounting | ditetapkan |
| K51 | Beban tetap: per baris K29, missing ≠ 0 | Daftar baris tetap = union(gaji, penyusutan, bunga, sewa) ∪ baris jadwal bulan itu. Baris tanpa nominal (tidak ada jadwal dan tidak ada FINAL) = `null`, tabel menulis "belum ada", `nibt_after` null, C55 PERIKSA. | Finance | ditetapkan |
| K52 | Solvabilitas memakai NIBT setelah beban tetap | Saat `v5_pl` hidup, `solvency.nibtMonth` = `plTotalsV5(...).nibtAfter` (termasuk `fixed_estimate`). Saat mati, perilaku v4. | Finance | ditetapkan |
| K53 | Flag per-role hanya untuk layar | Nilai `roles` pada flag v5 membatasi **layar**, bukan mart. Builder menulis kolom v5 bila `enabled` global; pembaca mart (Commercial, Manajemen, P&L) memakai kolom v5 hanya bila `isModuleOn(flag, viewer.role)`. View `commercial_daily_sales_v5` menyembunyikan `cost_per_kg` bila `parameter.sales_sees_cost = false`. SUMMARY menyatakan ini eksplisit. | Pemilik produk | ditetapkan |
| K54 | Satu sumber K25 | `k25 = isModuleOn('v5_costing', role) || isModuleOn('v5_management', role)` lewat satu helper `k25On(settings, role)`; dipakai Outlook, Rencana v4, print, PDF, OutlookBody. | Pemilik produk | ditetapkan |
| K55 | mart_replace mengirim semua kolom | Payload mart yang punya kolom v5 selalu memuat kunci kolom v5 (null bila flag mati), supaya `mart_replace` (daftar kolom dari baris pertama) membersihkan nilai lama. | Pemilik produk | ditetapkan |

### 1.3 Pasal yang diubah / dicabut

| Dokumen | Pasal | Yang diubah | Diganti |
|---|---|---|---|
| docs/v5/QUESTIONS.md | Q-v5-54 | "Tanggal potong, keputusan, putaran memakai dataToday" | K38 (jam dinding untuk tanggal potong dan keputusan) |
| docs/v5/QUESTIONS.md | Q-v5-36 | "Komitmen minggu depan tidak dikurangkan dari stok hari ini" dicatat sebagai default | Dibuka kembali sebagai O16 (Bab 6); default tetap, tetapi label "default implementasi, menyimpang dari §4.6" wajib di QUESTIONS |
| docs/v5/QUESTIONS.md | Q-v5-43 | Baris karkas tanpa ukuran = fail | Dibuka sebagai O15; default baru = **warn** + tersimpan `size_kg null` (sesuai K33/C50) |
| docs/v5/QUESTIONS.md | Q-v5-50, Q-v5-56 | Tata letak keputusan baris 8–12 dan grid `minmax(76px, auto)` diputuskan implementasi | O17, O18 (Bab 6); tidak diubah di v5.1 sampai pemilik memutuskan |
| PRD v5 §4.9 | "tanggal kirim ≥ hari ini" | hari ini = jam dinding (sudah demikian) | ditegaskan K38 |

---

## 2. Tujuan terukur

| ID | Tujuan | Ukuran penerimaan |
|---|---|---|
| T7 | Putaran berjalan dengan role sebenarnya | Journey L dijalankan di PostgREST lokal dengan 6 user (commercial_lead, sales ber-assignment SKU, ppic, operations_director, cost_accounting, finance), **bukan Admin**; setiap langkah lolos; log 0 error 4xx/5xx |
| T8 | Rilis K35 tanpa override pada minggu lengkap | Fixture minggu 24–30 Agu dengan semua input terisi: `release_week()` lulus tanpa `release_override`; dengan satu sel merah: ditolak dengan pesan sel itu; dengan grid kosong: ditolak K45 |
| T9 | Tidak ada 0 untuk missing | Grep output `plTable`, `allocateBatch`, kartu Kas, kartu Outlook bulan pada fixture tanpa harga/nominal/saldo → semua `null`/"belum ada"; tes unit per kasus |
| T10 | Tidak ada error yang ditelan | Lint K41 = 0 hit di luar whitelist; uji sengaja: kolom salah di satu loader → tile menampilkan state error, bukan "belum ada" |
| T11 | Flag bertahap dan per-role | 7 kombinasi flag Bab 5.4 dibuka oleh 3 role → 0 error, tidak ada "TUNDA/BELI" bila K25 aktif, Sales tidak melihat kolom biaya v5 saat `sales_sees_cost=false` |
| T12 | Engine dan snapshot tetap | `pnpm parity` 17.161/17.161, `pnpm snapshot:diff` kosong, golden v1 dan v5 (B.1–B.5) tetap dalam toleransi yang sudah tercatat |

---

## 3. Requirement (R) — temuan → perbaikan

Format: **R-n [kategori] (temuan review)** · Lokasi pada 67c7f03 · Spesifikasi · Bukti yang diminta di PR.

### 3.1 Rilis dan K35

**R1 [migrasi] (A.1)** · `supabase/migrations/20261023000100_v5_input.sql:97-104`; `apps/web/lib/v5/input-data.ts:165-168`; `apps/web/lib/release.ts:46-54`; `packages/engine/src/input-tasks.ts` (fungsi grid).
Spesifikasi (K44): migrasi baru `20261024000100_v51_release.sql` menulis ulang `release_week()` (create or replace, badan sama) dengan klausa K35 menambah `and c.kind <> 'release_week'`; builder grid (`buildInputDay`) tidak menulis sel `input_completeness_daily` untuk kind `release_week`; `k35()` di app sama. Tugas `release_week` tetap dibuat di `input_task`.
Bukti: blok tes di `rls_roles.sql`: minggu dengan semua sel lolos kecuali `release_week` → rilis diterima; unit test `input-tasks.test.ts` grid tanpa `release_week`.

**R2 [migrasi] (A.20a)** · `20261023000100_v5_input.sql:98-106`.
Spesifikasi (K45): di fungsi yang sama, sebelum menghitung `red`: bila `v5_input` hidup dan `not exists (select 1 from input_completeness_daily where date between ws and ws+6)` → `bad := concat_ws('; ', bad, 'K35: grid kelengkapan belum dibangun …')`. Pre-check app `lib/release.ts` menolak lebih dulu dengan pesan sama.
Bukti: tes RLS: grid kosong → ditolak; grid ada → lanjut.

**R3 [migrasi] (A.4)** · `20261023000100_v5_input.sql:92`; `apps/web/lib/release.ts:38`; `packages/engine/src/snapshot.ts:74`.
Spesifikasi (K47): `release_week()` menambah `bad := concat_ws('; ', bad, public.release_rejections(snap -> 'controls_v3', array['C53'], 'week', ws, is_strict))` (fungsi sudah membaca `e->>'code'`); `releaseVerdict` app menggabungkan kode `controls_v3` ∩ {C53}. Override lewat `release_override code='C53'` (policy sudah ada).
Bukti: tes RLS: snapshot dengan C53 BELUM DIISI → ditolak; dengan override Finance → diterima; override oleh admin → RLS menolak insert override.

**R4 [bug] (A.5)** · `packages/engine/src/costing.ts:603`.
Spesifikasi: `Date.parse(b.dueAt) < Date.parse(x.now)`; cek yang sama untuk semua perbandingan ISO di `costing.ts`, `input-tasks.ts`, `commercial-v5.ts` (`rg "< x.now|> x.now|<= now|dueAt <" packages/engine/src`).
Bukti: unit test due `…T12:00+07:00`, now 13.30 WIB → BELUM DIISI; 11.59 WIB → LULUS.

### 3.2 Akses dan RLS

**R5 [keamanan] (A.2)** · `20261021000100_v5_foundation.sql:310-312, 341`; `apps/web/app/komersial/actions-v5.ts:86`; `20261022000100_v5_costing.sql:29`.
Spesifikasi (K43): fungsi SQL `public.base_key(text) returns text immutable`; `tg_commitment_guard`, `tg_surplus_response_guard`, dan view `commercial_daily_sales_v5` memakai `base_key(a.key) = base_key(new.key)` (view: `base_key(a.key) = base_key(c.key)`). View diganti dengan `create or replace` **hanya bila daftar kolom tidak berubah** (Q-v5-16); bila berubah, buat `_v51`.
Bukti: tes RLS baru dengan `sales_assignment.key = 'RPA|Karkas|Fresh'` dan komitmen `key='RPA|Karkas'` → diterima; key lain → ditolak.

**R6 [keamanan] (A.3)** · `apps/web/app/minggu-ini/[week]/page.tsx:21`.
Spesifikasi (K48): `requireModulePage`-style guard `["admin","management","operations_director","finance"]` sebelum `loadMingguIni`. Tile `sim-lb` dan `t-input` ikut guard yang sama (sudah implisit).
Bukti: tes layar: role `sales` → notFound; `finance` → render.

**R7 [keamanan] (A.9)** · `20261014000200_security.sql:208-212`; `apps/web/lib/v5/input-save.ts:88-96`.
Spesifikasi (K49): migrasi `20261024000200_v51_security.sql`: trigger `tg_sales_line_scope` before insert/update on `sales_line` untuk `current_role() = 'sales'`: `customer` ada di `sales_assignment` aktif untuk email itu, dan (`a.key is null` atau `base_key(a.key) = base_key(item_map.key)`); gagal → `42501`. `input-save.ts`: `existing` difilter `customer in (assigned)` untuk role sales, dan `line_key like upload_prefix%` untuk semua role.
Bukti: tes RLS: sales insert pelanggan tak ter-assign → ditolak; `input-save.test.ts`: file parsial tidak menghapus baris pelanggan lain.

**R8 [keamanan/UI] (B.7)** · `20261022000100_v5_costing.sql:17-27`.
Spesifikasi (K53): view `commercial_daily_sales_v5` mengeluarkan `cost_per_kg`, `cost_status`, `cost_check` sebagai `case when (select sales_sees_cost from parameter …) then … end`; bila daftar kolom berubah, nama view baru `commercial_daily_sales_v51` dan loader berpindah.
Bukti: tes RLS: `sales_sees_cost=false` → kolom null untuk sales; admin tetap melihat.

**R9 [keamanan kecil] (B.9)** · `apps/web/lib/v5/input-data.ts:74`; `komersial-data.ts:50`.
Spesifikasi: `.eq("email", viewer.email.toLowerCase())` (kolom disimpan lower) menggantikan `.ilike`.

### 3.3 Jam data dan rebuild

**R10 [bug] (A.6)** · `apps/web/lib/v5/management-data.ts:28,34`; `app/minggu-ini/[week]/page.tsx:29-31`; `lib/v5/input-data.ts:46,221-257`; `lib/v5/komersial-data.ts:43`; `management-data.ts:103`; `komersial/v5.tsx`, `rencana/v5.tsx` (`loadSources(sb, nowWib())`).
Spesifikasi (K38): modul `apps/web/lib/clock.ts` → `clock(sb): Promise<{ data, wall, now }>`. Manajemen: `cutDate = addDays(wall, 1)`; label simulasi menyebut kedua tanggal bila `data ≠ wall` ("data per 27 Agu · potong Sab 18 Okt"). Jendela tugas/grid Input, Status putaran, dan `loadSources` memakai jendela yang **sama** (`[wall-13, wall+7]`, late dari `now`). Spot "hari ini" = `data === wall`.
Bukti: `data-today.test.ts` diganti `clock.test.ts`; tes layar Manajemen dengan `data=2026-08-27, wall=2026-10-17` → form keputusan `date=2026-10-18`; `rg "jakartaNow\(\)|dataToday\(" apps/web/lib/v5 apps/web/app` = 0 hit di luar `clock.ts`.

**R11 [DB] (A.6, K39)** · `apps/web/lib/v5/input-save.ts` (commit `gl_daily`, `stock_daily`, `costing_wp`), `apps/web/lib/upload.ts` (wizard v4 jurnal/stok).
Spesifikasi (K39): setelah commit sukses untuk tanggal d dalam minggu berjalan (status open): `update week set update_date = greatest(update_date, least(d + 1, week_start + 7))`. Lewat RPC kecil `advance_update_date(p_week_id, p_date)` SECURITY DEFINER dengan cek role (inventory_accounting, cost_accounting, finance, admin) supaya RLS `week` tidak perlu dibuka. Tidak mengubah `apply_changes`.
Bukti: tes RLS RPC; tes layar: upload jurnal 28 Agu → `update_date` 29 Agu → `dataToday` ikut.

**R12 [DB] (A.11)** · `apps/web/lib/v5/input-save.ts:62`; `lib/v5/lb-decision.ts`; `lib/rebuild.ts queueRebuild`.
Spesifikasi (K40): helper `queueThrough(sb, fromDate)` = queue `fromDate … clock().data` (maks 62 hari; lebih → WriteError). Semua pemanggil `queueRebuild` di v5 memakainya. Trigger `needs_rebuild` di DB tetap (hanya tanggal pemicu; app menutup sisanya).
Bukti: unit test queue dari 26 Agu dengan data 27 Agu → 2 tanggal; dari 1 Jul → ditolak.

**R13 [migrasi] (A.20b)** · `20261021000100_v5_foundation.sql:469-471`.
Spesifikasi: di `20261024000100_v51_release.sql` pasang `tg_needs_rebuild` ke `sales_commitment`, `price_list_week`, `size_class_map`, `plan_week_class`, `surplus_response` (fungsi sudah membaca `week_start`; untuk `size_class_map` pakai `effective_from` → minggu berjalan).
Bukti: tes RLS: insert komitmen → baris `rebuild_queue`.

### 3.4 Komitmen dan Commercial

**R14 [bug/DB] (A.10)** · `apps/web/app/komersial/actions-v5.ts:46-63`; `packages/engine/src/commercial-v5.ts:111`; `v5_foundation.sql:141,333-334`.
Spesifikasi (K46): RPC `lock_commitments(p_week_start date, p_price_frozen jsonb)` SECURITY DEFINER, `search_path=''`, cek `has_role('admin','commercial_lead')`: (1) kumpulkan draft minggu itu; (2) bila ada draft versi > 1 tanpa `reason` → raise `23514` dengan daftar key; (3) set `locked` versi lama → `superseded`; (4) draft → `locked`, `locked_by/at`; (5) upsert `price_list_week` `price_fresh` dari komitmen, `price_frozen` dari `p_price_frozen[key]` atau `sku_price` frozen minggu berjalan (kolom `price_frozen_source text` baru: 'form' | 'sku_price'); (6) insert `rebuild_queue`. Action memanggil RPC saja. Form komitmen menambah kolom "harga frozen" (opsional). Engine `commitmentDemand` memilih `max(version)` per key di antara `locked`.
Bukti: tes RLS: draft v2 tanpa alasan → seluruh kunci batal, tidak ada baris berubah; unit test engine dua versi locked (data lama) → yang tertinggi.

**R15 [UI] (A.27 form komitmen)** · `apps/web/app/komersial/v5.tsx:34-36`.
Spesifikasi: ketiga input (`fresh`, `frozen`, `harga`, `harga_frozen`) `disabled` dengan aturan yang sama.

**R16 [PRD/UI] (A.27 "Dari PPIC" Sales)** · `apps/web/lib/v5/komersial-data.ts:88`.
Spesifikasi: teks "Tidak ditampilkan untuk Sales (data perencanaan)" bukan "Belum ada rencana PPIC".

### 3.5 Costing dan P&L

**R17 [PRD] (A.8a)** · `packages/engine/src/costing.ts:225` (`allocateBatch`), tipe `AllocationLine`; builder M1 `apps/web/lib/v3/costing.ts`, `lib/v3/ledger.ts` (cost_status).
Spesifikasi (K50): `costPerKg: null` bila `r.price === null`; `AllocationResult.canBeFinal: boolean`; ledger: lot dari batch dengan `canBeFinal=false` tidak pernah `cost_status='final'` (tetap 'sementara' dengan `cost_check='harga acuan kosong'`); C54 memperlakukan null sebagai "periksa biaya". Golden v1 tidak berubah (fungsi lama `allocateBatch` v1 untuk computeWeek **tidak disentuh** bila berbeda; bila fungsi yang sama, tambahkan opsi `{ nullMissing: true }` default false untuk jalur v1 dan true untuk v5).
Bukti: unit test Lemak fresh → null + `canBeFinal=false`; `pnpm snapshot:diff` kosong.

**R18 [PRD] (A.8b)** · `apps/web/lib/v5/costing.ts:112`.
Spesifikasi (K50): `lbPrice === null` → `result: null`, `costByKey` kosong, C57 BELUM DIISI dengan detail batch; tidak ada fallback `"0"`.
Bukti: tes layar Costing tanpa harga → kolom biaya "belum diisi", C57.

**R19 [PRD] (A.15)** · `packages/engine/src/pl-v5.ts:46,116,183`.
Spesifikasi (K51): `lines = unique([...FIXED_LINES_K29, ...inMonth.pl_line])`; `fixedNominals` mengembalikan `nominal: null, source: 'belum ada'` per baris tanpa jadwal dan tanpa FINAL; `plTable`: `fixed = semua null ? null : sum(non-null)`, `nibt_after = fixed === null ? null : …`; C55 PERIKSA bila ada baris 'belum ada' atau 'estimasi bulan lalu'. Golden `pl-2026-08` tidak boleh berubah (Agustus punya semua nominal).
Bukti: unit test jadwal hanya depresiasi → gaji/bunga dari FINAL Juli tetap muncul; tanpa FINAL → null; `pl-v5.test.ts` B.2 tetap.

**R20 [PRD] (A.16)** · `apps/web/lib/v3/cash.ts:97`; `packages/engine/src/month-v4.ts:26`.
Spesifikasi (K52): `nibtMonth = v5PlOn ? plTotalsV5(rows termasuk fixed_estimate).nibtAfter : nibtV4 ?? nibt`; bila `nibtAfter === null` → kartu "belum ada" dengan alasan.
Bukti: fixture Agustus → bulan ke ekuitas negatif dihitung dari −7,8 jt (angka tercatat di tes).

**R21 [DB] (A.18)** · `apps/web/lib/v4/outlook-bulan-data.ts:133`.
Spesifikasi: `.gt("accounts", 0)`; logika `noBalance` sama dengan `kas-data.ts:216`.
Bukti: tes layar Outlook bulan tanpa saldo → "belum diisi".

**R22 [DB] (A.22)** · `apps/web/lib/v3/commercial.ts:100`; `lib/v3/ledger.ts:213,254`; `lib/v4/week-pl.ts`.
Spesifikasi (K55): payload selalu memuat `cost_per_kg`, `cost_status`, `cost_check` (null bila flag mati).
Bukti: unit test builder dengan flag mati → kunci ada bernilai null.

**R23 [DB] (A.23)** · `apps/web/lib/v3/costing.ts:416`.
Spesifikasi: `.eq("status","Aktual")` pada pencarian batch untuk `cost_pool_pi`; bila tidak ada batch Aktual → tolak commit faktur dengan pesan "batch aktual … belum ada".

**R24 [PRD] (A.24d)** · `apps/web/app/komersial/actions-v5.ts:84` → digantikan R14.

### 3.6 Loader: error, batas baris, URL

**R25 [DB] (A.14)** · `lib/v5/management-data.ts:30-32,91-100`; `lib/v5/komersial-data.ts:32-34,53-55,89-105`; `lib/v5/ppic-data.ts:101-104`; `lib/v5/pl.ts:207,225`; `lib/v5/input-data.ts:69,94,109,224,257`; `lib/v4/week-pl.ts:39`; `lib/data.ts:53`.
Spesifikasi (K41): helper `must(res, where)` melempar `LoaderError(where, message)`; loader tile mengembalikan `{ state: 'error', message }` untuk tile itu saja (bukan seluruh halaman) lewat tipe `TileData<T> = { ok: T } | { error: string }`; model tile merender state error komponen v4. Whitelist: hanya `dataToday`/`clock` boleh fallback (ke jam dinding) **dengan** `console.error`.
Bukti: lint K41 = 0 hit; tes layar dengan mock yang mengembalikan `error` → tile state error.

**R26 [DB] (A.12)** · `lib/v5/costing.ts:69-80`; `lib/v5/ppic-data.ts:48`.
Spesifikasi (K42): helper `inChunks(sb, build, ids, 200)` di `lib/data.ts`; atau filter tanggal (`gte("date", from)`) menggantikan `.in(ids)` untuk `allocation_run`/`batch_output_sku`.
Bukti: unit test 450 id → 3 request.

**R27 [DB] (A.13)** · `lib/v4/minggu-ini-data.ts:65-66`; `lib/v4/week-pl.ts:38`; `lib/v5/input-data.ts:291`; `management-data.ts:82,136`.
Spesifikasi (K42): `fetchAll`. Lint: `rg "\.limit\((1[0-9]{3}|[2-9][0-9]{3,})\)" apps/web` = 0.

### 3.7 Flag

**R28 [flag] (A.19)** · `app/w/[week]/outlook/page.tsx:27`; `rencana/v4.tsx:44`; `print/page.tsx:20`; `api/w/[week]/pdf/route.ts:16`; `OutlookBody.tsx:81,102`; `lib/pdf.ts:86`; `lib/v3/commercial.ts:51,117`; `lib/v3/ledger.ts:45`; `lib/v5/costing-pl.ts:42`; `komersial-data.ts:65`; `management-data.ts:96-116`.
Spesifikasi (K53, K54): helper `k25On(settings, role)`; pembaca mart v5 memakai `isModuleOn(flag, role)`; Status putaran: baris modul mati → "modul belum aktif" (bukan "lewat tenggat").
Bukti: tes layar 7 kombinasi Bab 5.4 × 3 role (admin, sales, management): tidak ada "TUNDA"/"BELI" bila k25On; Sales tanpa kolom biaya v5 saat flag per-role admin.

### 3.8 PPIC

**R29 [PRD] (A.17)** · `app/w/[week]/rencana/actions.ts:58-64`; `lib/v5/ppic-data.ts:168`; `rencana/v5.tsx`.
Spesifikasi: `copyBlockers` menambah C57 (dari `v5CostingControls` tanggal potong) dan menghormati `src.reasons` kode C58; server `copyClassPlanAction` cek yang sama; `rencana/v5.tsx` merender `ActionForm reasonAction` (code C58, C57 **tidak** boleh dialasankan: C57 memblokir tanpa pengecualian per §7).
Bukti: tes layar: tanpa keputusan LB → tombol disabled "C57"; supply kurang + alasan → tombol aktif.

**R30 [UI] (A.27 headline PPIC, label kelas)** · `lib/v5/ppic.ts` headline; `management-data.ts:64`.
Spesifikasi: `classes.length === 0` → "dalam kelas STD (kelas berat belum diisi PPIC)"; label Manajemen tidak menghitung STD sebagai kelas.

**R31 [bug] (A.27 sizeCode)** · `packages/engine/src/ppic-class.ts:24,80`.
Spesifikasi: kunci akumulasi `size_kg.toString()` (dua desimal); `sizeCode` untuk tampilan saja. Golden `plan-2026-08-24` v5 tidak berubah (semua ukuran satu desimal).

### 3.9 Upload

**R32 [bug] (A.7)** · `packages/engine/src/upload-validate.ts:169`.
Spesifikasi: sebelum regex ribuan: `if (/^-?0\.\d+$/.test(s)) → desimal`. Tambahkan kasus `0.715`, `0.500`, `1.234`, `12.345,6` ke tes.
Bukti: `upload-validate.test.ts`; golden `upload-samples` tetap.

**R33 [PRD] (A.24a, O15)** · `upload-validate.ts:330,351`; `lib/v5/input-save.ts` (po_lines).
Spesifikasi (O15 default): karkas RPA tanpa ukuran = **warn** C50 dengan tindakan "isi kolom ukuran atau biarkan STD"; baris tersimpan `size_kg null`; PPIC menghitung STD (sudah didukung `toClassLB`). Dibangun di belakang `parameter.po_unsized_mode text default 'warn'` ('warn' | 'fail'). Golden `upload-samples/expected.json` **berubah** (PO 7 → 5 lolos); perubahan golden dicatat di CHANGELOG dengan diff per baris, tidak diganti diam-diam.
Bukti: tes kedua mode; QUESTIONS O15.

**R34 [bug] (A.27 WP)** · `upload-validate.ts:378,395`.
Spesifikasi: baris batch dengan `kg_lb`/`ekor` kosong → semua baris batch itu `fail`; `kg_lb` yang berbeda antar baris satu batch → fail "kg LB tidak konsisten".

### 3.10 UI lain

**R35 [UI] (A.27 nav)** · `apps/web/lib/v4/nav.ts` (`D.input`, `D.upload` id sama).
Spesifikasi: `D.input.id = "input"`; wizard v4 tetap "Upload" untuk role yang punya jenis upload v4 (inventory_accounting, finance, admin, ppic, sales); panel Inventory Accounting di `lib/v5/input.ts` menautkan `/w/<week>/upload`.

**R36 [UI] (A.27 ikon/warna)** · `lib/v5/input.ts` `CELL`, `headlineOf`; `lib/v5/input-data.ts:279-349`.
Spesifikasi (v4 §5.1): `CELL = { passed: "lolos", noted: "catatan", late: "terlambat", not_due: "belum jatuh tempo" }`; hapus kalimat warna; `tone` hanya untuk nilai negatif.

**R37 [UI] (A.27 c-kas)** · `lib/v4/minggu-ini.ts:213`.
Spesifikasi: baris "tanpa pinjaman afiliasi: Rp … jt" selalu ada, dari `min(closing_without_affiliate)` bila mart kas dipakai.

**R38 [UI] (A.26)** · `lib/v5/pl-tiles.ts:209`; `lib/v4/outlook-bulan.ts:352-358`.
Spesifikasi (§6.5): `na` (NIBT setelah beban tetap) di c-actual, c-forecast, c-outlook (maxCompare 4); tabel akurasi menambah baris "NIBT jurnal" dan "NIBT + beban tetap" (FINAL = `fs-2026-09` nominal tetap bulan itu).

**R39 [PRD/UI] (A.25)** · `lib/v4/minggu-ini.ts` t-segmen, ch-stok-umur (:69-70); `lib/v5/ppic.ts` t-batch.
Spesifikasi (K20): kolom biaya/kg di t-segmen dan tabel stok umur menampilkan status dari `sku_balance_daily.cost_status` (modus per SKU; bila campur → "campur"); t-batch status dari `batch.wp_received_at` / `invoice_status` / `lot.cost_status`, bukan teks tetap.

**R40 [kecil] (A.27 lain)** · `apps/web/lib/env.ts:7-8`: fail-fast bila `SUPABASE_URL` kosong saat `NODE_ENV=production` · `components/v4/TilePage.tsx:14`: tinggi SVG dari `ResizeObserver`/`clientHeight` tile, fallback 76 px · `v5_foundation.sql` guard: tambah jalur admin `deleted_at` pada `tg_commitment_guard`/`tg_price_list_guard` (soft delete admin, bukan unlock) · `lib/v5/costing.ts:167`: `since` wajib dari `value.since`; bila kosong → C-note "since belum diisi" dan **tidak** memakai `updated_at` (B.3) · `lib/v3/ledger.ts:145`: reset cache `run` per pemanggilan `lockVersionV4` (B.4).

### 3.11 Tidak dikerjakan di v5.1 (menunggu keputusan pemilik, Bab 6)

Tata letak journey K (O17), grid `minmax` (O18), stok bebas − komitmen (O16), `fixedEstimate` positif di minggu posting (O19), C58 supply tanpa kelas (O20), K27 pola potong/fresh-frozen per SKU, tile §6.1 baris 16–18 dan 30–33, Form parameter O8, bacaan parsial §8 (Q-v5-49), cron harian (Q-v5-46), COGS forecast dari planCost (Q-v5-25). Dicatat di SUMMARY sebagai "belum terpenuhi", bukan "default".

---

## 4. Irisan pengiriman

Satu branch, satu PR per irisan. Urutan wajib. Setiap irisan: `pnpm test`, `pnpm typecheck`, `pnpm parity`, `pnpm snapshot:diff` kosong, `pnpm test:rls` (Postgres lokal), lalu uji PostgREST Bab 5 untuk irisan 1–4.

| Irisan | Branch | R | Selesai bila |
|---|---|---|---|
| 0 | `v5.1/0-docs` | commit PRD v5.1 ke `docs/PRD-v5.1.md`; baris di atas `docs/PRD-v5.md`: "Diamendemen oleh docs/PRD-v5.1.md sejak 17 Okt 2026 (Bab 1.3)"; QUESTIONS: O15–O20, koreksi Q-v5-36/43/50/54/56; SUMMARY: bagian "Belum terpenuhi" (3.11) dan catatan K53 | dokumen di-merge; tidak ada kode |
| 1 | `v5.1/1-release-access` | R1, R2, R3, R4, R5, R6, R7, R8, R9, R13, migrasi `20261024000100_v51_release.sql` + `20261024000200_v51_security.sql`; `rls_roles.sql` blok v5.1 | T8; tes RLS v5.1 hijau; journey P di PostgREST dengan user finance |
| 2 | `v5.1/2-clock-rebuild` | R10, R11, R12, R25, R26, R27 | T10; Manajemen pada data Agu dibuka Okt: form keputusan tanggal jam dinding; lint K41/K42 = 0 |
| 3 | `v5.1/3-costing-pl` | R17, R18, R19, R20, R21, R22, R23, R14, R15, R16, R24 | T9, T12; golden B.1–B.5 tetap; journey L langkah Commercial ↔ PPIC dengan commercial_lead + sales ber-assignment |
| 4 | `v5.1/4-flags-ui` | R28, R29, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40 | T11; 7 kombinasi flag × 3 role; journey K (tanpa klaim above-fold, O17), M, N, O |

Migrasi hanya di irisan 1. Irisan 2–4 tanpa migrasi; bila ternyata butuh kolom (mis. `price_frozen_source` R14, `parameter.po_unsized_mode` R33), **tambahkan ke migrasi irisan 1 sebelum PR #1 di-merge** atau buat `20261024000300_v51_params.sql` di irisan yang membutuhkannya dan catat di SUMMARY. Tidak ada drop/rename.

---

## 5. Pengujian

### 5.1 Lingkungan

PostgreSQL 16 lokal + `supabase/tests/supabase_shim.sql` + semua migrasi (termasuk v5.1) + PostgREST v12 (Docker, seperti PR #31) + `next build && next start`. **Enam user** dibuat lewat SQL seed uji (bukan di repo produksi): `finance@t`, `lead@t` (commercial_lead), `sales@t` (sales, `sales_assignment` customer `PT A` + key `RPA|Karkas|Fresh`), `ppic@t`, `opsdir@t`, `costacc@t`. Admin hanya untuk rebuild awal.

### 5.2 Data

Fixture minggu 24–30 Agu 2026 dimuat lewat jalur upload (bukan insert langsung), jam sistem dipasang `2026-08-27T09:00+07:00` dengan `faketime` atau variabel `KGR_TEST_NOW` yang dibaca `clock()` **hanya saat `NODE_ENV=test`**.

### 5.3 Whitelist K41

`apps/web/lib/clock.ts` (fallback ke jam dinding dengan `console.error`). Tidak ada yang lain. Setiap penambahan whitelist = pertanyaan ke pemilik.

### 5.4 Kombinasi flag (T11)

Prasyarat v4 semua hidup. Kombinasi v5: (1) semua mati; (2) `v5_costing` saja; (3) `v5_costing + v5_pl`; (4) `+ v5_ppic_class`; (5) `+ v5_commercial`; (6) `+ v5_input`; (7) semua hidup; ditambah (8) semua hidup dengan `roles: ["admin"]`. Tiap kombinasi dibuka oleh admin, sales, management pada Minggu ini, Komersial, Rencana, Input, Outlook bulan, Kas, Outlook preparer, print → 0 error, tidak ada "TUNDA/BELI" saat `k25On`, Sales tidak melihat kolom biaya v5 pada (8).

### 5.5 Journey (PRD v5 §9.3) pada PostgREST dengan role sebenarnya

K (management; tanpa klaim above-fold), L (lead → ppic → lead → opsdir → costacc → finance), M (opsdir), N (sales), O (costacc), P (finance). Bukti: `docs/v5.1/journey-<X>.md` berisi urutan request, role, status HTTP, dan screenshot.

---

## 6. Pertanyaan terbuka baru (dibangun di belakang parameter; tidak difinalkan implementasi)

| # | Pertanyaan | Default sementara | Pemilik |
|---|---|---|---|
| O15 | Baris PO karkas tanpa ukuran: warn + tersimpan STD (K33/C50) atau fail (journey N/B.5)? | warn (`parameter.po_unsized_mode`) | Sales + PPIC |
| O16 | Stok bebas di Commercial dikurangi komitmen terkunci minggu depan (§4.6) atau tidak (Q-v5-36)? | tidak dikurangi; **ditandai menyimpang dari §4.6** | Kepala Sales + Finance |
| O17 | Journey K: laba rugi di baris 4–7 membuat "Perlu keputusan" di bawah fold 1366×768. Pindah keputusan ke baris 4 kanan (laba rugi lebar 7), default laba rugi collapsed, atau terima scroll? | tidak diubah; klaim journey K "tanpa scroll" dicabut dari bukti sampai diputuskan | Pemilik produk |
| O18 | Grid v4 §5.3 "baris 76px" vs `minmax(76px, auto)` PR #31 | tetap `minmax`; dicatat sebagai amandemen v4 §5.3 bila disetujui | Pemilik produk |
| O19 | Baris "Beban tetap belum dijurnal" positif di minggu posting gaji (kumulatif, benar per bulan) vs distribusi ulang per hari | tetap kumulatif; catatan tile menjelaskan | Finance |
| O20 | C58: supply tanpa kelas (O2 satu harga) dihitung untuk semua kelas proporsional, atau diabaikan? | diabaikan + C58 menyebut "n kg tanpa kelas" | PPIC + Purchasing |

---

## 7. Checklist eksekusi untuk Claude Code

Aturan: kerjakan **berurutan**, centang satu per satu, jangan membuka item irisan berikutnya sebelum item "BERHENTI" irisan berjalan selesai. Setiap "jalankan" disertai output di deskripsi PR. Bila sebuah item tidak bisa dipenuhi, tulis alasannya di QUESTIONS sebagai Q-v5.1-n dan **tanya**, jangan memilih sendiri.

### Sebelum mulai
- [ ] `git fetch && git log -1 origin/main` = `67c7f03`. Bila bukan, berhenti: perbarui analisis dampak PRD v5.1 Bab 3 (file:baris) dulu.
- [ ] Node ≥ 20, pnpm 10.28.0, Postgres 16 lokal, Docker untuk PostgREST. `SUPABASE_DB_URL` menunjuk DB lokal, bukan `pczjhmzpkknzkziipvit` atau `uxqbtverhnpiryhzbenr`.
- [ ] `pnpm install && pnpm test && pnpm typecheck && pnpm parity && pnpm snapshot:diff && pnpm test:rls` hijau pada 67c7f03. Simpan output sebagai baseline di `docs/v5.1/baseline.txt`.

### Irisan 0 — `v5.1/0-docs`
- [ ] Simpan dokumen ini ke `docs/PRD-v5.1.md` tanpa mengubah isinya.
- [ ] Tambahkan baris pertama di `docs/PRD-v5.md`: "Diamendemen oleh docs/PRD-v5.1.md sejak 17 Okt 2026; lihat Bab 1.3."
- [ ] `docs/v5/QUESTIONS.md`: tambah O15–O20 (Bab 6); ubah Q-v5-54 (K38), Q-v5-36 (label "menyimpang dari §4.6, O16"), Q-v5-43 (O15), Q-v5-50 (O17), Q-v5-56 (O18).
- [ ] `docs/v5/SUMMARY.md`: tambah bagian "Belum terpenuhi (PRD v5.1 §3.11)" dan catatan K53 di bagian Flag; turunkan klaim G13/journey K–P menjadi "lulus pada fixture dengan role Admin".
- [ ] PR `v5.1/0: PRD v5.1, QUESTIONS, SUMMARY`. Tidak ada perubahan kode.
- [ ] **BERHENTI — sign-off pemilik.**

### Irisan 1 — `v5.1/1-release-access`
- [ ] Buat `supabase/migrations/20261024000100_v51_release.sql`: `base_key()` (R5); `create or replace function release_week` dengan K44 (R1), K45 (R2), K47 (R3); `tg_needs_rebuild` ke 5 tabel (R13). Semua `if not exists` / `create or replace`; tidak ada drop/rename.
- [ ] Buat `supabase/migrations/20261024000200_v51_security.sql`: `tg_commitment_guard`, `tg_surplus_response_guard` memakai `base_key` (R5); `tg_sales_line_scope` (R7); view `commercial_daily_sales_v5` dengan `sales_sees_cost` (R8) — cek dulu daftar kolom tidak berubah; bila berubah, `_v51`.
- [ ] Jalankan kedua migrasi **dua kali** di DB lokal; kedua kali lolos. Simpan output di `docs/v5.1/bukti/irisan-1-migrasi-rerun.txt`.
- [ ] `supabase/tests/rls_roles.sql`: blok v5.1 untuk R1, R2, R3, R5, R7, R8, R13 (skenario Bab 3 "Bukti"). `pnpm test:rls` hijau.
- [ ] `packages/engine/src/costing.ts:603` dan semua perbandingan ISO string (R4) → `Date.parse`. Tes unit.
- [ ] `apps/web/app/minggu-ini/[week]/page.tsx` guard role (R6). Tes layar.
- [ ] `apps/web/lib/release.ts`: pre-check K45 dan C53 (R2, R3); `buildInputDay`/grid tanpa `release_week` (R1).
- [ ] `apps/web/lib/v5/input-save.ts` filter `existing` (R7); `.ilike` → `.eq` lower (R9).
- [ ] Perbarui `docs/v5/kgr-os-migrasi-v4-v5-sekaligus.sql`? **Tidak.** Buat file baru `docs/v5.1/kgr-os-migrasi-v51.sql` berisi dua migrasi v5.1 disambung dengan sha256 di kepala dan tabel cek di akhir, pola yang sama.
- [ ] `pnpm test && pnpm typecheck && pnpm parity && pnpm snapshot:diff && pnpm test:rls` hijau.
- [ ] Uji PostgREST Bab 5.1–5.2: journey P dengan `finance@t` (T8: lulus tanpa override; satu sel merah → ditolak; grid kosong → ditolak K45). Bukti `docs/v5.1/journey-P.md`.
- [ ] PR `v5.1/1: K35 tanpa sel rilis, C53 memblokir rilis, akses Manajemen, assignment base_key, K32 di RLS`. Deskripsi: tabel R → bukti; output rerun migrasi; `pnpm snapshot:diff`.
- [ ] **BERHENTI — sign-off pemilik. Migrasi ke KGR-OS dijalankan manusia setelah sign-off.**

### Irisan 2 — `v5.1/2-clock-rebuild`
- [ ] Buat `apps/web/lib/clock.ts` (`clock(sb)` → `{ data, wall, now }`; `KGR_TEST_NOW` hanya `NODE_ENV=test`). Pindahkan isi `dataToday` ke sini; `lib/data.ts` mengekspor ulang untuk kompatibilitas.
- [ ] Ganti semua pemakaian `dataToday(`/`jakartaNow()` di `apps/web/lib/v5/*` dan `apps/web/app/**` dengan `clock()` (R10). `rg "jakartaNow\(\)|dataToday\(" apps/web/lib/v5 apps/web/app` = 0 di luar `clock.ts`.
- [ ] `management-data.ts`: `cutDate = addDays(wall, 1)`; label ganda bila `data ≠ wall`. Jendela tugas/grid/Status putaran/`loadSources` disamakan (R10).
- [ ] RPC `advance_update_date` (R11) → **butuh migrasi**: tambahkan ke `20261024000300_v51_params.sql` (file baru irisan ini, catat di SUMMARY). Panggil setelah commit `gl_daily`, `stock_daily`, `costing_wp` (v5) dan jurnal/stok (wizard v4).
- [ ] `queueThrough` (R12) menggantikan `queueRebuild` di semua pemanggil v5; batas 62 hari.
- [ ] `must()`/`LoaderError`/`TileData` (R25); ubah semua loader v5 dan `week-pl.ts`, `lib/data.ts:53`. Lint K41 = 0 hit di luar `clock.ts`.
- [ ] `inChunks` (R26); `fetchAll` menggantikan `.limit(≥1000)` (R27). Lint K42 = 0.
- [ ] Tes: `clock.test.ts`; tes layar Manajemen `data=2026-08-27, wall=2026-10-17` → form `date=2026-10-18`; tes loader dengan mock `error` → tile `state: error`.
- [ ] `pnpm test && pnpm typecheck && pnpm parity && pnpm snapshot:diff && pnpm test:rls` hijau.
- [ ] Uji PostgREST: upload WP batch 26 Agu dengan jam `2026-08-27` → `lot.cost_status` 27 Agu berubah; Komersial menampilkan biaya baru (journey O langkah terakhir, T10).
- [ ] PR `v5.1/2: satu jam data (K38–K40), error tidak ditelan (K41), batas baris (K42)`.
- [ ] **BERHENTI — sign-off pemilik.**

### Irisan 3 — `v5.1/3-costing-pl`
- [ ] `allocateBatch` null + `canBeFinal` (R17) **dengan opsi** agar jalur v1 tidak berubah; `pnpm snapshot:diff` kosong sebelum lanjut.
- [ ] Ledger: lot `canBeFinal=false` tidak pernah 'final' (R17); `lib/v5/costing.ts` tanpa fallback `"0"` (R18).
- [ ] `pl-v5.ts` K51 (R19); `pl-2026-08` golden tetap (jalankan `pl-v5.test.ts` sebelum dan sesudah).
- [ ] `lib/v3/cash.ts` K52 (R20); Outlook bulan `.gt("accounts",0)` (R21); payload mart kolom v5 selalu ada (R22); `cost_pool_pi` batch Aktual (R23).
- [ ] RPC `lock_commitments` (R14) → migrasi `20261024000300_v51_params.sql` (tambah kolom `price_list_week.price_frozen_source`); action memanggil RPC; form kolom harga frozen; `commitmentDemand` versi tertinggi; R15, R16.
- [ ] Tes unit per R (Bab 3 "Bukti"); tes RLS `lock_commitments` gagal-semua.
- [ ] `pnpm test && pnpm typecheck && pnpm parity && pnpm snapshot:diff && pnpm test:rls` hijau; B.1–B.5 tetap dalam toleransi.
- [ ] Uji PostgREST: journey L langkah Commercial ↔ PPIC dengan `lead@t`, `sales@t` (assignment SKU), `ppic@t`: komitmen (draft sales → kunci lead, versi 2 dengan alasan), surplus → jawaban. Bukti `docs/v5.1/journey-L.md`.
- [ ] PR `v5.1/3: missing ≠ 0 di costing dan P&L (K50–K52), kunci komitmen satu transaksi (K46)`.
- [ ] **BERHENTI — sign-off pemilik.**

### Irisan 4 — `v5.1/4-flags-ui`
- [ ] `k25On` dan `isModuleOn` per role di semua pembaca (R28); Status putaran "modul belum aktif".
- [ ] PPIC: C57 memblokir, C58 dengan alasan, form alasan di v5 (R29); headline/label kelas (R30); `sizeCode` kunci (R31).
- [ ] Upload: `upNum` (R32); O15 `po_unsized_mode` (R33) — golden `upload-samples/expected.json` berubah: tulis diff per baris di CHANGELOG; WP konsistensi (R34).
- [ ] UI: nav id (R35); teks status tanpa ikon/warna (R36); c-kas tanpa afiliasi (R37); §6.5 kartu dan akurasi (R38); status biaya K20 di Manajemen dan t-batch (R39); R40 (env fail-fast, tileBox, soft-delete admin, `since`, cache `run`).
- [ ] Tes layar 8 kombinasi flag × 3 role (Bab 5.4) sebagai `apps/web/lib/v5/flags-matrix.test.tsx`.
- [ ] `pnpm test && pnpm typecheck && pnpm parity && pnpm snapshot:diff && pnpm test:rls` hijau.
- [ ] Uji PostgREST: journey K (management, catat posisi "Perlu keputusan" dalam px, **tanpa** klaim above-fold), M (`opsdir@t`), N (`sales@t`), O (`costacc@t`); kombinasi flag (8) dengan `sales@t` → tidak ada kolom biaya v5. Bukti `docs/v5.1/journey-K-M-N-O.md`, screenshot 1366×768.
- [ ] Perbarui `docs/v5/SUMMARY.md`: status T7–T12; daftar 3.11 yang masih terbuka; O15–O20 default yang dipakai.
- [ ] PR `v5.1/4: flag per role (K53–K55), C57/C58 PPIC, upload 0.xxx dan O15, UI §5.1/§6.5/K20`.
- [ ] **BERHENTI — sign-off pemilik.**

### Larangan sepanjang v5.1
- [ ] Tidak menyentuh `computeWeek`, golden v1, paritas, snapshot (opsi baru harus default ke perilaku lama).
- [ ] Tidak drop/rename; migrasi hanya di file baru `202610240001..03`.
- [ ] Tidak SQL ke KGR-OS; tidak menyalakan flag di production; tidak merge.
- [ ] Tidak memfinalkan O1–O20; tidak menambah whitelist K41 tanpa bertanya.
- [ ] Tidak mengubah tata letak Manajemen (O17) dan grid (O18) sebelum pemilik memutuskan.
- [ ] Tidak menulis "lulus" untuk gate/journey yang hanya diuji pada fixture atau sebagai Admin; sebut lingkungan dan role di setiap klaim.
