# PRD v5.2-A — Kode: putaran tersambung, gagal-tertutup, dashboard = FS (bagian kode/GitHub)

Status: Draft untuk review pemilik produk, lalu handoff ke agen coding · Owner: Dika (Group Project Finance, SAMB) · Tanggal: 17 Okt 2026 (WIB)
Repo: `dikagustiana/KGR-Weekly-Outlook` · **Basis: `main` `cb76753`** (merge PR #36) · Supabase aplikasi: KGR-OS `pczjhmzpkknzkziipvit` (**tidak disentuh dokumen ini**) · Vercel `kgr-weekly-outlook`
Pasangan: **PRD v5.2-B — Database** (`docs/PRD-v5.2-B-db.md`). Sumber temuan: `docs/v5.2/REVIEW-v5.1.md` (A-*/B-* di kolom "Temuan").

Dokumen ini **mengamendemen** PRD v5 dan v5.1, tidak menggantikannya. Semua pasal keduanya tetap berlaku kecuali yang disebut di Bab 1.3.

**Cara baca untuk agen coding.**
- Bab 1 (keputusan) mengikat. Butir berstatus *usulan* belum boleh difinalkan.
- Bab 3 berisi requirement R41–R79 lengkap dengan lokasi `file:baris` pada `cb76753`, spesifikasi, dan bukti yang diminta.
- Bab 4 membagi R ke tujuh irisan berurutan: satu branch dan satu PR per irisan. **Berhenti di akhir tiap irisan untuk sign-off.**
- Bab 7 adalah checklist yang wajib diikuti urutannya.

**Batas dokumen ini:** hanya kode di GitHub, yaitu `packages/**`, `apps/**`, `tests/**`, `scripts/**`, `.github/**`, `fixtures/**`, `docs/**`.
- **Dilarang** mengubah `supabase/**`: migrasi, seed, `rls_roles.sql`, shim.
- **Dilarang** menjalankan SQL ke KGR-OS atau project Supabase mana pun.
- **Dilarang** mengubah env Vercel atau flag production.

Bila sebuah R ternyata butuh kolom, tabel, policy, atau RPC baru:
1. Berhenti.
2. Tulis Q-v5.2-n.
3. Rujuk R yang sesuai di PRD v5.2-B.

R yang bergantung pada objek DB baru ditandai **⛓ B-Rnn**. R itu baru boleh di-merge sesudah migrasi B-Rnn ada di `main` **dan** diterapkan di KGR-OS (Bab 4, aturan urutan merge).

Konvensi angka: sama dengan PRD v5 (titik ribuan, koma desimal, "jt", minus U+2212).

---

## 0. Ringkasan masalah

Review 17 Okt (`REVIEW-v5.1.md`) menemukan 46 temuan pasti dan 22 dugaan. Dari 29 temuan audit v5, 17 masih terbuka. Masalah di sisi kode:

1. **Kegagalan masih bisa membuka jalan.**
   - Bacaan flag yang gagal mematikan K25 dan C53 (A-UI-1).
   - Bacaan rilis yang gagal dianggap tidak ketat dan tidak basi (A-UI-4).
   - Builder ledger menelan error (A-UI-8).
   - Lint K41 hanya menyisir dua folder (A-UI-16).
2. **Putaran mingguan putus di kode.**
   - Komitmen terkunci > PO mematikan halaman Rencana v5 (A-UI-2/F02).
   - Batch masih dibuat dari rencana STD v4 dan jalur salin lama tanpa C57/C58 (A-UI-3).
   - Demand kelas memakai kg bruto (A-UI-9).
   - Kebutuhan STD lolos dari C58 (A-UI-10).
   - Persetujuan downgrade tidak bisa diberikan di v5 (A-UI-12).
   - Aksi Commercial tidak menyegarkan tugas (A-UI-6).
3. **Biaya dan laba rugi tampak final atau lengkap padahal belum.**
   - Faktur tie dianggap final (A-CST-2).
   - SKU tanpa harga acuan dihitung Rp0 (A-CST-3).
   - Yield atau tarif kosong dihitung 0 (A-CST-7).
   - Beban tetap hilang di bulan sesudah jadwal (A-CST-1).
   - Kas dibangun sebelum P&L bulan (A-CST-5).
4. **Rebuild tidak tahan banting dan tidak berjalan sendiri.**
   - Baris `running` macet (A-UI-7).
   - Tidak ada job harian.
   - Production punya 49 antrean yang tidak pernah diproses (A-LIVE-4).
5. **Dashboard belum bisa dibuktikan sama dengan FS.**
   - Tidak ada kontrol rekonsiliasi.
   - "Selisih costing" bercampur ke kolom jurnal (A-CST-4).
6. **Bukti tidak sebanding dengan klaim.**
   - Journey tidak ada di repo atau CI.
   - Matriks flag hanya 3 role.
   - T7 belum pernah dijalankan berurutan.

**Tujuan v5.2-A:** semua jalur kode gagal-tertutup; satu putaran mingguan lengkap berjalan di CI dengan 8 role; angka FINAL Agustus dan September dapat direkonsiliasi ke FS lewat kontrol C59. computeWeek, golden v1, paritas, dan snapshot tidak berubah.

---

## 1. Keputusan

### 1.1 Dipertahankan

K1–K55, O1–O20 (dengan default di `docs/v5/QUESTIONS.md`), dan aturan keras PRD v4 §11.4, v5 §12, v5.1 Bab 7 tetap berlaku, kecuali yang diubah di 1.2.

### 1.2 Keputusan baru

"Ditetapkan" = berlaku untuk v5.2. "Default" = dipakai sampai pemiliknya mengubah. "Usulan" = dibangun di belakang parameter dan **tidak boleh difinalkan implementasi**. Semua butir di bawah perlu tanda tangan pemilik saat review PRD; sebelum itu statusnya rancangan.

| # | Keputusan | Isi | Status usulan |
|---|---|---|---|
| K56 | Gagal-tertutup | Bacaan yang gagal tidak pernah membuat kontrol lebih longgar, modul lebih sedikit, atau angka lebih kecil. Pengecualian hanya `42P01` (tabel belum ada) untuk modul yang memang belum dimigrasi, dan selalu dengan `console.error`. Lint K41 berlaku di seluruh `apps/web/**` dan dijalankan CI | ditetapkan |
| K57 | Skema tertinggal = satu pesan | Error `42703`, `42883`, `PGRST202`, `PGRST204`, `42P01` pada objek yang diharapkan diklasifikasikan sebagai "skema DB tertinggal". Header aplikasi menampilkan satu banner ("Skema database belum diperbarui ke vX; hubungi Admin"). Rebuild, rilis, dan aksi tulis yang menyentuh objek itu ditolak dengan pesan yang sama. Sesudah B-R82 tersedia, app membandingkan `schema_version()` dengan konstanta `EXPECTED_SCHEMA` | ditetapkan |
| K58 | Satu gate salin | `copyPlanToBatches` sendiri yang memeriksa C42/C45/C46/C47/C57/C58 dan persetujuan downgrade. Semua action salin (v4 dan v5) melewatinya. Tidak ada jalur salin yang bisa memotong gate | ditetapkan |
| K59 | Final hanya dari alokasi | `cost_status = 'final'` hanya bila `allocation_run` posted untuk batch itu **dan** setiap baris alokasi punya harga acuan. `invoice_status = 'tied'` adalah syarat posting, bukan status final | ditetapkan |
| K60 | Builder berurutan menurut dependensi | `registerBuilder` menerima `after: string[]`. Urutan run dihitung topologis, tidak bergantung urutan import. Kas sesudah bulan v4 dan tutup buku | ditetapkan |
| K61 | Antrean berjalan sendiri | Route `GET /api/cron/rebuild` (dilindungi `CRON_SECRET`) menguras antrean dalam batas waktu, mereset `running` > 15 menit, dan membangun instance tugas/grid hari jam dinding. Dijadwalkan lewat `vercel.json` `crons`. Action tetap memproses inline maksimal N tanggal; sisanya diserahkan ke cron | ditetapkan |
| K62 | FS sebagai acuan terpisah | Rekonsiliasi membandingkan angka app (FINAL, neraca akhir bulan, saldo bank) dengan baris FS yang diimpor (⛓ B-R86). FS tidak pernah menggantikan angka app; selisih ditampilkan, bukan ditutup | usulan (O25) |
| K63 | Kolom jurnal = jurnal | Kolom "Actual · jurnal" hanya berisi baris jurnal dan penyesuaian tutup buku. "Selisih costing" dan "Biaya kapasitas idle" tampil sebagai baris memo di bawah NIBT jurnal, dengan "NIBT manajemen" terpisah. Dibangun di belakang `app_setting` key `v5_pl`, field `costing_rows_mode` (`'memo'` \| `'cogs'`, default `'cogs'` = perilaku sekarang; tanpa kolom DB baru) sampai O24 diputuskan | usulan (O24) |
| K64 | Bukti = repo | Journey dan matriks flag adalah kode di `tests/e2e/`, dijalankan job CI `e2e`. Klaim "lulus" hanya merujuk artifact CI atau log dengan lingkungan dan role | ditetapkan |

### 1.3 Pasal yang diubah atau dicabut

| Dokumen | Pasal | Diubah menjadi |
|---|---|---|
| PRD v5.1 | K41 lint (hanya `lib/v4`, `lib/v5`) | K56: seluruh `apps/web/**`, CI |
| QUESTIONS | Q-v5.1-16 | dicabut, diganti K56 |
| QUESTIONS | Q-v5.1-17 | diganti R59 (baris K29 keluar hanya bila semua jadwalnya belum mulai) |
| QUESTIONS | Q-v5.1-18 (akibat ledger) | diganti R61 |
| PRD v5 | K20 "final bila faktur tie" | K59 |
| PRD v5.1 | Q-v5.1-24 (C57 hanya di action v5) | K58 |
| `docs/v5/SUMMARY.md` | T7, T8, T11 "lulus …" | diturunkan menjadi "lulus per langkah di PostgreSQL lokal + shim; belum satu putaran; belum Supabase" |

---

## 2. Tujuan terukur

| ID | Tujuan | Ukuran penerimaan |
|---|---|---|
| T13 | Gagal-tertutup | `scripts/lint-k41.sh` dan `scripts/lint-k42.sh` = 0 hit di `apps/web/**` di luar whitelist (Bab 5.3), dijalankan CI. Tes injeksi error untuk `moduleSettings`, `releaseContext`, `loadLedgerSources`, dan `kas-data`: hasilnya state error atau penolakan, tidak pernah lolos atau kosong |
| T14 | T7 utuh di CI | `tests/e2e/journey-T7` menjalankan 9 langkah berurutan (§6.2 brief) dengan 8 user non-admin di stack lokal: PG16 + migrasi + PostgREST v12 + mock auth + `next start` + `faketime`. Hasil: 0 respons 4xx/5xx tak terduga, rilis Finance berhasil tanpa override, dan angka batch hasil salin = rencana kelas tersimpan. Job CI `e2e` hijau dengan artifact log dan screenshot |
| T15 | Dashboard = FS (kode siap) | Fungsi engine `fsRecon` + kontrol C59 + halaman Rekonsiliasi lulus golden `fixtures/fs-recon-2026-08` dan `-09` dengan 0 selisih > Rp 1 pada baris yang dipetakan. Fixture dibangun dari FS dan rinciannya. Bukti di production adalah T19 di PRD B |
| T16 | Putaran tanpa jalan buntu | Tes layar dan e2e mencakup: komitmen > PO (minggu komitmen dibuka di Rencana), approval downgrade di v5, alasan C58, C57 menahan semua jalur salin, kunci → tugas K35 hijau tanpa rebuild manual |
| T17 | Biaya jujur | Probe review (F04, K50 M1, yield kosong, jadwal hanya September) menjadi tes unit dan semuanya lulus. Golden v1, B.1–B.5 tetap |
| T18 | Engine dan snapshot tetap | `pnpm parity` 17.161/17.161, `pnpm snapshot:diff` kosong (sama dengan T12) |

---

## 3. Requirement (R)

Format: **R-n [kategori] (temuan)** · Lokasi pada `cb76753` · Spesifikasi · Bukti. Path relatif ke repo. `W` = `apps/web`, `E` = `packages/engine/src`.

### 3.1 Gagal-tertutup dan skema (irisan A1)

**R41 [keamanan] (A-UI-1)** · `W/lib/modules.ts:15-16`.
Spesifikasi (K56):
- `moduleSettings` melempar `LoaderError("moduleSettings", …)` bila `error`.
- Hanya `error.code === "42P01"` yang boleh mengembalikan `{}`, dengan `console.error`.
- Halaman yang memanggilnya menampilkan halaman error aplikasi (bukan layar v1).
- `releaseWeek` dan rebuild menolak bila setting gagal dibaca.

Bukti: tes unit dengan mock `error` → throw. Tes layar Outlook: setting gagal → tidak ada teks "REKOMENDASI RPA"/"TUNDA".

**R42 [keamanan] (A-UI-4, A-REL-11)** · `W/lib/release.ts:16-27,39`; `W/lib/v3/stale.ts:11-13`.
Spesifikasi: keempat bacaan `releaseContext`, bacaan grid K35, dan bacaan `rebuild_queue` di `stale.ts` memakai `must`/`mustRows`. Tidak ada `?? []` sesudah query.
Bukti: tes `release.test.ts`: error pada grid → rilis ditolak dengan pesan error PostgREST, bukan pesan K45. Error pada flag → ditolak.

**R43 [K41] (A-UI-8, A-UI-16, A-CST-9)** · Daftar minimum (semua dibaca ulang saat mulai):
- `W/lib/v3/ledger.ts:55,58,59,62,300`
- `W/lib/v3/planning.ts:109`
- `W/lib/v5/costing.ts:188-191`
- `W/lib/v4/kas-data.ts:17-21,37`
- `W/lib/v4/month.ts:93,119,261,268`
- `W/lib/v3/cash.ts:181`
- `W/lib/v3/costing.ts:66,211`
- `W/app/komersial/actions-v5.ts:33,87`
- `W/app/w/[week]/rencana/actions.ts:44`
- `W/lib/session.ts:19`
- `W/app/input/page.tsx` (bacaan `weight_class`)

Spesifikasi (K56):
- Semua bacaan memakai `must`/`mustRows`.
- `.catch(() => [])` hanya untuk `42P01` lewat helper `orMissingTable(res, where)`.
- `scripts/lint-k41.sh` menyisir `apps/web/**/*.ts{,x}` (tanpa `*.test.*`) untuk pola:
  - `const \{ data(: \w+)? \} = await` tanpa `error` pada destrukturisasi yang sama;
  - `catch \(\) \{`;
  - `\.catch\(\(\) =>`;
  - `data \?\? \[\]\)`;
  - `return \{\}` di dalam `if \(error`.

Bukti: lint = 0 di luar whitelist (Bab 5.3). Hasil lint dan jumlah perbaikan per file dicantumkan di deskripsi PR.

**R44 [DB/deploy] (A-UI-5, A-LIVE-2)** · baru: `W/lib/schema.ts`; `W/lib/loader.ts` (`LoaderError`); `W/components/v4/*` (header).
Spesifikasi (K57):
- `classifySchemaError(err)` mengenali kode `42703`, `42883`, `42P01`, `PGRST202`, `PGRST204` beserta nama objek.
- `LoaderError` membawa `schema: true`.
- Layout membaca hasil `schemaStatus()` yang di-cache per request:
  - **sebelum ⛓ B-R82:** probe ringan = select 0 baris dari `price_list_week.deleted_at` dan `parameter.po_unsized_mode`;
  - **sesudah:** `rpc('schema_version')` dibandingkan dengan `EXPECTED_SCHEMA` di `W/lib/schema.ts`.
- Banner tampil satu kali di header.
- `processRebuildQueue`, `releaseWeek`, dan action tulis menolak lebih awal dengan pesan banner.
- Jangan menambah objek DB di PR ini; pemakaian `schema_version` masuk PR terpisah sesudah B-R82.

Bukti: tes unit klasifikasi. Tes layar: probe gagal `42703` → banner dan tile tetap error per tile.

**R45 [DB/ketahanan] (A-UI-7, A-CST-5, B-UI-1)** · `W/lib/rebuild.ts:15-48,94-114`; `W/lib/rebuild-registry.ts`.
Spesifikasi (K60, K61):
1. `registerBuilder({ name, module, after?: string[] })`; urutan topologis, siklus = error saat start. Wajib: `v3/cash` after `v4/month`, `v4/close`.
2. Setiap `update` `rebuild_queue` dicek errornya.
3. Pada awal `processRebuildQueue`, baris `running` dengan `started_at < now() − 15 menit` dikembalikan ke `queued` dengan catatan.
4. Pemrosesan inline dari action dibatasi `REBUILD_INLINE_MAX` tanggal (default 7); sisanya dibiarkan `queued` dengan pesan "dilanjutkan otomatis".
5. Tanggal > `clock().wall + 7` di antrean tidak dibangun dan ditandai `done` dengan catatan "di luar jendela".

Bukti:
- tes urutan: registrasi terbalik → urutan tetap benar;
- tes "rebuild satu tanggal dua kali → `solvency_monthly` identik" (F19);
- tes reset `running`.

**R46 [DB/cron] (K61, §8 butir 6 review)** · baru: `W/app/api/cron/rebuild/route.ts`; `W/vercel.json`.
Spesifikasi:
- `GET` dengan header `Authorization: Bearer ${CRON_SECRET}`; tanpa itu → 401.
- Isi route:
  - `processRebuildQueue` dengan batas jumlah tanggal dan anggaran waktu. Signature sekarang `processRebuildQueue(settings, limit = 62)` (`W/lib/rebuild.ts:90`) diubah menjadi `processRebuildQueue(settings, { limit, budgetMs })`; untuk cron `{ limit: 30, budgetMs: 50_000 }`. Semua pemanggil ikut diubah;
  - membangun instance `input_task` dan grid untuk `clock().wall` (`buildInputDay`);
  - mengembalikan JSON ringkas.
- `export const maxDuration = 60`.
- `vercel.json` menambah `"crons": [{ "path": "/api/cron/rebuild", "schedule": "0 22 * * *" }]` (05.00 WIB).
- Bila pemilik memakai plan dengan cron lebih rapat, jadwal menjadi parameter (O30).
- `CRON_SECRET` diisi manusia di Vercel (PRD B, B-R80).

Bukti: tes route (401 tanpa secret; mock service memproses dua tanggal). README bagian "Operasi".

**R47 [K42] (A-UI-17, B-UI-3)** · `W/lib/data.ts:25-37`; semua pemanggil `fetchAll`; `.in()` tanpa chunk, antara lain:
- `W/app/sku/[key]/page.tsx:36-37`
- `W/lib/v5/input-save.ts:93,131,162`
- `W/lib/v3/costing.ts`
- `W/lib/v3/planning.ts`
- `W/app/komersial/approval/page.tsx:22`

Spesifikasi:
- `fetchAll(build, { orderBy: string[] })` **wajib** urutan unik (default `id`). Pemanggil tanpa `order` → lint gagal.
- Semua `.in()` dengan array dinamis lewat `inChunks(…, 200)`.
- `.limit(n)` + `.range()` dihapus.
- `scripts/lint-k42.sh`: `\.limit\(` di luar `maybeSingle`/`limit(1)`, `\.in\("[a-z_]+", [a-z]` tanpa `inChunks`, dan `fetchAll\(` tanpa `.order(` di builder yang sama.

Bukti: lint = 0. Tes `data.test.ts` dengan 2.450 baris mock (3 halaman) tanpa duplikat. E2E volume (R73).

### 3.2 Putaran Commercial → PPIC → batch (irisan A2)

**R48 [bug] (A-UI-2, F02)** · `W/lib/v3/planning.ts:117`; `W/lib/v5/ppic-data.ts:44-54`; `E/commercial-v5.ts`.
Spesifikasi:
- Tipe `PoLine` menambah `synthetic: boolean` dan `size_kg` dari komitmen.
- `id` baris sintetis tidak dipakai untuk query.
- `loadClassDemand` mengambil `size_kg` hanya untuk `!synthetic`.
- Komitmen membawa `size_kg` sendiri.

Bukti:
- tes loader dengan komitmen terkunci 300 kg > PO 100 kg → demand kelas berisi 200 kg tambahan, tanpa query `sales_line` untuk ID sintetis;
- langkah e2e T7 membuka Rencana minggu komitmen.

**R49 [bug] (A-UI-9, F03)** · `W/lib/v5/ppic-data.ts:42-70`; `E/ppic-class.ts:86-88,224`.
Spesifikasi: demand kelas = kg **terbuka berbobot** per tanggal × ukuran × kelas:
- `(kg − fulfilled_kg − cancelled_kg) × bobot(status)`, dengan `tentative_weight`, `forecast_weight` dari `parameter`;
- ditambah forecast (`forecast_line`) sebagai baris STD per tanggal;
- netting stok sesudahnya;
- `netShareOf` tidak lagi dikalikan dengan kg bruto.

Bukti: probe review `DEMAND_tentative_70pct` → 70; `DEMAND_confirmed_fulfilled60` → 40; forecast-only → kebutuhan > 0. Golden B.3 tetap (semua Confirmed, belum terpenuhi).

**R50 [bug] (A-UI-10, F11, O20)** · `E/ppic-class.ts:151-165,219-221`.
Spesifikasi:
- `needByCutDate` memasukkan STD sebagai kelas tersendiri.
- C58 menilai supply per kelas; supply tanpa kelas memakai default O20 ("diabaikan").
- Pesan C58 menyebut "n kg tanpa kelas" bila ada.
- Bendera kualitas ukuran (`unsized`) terpisah dari kebutuhan.

Bukti: probe `C58_UNSIZED` → C58 PERIKSA. Golden `plan-2026-08-24` tetap.

**R51 [PRD] (A-UI-3, F06, K58)** · `W/app/w/[week]/rencana/actions.ts:43,58-90`; `W/lib/v3/planning.ts:408-449`; `W/lib/v5/ppic-data.ts` (`copyBlockersOf`).
Spesifikasi:
- `copyPlanToBatches(sb, plan, ctx)` memanggil `copyGate(ctx)` sebelum menulis apa pun. Gate ini mencakup:
  - C42, C45, C46, C47;
  - C57 untuk setiap tanggal potong yang akan dibuat;
  - C58 kecuali alasan sah terikat **versi rencana**;
  - persetujuan downgrade.
- `copyPlanAction` (v4) dan `copyClassPlanAction` (v5) sama-sama melewati fungsi itu; UI membaca hasil `copyGate` yang sama.
- Harga LB batch = keputusan kelas spesifik → keputusan semua kelas → tidak ada (C57). Provenance dicatat di `batch.lb_price_source`. Kolom ini **belum ada** di `cb76753` maupun KGR-OS (dicek 17 Okt), jadi bagian provenance menunggu ⛓ B-R85. Tanpa kolom itu, gate dan harga tetap dikerjakan; provenance ditulis ke `batch.source`/catatan action **tidak** boleh (kolom itu punya arti lain).

Bukti: tes action: v4 copy tanpa keputusan LB saat `v5_costing` hidup → ditolak C57. Tes UI dan action memberi blocker identik.

**R52 [PRD] (A-UI-3, F01, K27 tahap 1)** · `W/app/w/[week]/rencana/actions.ts:43-51` (termasuk pencarian "versi terbaru" di :44); `W/lib/v5/ppic-data.ts:225` (`planWeekClassRows`); `W/lib/v3/planning.ts:354-374` (`savePlan`), `:409` (`copyPlanToBatches`).
Spesifikasi (tahap 1, tanpa skema baru):
- `saveClassPlanAction` menyimpan header, `plan_day`, dan `plan_week_class` dalam urutan tetap dengan ID hasil insert (tanpa "cari versi terbaru").
- `copyPlanToBatches` membaca `plan_week_class.detail` versi itu untuk ekor per kelas dan kg per tanggal. Yield = yield kelas (fallback STD berlabel).
- Pola dan fresh/frozen per SKU (K27 penuh) **tidak** di irisan ini: menunggu O33 dan ⛓ B-R85 (transaksi RPC `save_class_plan`).

Bukti: tes "angka batch hasil salin = `plan_week_class` tersimpan" (kelas K/S/B, dua tanggal). Langkah T7.

**R53 [UI] (A-UI-12, F27)** · `W/app/w/[week]/rencana/v5.tsx:15,36-49`.
Spesifikasi:
- Render `ActionForm approvePlanAction` untuk admin dan finance bila rencana butuh persetujuan.
- `reasonAction` untuk C58 sudah ada (`rencana/v5.tsx:48-53`); pertahankan, dan pastikan alasan terikat versi rencana (R51). C57 tetap tanpa alasan.
- Status persetujuan tampil sebagai teks.

Bukti: tes layar per role (ppic: form alasan; finance: form setuju; sales: tidak ada).

**R54 [bug] (A-UI-6, F18)** · `W/app/komersial/actions-v5.ts` (simpan, kunci, jawab surplus); `W/lib/v5/input-save.ts:67-70`.
Spesifikasi: setiap action meng-queue **tanggal jatuh tempo tugas terdampak** lewat fungsi baru `dueDatesFor(rule, anchor)` di `E/input-tasks.ts`, yang dibangun di atas `parseDueRule` dan `dueOf(rule, anchor)` yang sudah ada (`E/input-tasks.ts:27-48`):
- `commitment_lock` → Jumat sebelum minggu komitmen;
- WP → `due_date` H+1;
- surplus → tanggal rencana.

Sesudah itu action memanggil `processRebuildQueue` (inline, R45).
Bukti: tes action: kunci komitmen → antrean memuat tanggal Jumat. E2E T7 langkah 2 → sel K35 `commitment_lock` hijau tanpa "Perbarui status tugas".

**R55 [bug] (A-CST-8)** · `W/components/v5/CommitmentForm.tsx:24-30`; `W/app/komersial/actions-v5.ts:27-37`.
Spesifikasi:
- Form mengirim hanya baris yang berubah (bandingkan dengan nilai awal).
- Action menulis semua draft dalam **satu** `insert`/`upsert` array (atomik di PostgREST).
- Baris terkunci yang tidak berubah tidak menghasilkan versi baru.

Bukti: tes action: lead mengubah 1 dari 5 SKU terkunci → tepat 1 versi baru.

**R56 [bug] (A-UI-20)** · `W/app/komersial/actions-v5.ts:92`.
Spesifikasi: key jawaban surplus diambil dari field form (key SKU baris surplus), divalidasi terhadap daftar surplus rencana.
Bukti: tes action key `Trading|BLP|Frozen`.

**R57 [bug] (A-UI-21)** · `W/lib/v5/lb-decision.ts:24-27`.
Spesifikasi: pakai `queueThroughNote`. Keputusan yang tersimpan selalu dilaporkan tersimpan, dengan catatan rebuild bila antrean ditolak batas 62 hari.

**R58 [bug] (A-UI-11, F05-B; B-REL-1)** · `E/upload-validate.ts:382-426`; `W/lib/v5/input-save.ts:93-94,127-132`; `W/lib/v5/po-lines.ts:13-15`.
Spesifikasi:
- C22 dihitung atas output yang **akan disimpan** (baris lolos + output lama yang dipertahankan).
- Untuk role sales, `existing` disaring dengan key assignment (`base_key`) **dan** pelanggan.
- Seluruh commit satu batch atau satu PO berjalan sesudah validasi penuh: tulis baru → soft-delete "gone" hanya bila tulis sukses.

Bukti: probe `WP_HELD_MASS` → GAGAL C22. Tes PO Sales: baris rep lain tidak disentuh.

### 3.3 Costing dan laba rugi (irisan A3)

**R59 [PRD] (A-CST-1, F12)** · `E/pl-v5.ts:47-52,93-98,205-207`.
Spesifikasi:
- Baris K29 dikeluarkan dari bulan m hanya bila **semua** baris jadwal aktifnya `start_date > akhir bulan m` (belum mulai).
- Baris yang jadwalnya sudah berakhir atau berlaku di bulan lain kembali ke FINAL terakhir → "belum ada".
- C55 PERIKSA menyebut baris yang memakai FINAL atau "belum ada".

Bukti:
- tes "jadwal hanya September → Oktober: gaji/penyusutan/bunga dari FINAL September, C55 PERIKSA";
- tes "sewa mulai November → Oktober tanpa sewa";
- golden B.2 tetap (−87,0 jt).

**R60 [PRD] (A-CST-2, F04, K59)** · `E/costing.ts:347-348`; `W/lib/v5/input-save.ts:212-218`; `W/lib/v5/costing.ts:98-158`; `W/lib/v3/ledger.ts:90-94,214`.
Spesifikasi:
- `costStatusOf`: `final` hanya bila `allocationPosted && allPriced`. `invoiceStatus === "tied"` tanpa posting → `sementara` (bila WP ada) dengan `costCheck = "faktur tie, alokasi belum diposting"`.
- Action upload faktur yang tie mengantrekan posting M1 (`postWeek`) atau menampilkan langkah "Posting alokasi".
- Ledger memakai biaya v5 sampai final.

Bukti: probe `TIED_NO_POSTED` → `sementara`, `costByKey` terisi, `finalDate` null. Sesudah posting → `final` + revaluasi.

**R61 [PRD] (A-CST-3, K50 di M1)** · `W/lib/v3/costing.ts:117,123,200-213`; `E/costing.ts:232-250`; `W/lib/v3/ledger.ts:65-94`.
Spesifikasi:
- Builder M1 memanggil `allocateBatch(…, { nullMissing: true })` untuk **menilai** `canBeFinal`. Nilai `allocation_line.cost_per_kg` tetap 0 karena NOT NULL; ini tidak diubah di sini.
- `postWeek` menolak posting batch dengan `canBeFinal=false` (pesan menyebut SKU), kecuali override Finance tercatat sebagai issue.
- Ledger: `allocation_line.price_ref` null → lot memakai biaya v5 dan status `sementara`, dengan `cost_check` "harga acuan kosong: <key>" di layar.
- Sumber harga `canBeFinal` v5 = sumber M1 (`price_ref` WP → `sku_price`).

Bukti: probe Lemak tanpa harga → posting ditolak. Snapshot v1 kosong.

**R62 [missing ≠ 0] (A-CST-7)** · `W/lib/v5/costing.ts:140-150`.
Spesifikasi:
- Yield, tarif, atau maklon null → `result: null`, `costCheck` "yield/tarif belum diisi: …".
- C54 PERIKSA dan C42 BELUM DIISI untuk batch itu.
- Tidak ada `?? "0"`.

Bukti: probe "yield kosong" → C54 PERIKSA, `canBeFinal=false`.

**R63 [PRD] (F17)** · `W/lib/v5/costing.ts:69-95,113-127`; `batch.weight_class` (`m1_costing.sql:8`).
Spesifikasi:
- Loader membaca `batch.weight_class`.
- Yield efektif = yield kelas/pola → fallback STD (label "yield STD dipakai").
- Keputusan LB = kelas spesifik → semua kelas.

Bukti: probe `CLASS_PRICE` → biaya pool Rp2,0 jt (bukan Rp2,6 jt).

**R64 [missing ≠ 0] (A-CST-10, A-CST-11, A-CST-12, A-CST-13, A-UI-15)** · Lokasi:
- `W/lib/v5/pl-tiles.ts:193-195`
- `W/lib/v4/outlook-bulan-data.ts:115,117,143`
- `W/lib/v4/close.ts:217`
- `W/lib/v5/komersial-data.ts:64-65,73,80`
- `W/lib/v5/management-data.ts:108`
- `W/lib/v4/minggu-ini-data.ts:56,101`
- `W/lib/v4/kas-data.ts:41`
- `W/lib/v4/month.ts:143`
- `W/lib/v3/ledger.ts:105,323`
- `W/lib/v3/commercial.ts:66`
- `W/lib/v3/cash.ts:108,147-153`
- `W/app/komersial/actions-v5.ts:32`

Spesifikasi:
- Setiap `?? 0`/`?? "0"`/`|| 0` pada uang, kg, atau tarif → null + teks "belum ada"/"belum diisi", atau kontrol.
- Grafik NIBT setelah beban tetap tanpa titik bila `fixedAllMissing`.
- Akurasi menulis "belum ada".
- `over_age_kg` untuk Sales/Manajemen = null + "tidak ditampilkan untuk Sales" (view agregat ⛓ B-R85 opsional).
- `scripts/lint-missing.sh` menangkap `\?\? ?"?0"?[,)]` di `lib/**` dan `app/**` dengan whitelist bernama.

Bukti: lint = 0. Tes per lokasi.

**R65 [PRD] (F13 sisa)** · `W/lib/v3/cash.ts:109`.
Spesifikasi: proyeksi 12 bulan memakai NIBT setelah beban tetap saat `v5_pl` hidup. Beban nonkas (penyusutan, amortisasi prepaid) dikeluarkan dari arus kas, dengan rekonsiliasi eksplisit di tile.
Bukti: tes fixture Agustus.

**R66 [PRD/FS] (A-CST-4, O24)** · `E/costing.ts:593-607`; `E/monthly.ts:29-30`; `W/lib/v4/month.ts:149`; `W/lib/v4/week-pl.ts:21-22`; `W/lib/v5/pl-tiles.ts:39`.
Spesifikasi (K63, usulan):
- Mode dibaca dari `app_setting` key `v5_pl`, field `costing_rows_mode` (kolom `parameter` untuk ini tidak ada dan tidak ditambah); tanpa nilai = `'cogs'`.
- Mode `'memo'`: `isCogsLine` mengecualikan kedua baris v5; `plTable` menambah blok memo "Selisih costing", "Biaya kapasitas idle", "NIBT manajemen".
- C49 tetap pada basis jurnal.

Bukti: tes kedua mode. Golden B.2 tetap di mode `'cogs'`.

**R67 [PRD] (F14, Q-v5-25)** · `W/lib/v4/month.ts:109-147`; `W/lib/v4/week-pl.ts:21-22`.
Spesifikasi:
- Adapter forecast v5: biaya/kg order forecast = `planCost` kelas tanggal order bila `v5_costing` dan `v5_pl` hidup.
- Fallback: biaya MA dengan label.
- `computeWeek` tidak disentuh.

Bukti: golden baru `fixtures/pl-v5-lbprice` (harga LB naik Rp1.000/kg → GP forecast turun sesuai). Golden v1 tetap.

### 3.4 Rekonsiliasi FS (irisan A4)

**R68 [FS] (T15, O25–O27)** · baru: `E/fs-recon.ts`, `E/test/fs-recon.test.ts`, `fixtures/fs-recon-2026-08/`, `fixtures/fs-recon-2026-09/`.
Spesifikasi: fungsi murni `fsRecon({ app, fs, map, tolerance })`.
- Input:
  - `app` = angka app per baris (PL FINAL bulan, neraca akhir bulan, saldo bank);
  - `fs` = baris FS `{statement, line, row_no, amount}`;
  - `map` = pasangan baris app ↔ baris FS.
- Keluaran per baris: `selisih`, status `sama | beda | tidak ada di app | tidak ada di FS`.
- Kontrol **C59**: GAGAL bila ada `beda` dengan |selisih| > toleransi (default Rp 1, O26).
- Pemetaan minimum:
  - PL Management Report b.12 Revenue, b.13 COGS (tanpa baris v5 bila mode `'memo'`), b.15 GP, b.37, b.49, b.51 NIBT;
  - BS b.14 Kas, b.17–18, b.23–24 Persediaan, b.47–48, b.51, b.77 Ekuitas.
- Nomor baris diverifikasi ke `fixtures/fs-2026-09/inputs.json` (`pl[].row`, `bs[].row`; berkas asalnya tercatat di `source.json`), bukan ditebak.
- Fixture `fs-recon-2026-08/09` dibangun dari `fixtures/fs-2026-09/inputs.json` + angka app hasil `computeMonthV4`/close pada data fixture.
- Bila data fixture Agustus/September belum lengkap, fixture memuat **selisih yang diharapkan beserta sebabnya**. Itu bukan kegagalan: tulis tabelnya.

Bukti: tes engine. Tabel rekonsiliasi per baris di `docs/v5.2/fs-recon-fixture.md`.

**R69 [FS/UI] (T15) ⛓ B-R86** · baru: `W/lib/v5/fs-recon-data.ts`, `W/app/m/[month]/rekonsiliasi/page.tsx`; `W/lib/v4/close.ts:81-104` (`finalizeMonthV4`); tile akurasi Outlook bulan.
Spesifikasi:
- Loader membaca `fs_statement_line` (B-R86) dan pemetaan `fs_line_map` (B-R86).
- Halaman per bulan: tabel app vs FS vs selisih + sebab (`data belum ada` / `definisi` / `selisih`).
- `finalizeMonthV4` menilai C59; GAGAL menahan kunci FINAL kecuali override Finance (policy ⛓ B-R86).
- Akses: admin, finance, management.

Bukti: tes layar dengan mock. E2E: impor FS fixture → C59 LULUS pada data fixture lengkap.

### 3.5 Bukti di repo (irisan A5)

**R70 [verifikasi] (K64, §6.2 brief, A-UI-18)** · baru: `tests/e2e/` (dari `skrip-uji-lokal.zip`).
Isi:
- `stack/up.sh`: shim + migrasi dua kali + seed + users + PostgREST v12 via docker `--network host`;
- `stack/mock-supa.mjs`, `keys.mjs`, `clock.sh` (faketime);
- `sql/users.sql`: 8 role (finance, commercial_lead, sales ber-assignment, ppic, operations_director, cost_accounting, inventory_accounting, purchasing) + management;
- `sql/setup-*.sql`;
- `journey-{P,L,KMNO,O2,O5}.cjs`, `matrix.cjs`, `run.sh`.

Spesifikasi:
- Semua path dari env.
- Tidak ada langkah Admin selain rebuild awal.
- Setiap SETUP yang menulis langsung ke tabel diberi label `setup` dan dicatat di log (bukan "alur").

Bukti: `pnpm e2e` lokal hijau. Log memuat lingkungan, role, dan status HTTP per request.

**R71 [verifikasi] (T14)** · baru: `tests/e2e/journey-T7.cjs`, `tests/e2e/sql/week-complete.sql`.
Spesifikasi: satu putaran berurutan dengan jam `faketime` yang maju per langkah:
1. Sales draft komitmen.
2. Kepala Sales kunci (Jumat 16.00).
3. PPIC rencana per kelas → simpan → salin.
4. Direktur Operasional putuskan harga LB.
5. Cost Accounting upload WP (H+1 11.00).
6. Cost Accounting faktur + posting.
7. Komersial menampilkan biaya baru.
8. Grid K35 hijau.
9. Finance rilis.

Data "semua input terisi" dibangun oleh `week-complete.sql` **lewat jalur upload** bila tersedia. Total Accurate diisi agar C8/C9 lulus dengan `v4_release` hidup.
Bukti: log dan screenshot per langkah. Rilis tanpa override dengan `v4_release` **hidup**.

**R72 [verifikasi] (A-UI-18, T11)** · `W/lib/v5/flags-matrix.test.tsx:37,51-52`; `tests/e2e/matrix.cjs`.
Spesifikasi:
- Matriks 8 kombinasi flag × 10 role, dengan tabel ekspektasi tertulis (`tests/e2e/matrix-expect.json`: halaman → boleh/404, kolom biaya terlihat/tidak).
- Tes tautologis dihapus.
- Pemeriksaan API untuk Sales: `commercial_daily_sales_v5`/v4 tanpa `cost_per_kg_ma`/`price_floor` saat `sales_sees_cost=false` (⛓ B-R83); `plan_week_class` ditolak (⛓ B-R83).

Bukti: job CI `e2e`.

**R73 [K42] (B-UI-3)** · baru: `tests/e2e/sql/volume.sql`.
Spesifikasi: 26 minggu data sintetis (> 1.000 baris di `sales_line`, `gl_line`, `lot_balance_daily`, `pl_daily_v4`), PostgREST `db-max-rows=1000`. Angka total dibandingkan dengan SQL agregat langsung.
Bukti: log `volume.log` 0 selisih.

**R74 [CI]** · `.github/workflows/ci.yml`.
Spesifikasi:
- Job `lint`: K41, K42, missing.
- Job `e2e` (ubuntu-24.04):
  1. `postgresql-16` + `faketime`;
  2. `pnpm install`;
  3. `next build`;
  4. `tests/e2e/run.sh`;
  5. artifact log + PNG.
- `test:rls` tetap job sendiri dengan jam asli.
- Ketergantungan `cdn.sheetjs.com`: tambahkan cache pnpm store; bila diblokir, catat di README.

Bukti: CI hijau pada PR irisan A5.

### 3.6 UI (irisan A6)

**R75 [UI] (A-UI-13, F23)** · `W/components/v4/TilePage.tsx:99`; `W/app/v4.css:162-170`; `W/lib/v5/pl-tiles.ts:230`; `W/lib/v5/management.ts:148-195`.
Spesifikasi: tile diurutkan `(y, x)` sebelum render. Tile v5 punya posisi y sesuai §6.1.
Bukti: screenshot 899 px dan 390 px dari e2e.

**R76 [UI] (A-UI-14, F26)** · `W/lib/v5/management-data.ts:123-202`.
Spesifikasi:
- Label sumber disaring per periode angka (minggu atau bulan yang dibuka) dan per sumber yang benar-benar dipakai:
  - simulasi = PO + yield + harga LB;
  - biaya = WP/faktur.
- Late dihitung dari tugas sumber itu.

Bukti: tes layar minggu Agustus dengan upload Oktober → label Agustus.

**R77 [UI] (A-UI-19, Q-v5.1-25) — menunggu O23.** · `W/lib/v4/nav.ts:67,87`.
Default sampai O23 diputuskan: tautan wizard v4 dipindah ke panel Input Finance; nav Finance 7 item.

**R78 [UI] (A-UI-22)** · `W/components/v5/UploadPanel.tsx:44-45,68`.
Spesifikasi: `.xls` dibaca lewat SheetJS (`xlsx` sudah dependency). Bila versi 0.20.3 belum disetujui (Q-v5-42), hapus `.xls` dari `accept` dan tulis "simpan sebagai .xlsx".

**R79 [ketahanan kecil] (B-UI-6, B-REL-8, B-REL-9)** ·
- `E/upload-validate.ts` (`upNum`): angka bergaya Inggris "1,234" → **fail** "format ribuan ambigu".
- `W/lib/release.ts`: bangun ulang grid minggu itu sebelum pre-check K35.
- `W/app/minggu-ini/[week]/page.tsx:20-22`: guard role sebelum `weekContext`.

### 3.7 Tidak dikerjakan di v5.2-A

- K27 pola potong dan fresh/frozen per SKU (tahap 2; O33, ⛓ B-R85).
- Tren revenue/GP per minggu dan tile demand per kelas §6.1.
- Form parameter O8.
- Bacaan parsial §8 (Q-v5-49).
- Editor `size_class_map`.
- Grafik utang afiliasi vs ekuitas dan neraca ringkas §4.8.
- Tugas jawab surplus dan konsumsinya.
- O17 (tata letak K) dan O18 (grid).

Semua dicatat di SUMMARY sebagai "belum terpenuhi".

---

## 4. Irisan pengiriman

Satu branch, satu PR per irisan, urutan wajib. Setiap irisan menjalankan `pnpm test`, `pnpm typecheck`, `pnpm parity`, `pnpm snapshot:diff` (kosong), `pnpm test:rls`, dan lint (mulai A1). Mulai A5, `pnpm e2e` juga.

| Irisan | Branch | R | ⛓ PRD B | Selesai bila |
|---|---|---|---|---|
| A0 | `v5.2/a0-docs` | dokumen | — | `docs/PRD-v5.2-A-kode.md`, `docs/PRD-v5.2-B-db.md`, `docs/v5.2/REVIEW-v5.1.md` di-commit apa adanya; QUESTIONS: O21–O33 + koreksi Q-v5.1-16/17/18/24; SUMMARY: klaim T7/T8/T11 diturunkan (1.3) |
| A1 | `v5.2/a1-fail-closed` | R41–R47 | R44 tahap 2 sesudah B-R82 (PR kecil terpisah `v5.2/a1b-schema-version`) | T13; tes F19 |
| A2 | `v5.2/a2-loop` | R48–R58 | R51 provenance dan R52 tahap 2 → B-R85 (bila diperlukan) | T16 (tes unit dan layar) |
| A3 | `v5.2/a3-costing-pl` | R59–R67 | — | T17, T18 |
| A4 | `v5.2/a4-fs-recon` | R68; R69 sesudah B-R86 | B-R86 | T15 (fixture) |
| A5 | `v5.2/a5-e2e-ci` | R70–R74 | R72 bagian API sesudah B-R83 | T14; CI `e2e` hijau |
| A6 | `v5.2/a6-ui` | R75–R79 | — | screenshot 1366/899/390 |

**Aturan urutan merge (berlaku untuk A dan B):**
1. Vercel men-deploy `main` otomatis (A-LIVE-1). Karena itu PR kode yang memakai objek DB baru **hanya boleh di-merge sesudah**:
   - (a) PR migrasinya (PRD B) ada di `main`;
   - (b) bundelnya diterapkan di KGR-OS;
   - (c) tabel cek bundel semuanya true.
2. PR kode yang tidak memakai objek baru boleh di-merge kapan saja sesudah sign-off.
3. `scripts/check-query-columns.py` di CI menolak kode yang merujuk objek yang belum ada di `supabase/migrations`. Ini penjaga otomatis untuk butir 1(a), **bukan** untuk butir 1(b).

---

## 5. Pengujian

### 5.1 Lingkungan

PostgreSQL 16 lokal + shim + semua migrasi + PostgREST v12 + mock auth + `next build && next start` + `faketime` (`tests/e2e`). Ini bukan Supabase. Uji di Supabase sungguhan adalah T19/T20 di PRD B.

### 5.2 Data

- Fixture minggu 24–30 Agu.
- `week-complete.sql` (R71) untuk "semua input terisi".
- `volume.sql` (R73).
- Fixture FS Agustus/September (R68).

### 5.3 Whitelist K41/K56

- `W/lib/clock.ts` (fallback jam dinding + `console.error`).
- `orMissingTable` untuk kode `42P01`.

Penambahan lain = pertanyaan ke pemilik.

### 5.4 Kombinasi flag

Delapan kombinasi PRD v5.1 §5.4 × 10 role (R72). Tambahan:
- (9) `v4_release` hidup + `v5_input` mati + `v5_costing` hidup: C53 menahan rilis;
- (10) `v5_*` dengan `roles: ["admin"]`: pengguna lain melihat layar v4 tanpa angka v5.

### 5.5 Journey

T7 (R71) dan K, L, M, N, O, P (R70) di CI. Klaim di SUMMARY menyebut lingkungan "PG16 lokal + PostgREST + mock auth" dan role.

---

## 6. Pertanyaan terbuka (dibangun di belakang parameter; tidak difinalkan implementasi)

Rekomendasi = pendapat peninjau, bukan keputusan. Pertanyaan yang perubahannya di DB ada di PRD B Bab 6 dengan nomor yang sama.

| # | Pertanyaan | Pilihan | Rekomendasi | Pemilik |
|---|---|---|---|---|
| O21 | Assignment `…\|Fresh` ikut mencakup `…\|Frozen` (Q-v5.1-3)? | (a) ya, seperti sekarang; (b) persis: `base_key` hanya untuk assignment tanpa akhiran | **(b)**: K32 per SKU. Assignment tanpa akhiran tetap mencakup keduanya. Perubahan di DB (B-R83) | Kepala Sales |
| O22 | C53 BELUM DIISI menahan rilis hanya di mode ketat (Q-v5.1-2)? | (a) hanya ketat; (b) selalu saat `v5_costing` hidup | **(b)**: K47 tidak menyebut mode; production ketat juga. Perubahan di DB (B-R84) | Finance |
| O23 | Nav Finance 8 item (Q-v5.1-25) | (a) batas 8 untuk Finance; (b) Upload masuk panel Input | **(b)** (R77) | Pemilik produk |
| O24 | Selisih costing dan biaya idle di P&L | (a) di COGS seperti sekarang; (b) baris memo di bawah NIBT jurnal + "NIBT manajemen" | **(b)**: kolom "jurnal" harus = FS (R66) | Finance |
| O25 | FS diimpor sebagai acuan, atau app menghitung sendiri lalu dibandingkan | (a) impor saja; (b) hitung saja; (c) keduanya: impor acuan, app menghitung, C59 membandingkan | **(c)** (K62) | Finance |
| O26 | Toleransi C59 | ±Rp 1 / ±Rp 1.000 / % | **±Rp 1** untuk total, sama dengan C49 | Finance |
| O27 | Tingkat detail rekonsiliasi dan bulan sebelum Agustus | (a) baris Management Report; (b) per akun TB; (c) sampai rincian FA/prepaid/AR/AP/stok | **(a) dulu, lalu (b)**. Sebelum Agustus di luar cakupan; saldo awal = TB 31 Jul | Finance |
| O28 | Rilis sebelum semua hari minggu itu punya sel K35 | (a) boleh; (b) wajib sel s.d. `min(ws+6, wall−1)`; rilis lebih awal butuh override | **(b)** (B-R84) | Finance |
| O29 | Flag v5 di production selama v5.2 | (a) semua hidup untuk semua role (sekarang); (b) `v5_*` `roles: ["admin"]` sampai T19 lulus | **(b)** (PRD B, B-R80) | Pemilik produk |
| O30 | Jadwal cron | harian 05.00 WIB / tiap jam | harian dulu (batas plan Vercel); antrean juga diproses inline | Pemilik produk |
| O31 | `lock_commitments` dengan harga berbeda per ukuran pada key yang sama | (a) tolak; (b) rata-rata tertimbang kg; (c) harga ukuran terbesar | **(a)** (B-R83) | Kepala Sales |
| O32 | C55 ditegakkan di `release_month` V1 (DB) | (a) hanya app (K47); (b) DB | **(b)** (B-R84) | Finance |
| O33 | K27 tahap 2: pola potong dan fresh/frozen per SKU di rencana | (a) di v5.2; (b) PRD berikutnya | **(b)**: selesaikan putaran STD/kelas dulu (R52) | PPIC |

Keputusan lama yang masih terbuka, dengan rekomendasi:
- **O15:** tetap `warn`.
- **O16:** kurangi komitmen terkunci yang belum tertutup PO, sesuai §4.6.
- **O17:** default laba rugi collapsed di ≤ 768 px.
- **O18:** terima `minmax`, amandemen v4 §5.3.
- **O19:** catatan tile.
- **O20:** "n kg tanpa kelas" (R50).
- **O13:** tulis pengecualian 88,2% dan tutup tes `todo`.

---

## 7. Checklist eksekusi untuk agen coding

Aturan:
- Kerjakan berurutan dan centang satu per satu.
- Jangan membuka irisan berikutnya sebelum "BERHENTI" irisan berjalan selesai.
- Setiap "jalankan" disertai output di deskripsi PR.
- Bila sebuah item tidak bisa dipenuhi, atau butuh objek DB: tulis Q-v5.2-n dan **tanya**.

### Sebelum mulai
- [ ] `git log -1 origin/main` = `cb76753`. Bila berbeda, berhenti: perbarui `file:baris` Bab 3 dulu.
- [ ] Node ≥ 20, pnpm 10.28.0, PG16 lokal, Docker. `DATABASE_URL` ke DB lokal, **bukan** `pczjhmzpkknzkziipvit` atau `uxqbtverhnpiryhzbenr`.
- [ ] Baseline `pnpm install && pnpm test && pnpm typecheck && pnpm parity && pnpm snapshot:diff && pnpm test:rls` → `docs/v5.2/baseline.txt`.

### Irisan A0 — `v5.2/a0-docs`
- [ ] Commit `docs/PRD-v5.2-A-kode.md`, `docs/PRD-v5.2-B-db.md`, `docs/v5.2/REVIEW-v5.1.md` tanpa mengubah isi.
- [ ] Baris pertama `docs/PRD-v5.1.md`: "Diamendemen oleh docs/PRD-v5.2-A-kode.md dan -B-db.md sejak <tanggal sign-off>; lihat Bab 1.3."
- [ ] QUESTIONS: O21–O33 (Bab 6); koreksi Q-v5.1-16, 17, 18, 24.
- [ ] SUMMARY: turunkan klaim T7/T8/T11; tambah "Belum terpenuhi v5.2" (3.7).
- [ ] PR tanpa kode. **BERHENTI — sign-off.**

### Irisan A1 — `v5.2/a1-fail-closed`
- [ ] R41, R42, R43 (`must`, `orMissingTable`, lint K41 seluruh `apps/web`).
- [ ] R44 tahap 1 (klasifikasi error + probe + banner); **tanpa** `schema_version`.
- [ ] R45 (dependensi builder, error update, reset `running`, batas inline, tanggal di luar jendela).
- [ ] R46 (route cron + `vercel.json` crons). Tulis di deskripsi PR: "manusia mengisi `CRON_SECRET` di Vercel Production (PRD B, B-R80) sebelum merge".
- [ ] R47 (`fetchAll` berurutan, `inChunks`, lint K42).
- [ ] `scripts/lint-k41.sh`, `lint-k42.sh` + job CI `lint`.
- [ ] Semua gate hijau. Tes F19 dan injeksi error.
- [ ] PR `v5.2/a1: gagal-tertutup (K56–K57), builder berurutan dan cron (K60–K61), batas baris`. **BERHENTI — sign-off.**
- [ ] (Sesudah B-R82 diterapkan di KGR-OS) PR kecil `v5.2/a1b-schema-version`: R44 tahap 2. **BERHENTI.**

### Irisan A2 — `v5.2/a2-loop`
- [ ] R48 (ID sintetis), R49 (demand terbuka berbobot + forecast), R50 (STD di C58).
- [ ] R51 (satu gate salin; v4 dan v5). Provenance `batch.lb_price_source` ditunda ke B-R85 (kolom belum ada); tulis Q-v5.2 yang memintanya.
- [ ] R52 tahap 1, R53, R54, R55, R56, R57, R58.
- [ ] Golden B.3/B.4 tetap; tes probe review.
- [ ] PR `v5.2/a2: putaran Commercial → PPIC → batch tanpa jalan buntu`. **BERHENTI — sign-off.**

### Irisan A3 — `v5.2/a3-costing-pl`
- [ ] R59 (jalankan `pl-v5.test.ts` sebelum dan sesudah; B.2 tetap).
- [ ] R60, R61 (`pnpm snapshot:diff` kosong sebelum lanjut), R62, R63.
- [ ] R64 + `scripts/lint-missing.sh` di job `lint`.
- [ ] R65, R66 (mode default `'cogs'`), R67 (golden v5 baru; golden v1 tetap).
- [ ] PR `v5.2/a3: biaya final hanya dari alokasi (K59), beban tetap per bulan, missing ≠ 0`. **BERHENTI — sign-off.**

### Irisan A4 — `v5.2/a4-fs-recon`
- [ ] R68: `fsRecon` + C59 + fixture Agustus/September + `docs/v5.2/fs-recon-fixture.md` (nomor baris FS dicek ke `fixtures/fs-2026-09/inputs.json`).
- [ ] R69 hanya bila B-R86 sudah di `main` **dan** di KGR-OS; bila belum, PR berisi R68 saja.
- [ ] PR `v5.2/a4: rekonsiliasi dashboard ↔ FS (C59)`. **BERHENTI — sign-off.**

### Irisan A5 — `v5.2/a5-e2e-ci`
- [ ] R70 (pindah skrip ke `tests/e2e`, 8 role + management).
- [ ] R71 (`journey-T7`, `week-complete.sql`, `v4_release` hidup).
- [ ] R72 (matriks 10 role + ekspektasi tertulis; bagian API sesudah B-R83).
- [ ] R73 (volume), R74 (CI `e2e`).
- [ ] SUMMARY: status T13–T18 dengan lingkungan dan role.
- [ ] PR `v5.2/a5: journey dan matriks di repo dan CI (K64)`. **BERHENTI — sign-off.**

### Irisan A6 — `v5.2/a6-ui`
- [ ] R75, R76, R77 (sesuai O23 atau default), R78, R79.
- [ ] Screenshot 1366×768, 899 px, 390 px untuk Minggu ini, Komersial, Rencana, Input, Outlook bulan, Kas.
- [ ] PR `v5.2/a6: urutan mobile, label sumber, nav, .xls`. **BERHENTI — sign-off.**

### Larangan sepanjang v5.2-A
- [ ] Tidak mengubah `supabase/**` (migrasi, seed, tes RLS, shim): itu PRD B.
- [ ] Tidak menjalankan SQL ke Supabase mana pun. Tidak mengubah env Vercel atau flag. Tidak merge sendiri.
- [ ] Tidak menyentuh `computeWeek`, golden v1, paritas, snapshot; opsi baru default ke perilaku lama.
- [ ] Tidak memfinalkan O1–O33; tidak menambah whitelist K56 tanpa bertanya.
- [ ] Tidak mengubah tata letak Manajemen (O17) atau grid (O18).
- [ ] Tidak menulis "lulus" tanpa lingkungan dan role. "PG16 lokal + shim" bukan "Supabase".
