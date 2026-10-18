# v5.2 A1c — kode memakai objek DB B5 dan menutup bacaan Sales atas rencana (cabang `v5.2/a1c-db-objects`)

Tanggal: 18 Okt 2026 (WIB) · Dasar: `docs/v5.2/b5.md` Bab 5 (cara pakai untuk A2 dan A3), `docs/v5.2/a2.md` (Q-v5.2-20…22), `docs/v5.2/a3.md` (Q-v5.2-30), `docs/v5/QUESTIONS.md` Q-v5.2-12, -15, -20…22, -30, -61, -67 · Basis kode: `origin/main` `b408a9a` (sudah memuat A1, A1b, A2, A3, A4, B2, B5; KGR-OS di skema 5.2.4 sejak 18 Okt) · Cabang menyentuh `apps/**`, `packages/engine/src/ppic-class.ts` (+ tesnya) dan `docs/v5.2/**`. Tidak menyentuh `computeWeek`, golden v1, paritas, snapshot, `fixtures/`, `supabase/**`.

**Status: siap sign-off.** Lima butir selesai; butir 5 (migrasi penutup) ada di cabang terpisah `v5.2/b6-sales-plan-read` (`docs/v5.2/b6.md`). Tidak ada koneksi ke project Supabase atau Vercel; bukti DB dari PostgreSQL 16.15 lokal (dan PostgREST v12.2.3 lokal untuk jalur Sales), bukan Supabase. **Urutan production: kode ini dulu, bundel B6 sesudahnya** (Bab 5).

## 1. Hasil dan gate

Lingkungan: Node v22.22.0, pnpm 10.28.0, PostgreSQL 16.15 lokal (socket `/tmp`, user `postgres`; DB baru `a1c_rls`, `a1c_rls_b6`, `a1c_pg_b5`, `a1c_pg_b6`) + shim, tanpa Docker, tanpa Supabase. `xlsx` diganti sementara ke npm 0.18.5 untuk `pnpm install` (tidak di-commit; CI memakai 0.20.3). Semua dijalankan dari `/home/user/wt-a1c`, exit code dicek satu per satu (tanpa `pnpm -s`, tanpa `| tail` yang menyembunyikan exit).

| Gate | Hasil |
|---|---|
| `pnpm typecheck` | exit 0 (engine, parsers, web) |
| `pnpm test` | exit 0: engine **466** (460 + 6), parsers **27**, web **516** (474 + 42); tidak ada tes `todo` |
| `pnpm parity` | exit 0, **17161/17161**; `git diff --exit-code -- docs/parity.md docs/parity-cells.csv` exit 0 |
| `pnpm snapshot:diff` | exit 0, **kosong**, byte-identik |
| `bash scripts/test-lint.sh` | exit 0: k41 bad 7 / good 0, k42 bad 6 / good 0, missing bad 11 / good 0 |
| `python3 -I scripts/lint.py k41` / `k42` / `missing` | exit 0: **0 / 0 / 0** hit |
| `DATABASE_URL=postgresql://postgres@/a1c_rls?host=/tmp pnpm test:rls` | exit 0, `test:rls OK`: 46 blok, 0 `(!)`, `check-query-columns: 233 files, 0 unknown table/column/rpc`; `schema_version()` 5.2.4 |
| `test:rls` dengan migrasi B6 disalin ke salinan scratch dari HEAD cabang ini (`git archive HEAD`, ditambah `20261025000600_v52_sales_plan.sql` dan `rls_roles.sql` dari cabang B6) | exit 0, `test:rls OK`: **47** blok (blok B6 termasuk), 0 `(!)`, `check-query-columns: 232 files, 0 unknown` (kolom dan view yang dibaca kode ada di skema 5.2.5) |
| Jalur baca Sales ke PostgREST sungguhan, skema 5.2.4 dan 5.2.5 | `docs/v5.2/bukti/a1c-sales-postgrest.txt`: `SEMUA OK` di keduanya (Bab 2 butir 4) |

Golden: B.3, B.4, B.5 dan `plan-2026-08-24` tidak berubah (tes golden engine lulus tanpa diubah; `packages/engine/src` hanya `ppic-class.ts`, penambahan di `splitClassPlan` yang tanpa `detail` berperilaku sama seperti sebelumnya; snapshot byte-identik, paritas sama).

Batas bukti: tes web memakai klien Supabase tiruan (`lib/fake-sb.ts`) atau yang di memori (`test-support/mem-sb.ts`: tanpa RLS, trigger, constraint). Yang dijawab database dibuktikan `test:rls` (blok B5 untuk kolom dan RPC; blok B6 untuk Sales) dan bukti PostgREST di atas, bukan tes web.

## 2. Per butir

`W/` = `apps/web/`, `E/` = `packages/engine/src/`. Lokasi `file:baris` pada HEAD cabang.

### 1. `EXPECTED_SCHEMA` = "5.2.4"
- `W/lib/schema.ts:19`: konstanta `"5.2.4"`, dengan komentar yang menyebut objek B5 yang dipakai kode. Pesan banner dan tolak-awal (K57) memakai konstanta itu.
- Tes: `W/lib/fail-closed.test.ts:82-91`: DB 5.2.2 dan 5.2.3 mendapat banner `Skema database belum diperbarui ke v5.2.4; hubungi Admin (DB v5.2.x)`; 5.2.4, 5.2.5, 5.10.0 dan 6.0.0 tidak; konstanta dikunci `"5.2.4"`.

### 2. R61: override Finance lewat RPC (Q-v5.2-30, -61)
- `W/lib/v3/costing.ts:212` `draftsOf`: draft per run dibagi `ready` (semua SKU ber-kg punya harga acuan) dan `held` (ada SKU ber-kg tanpa harga, null atau 0), aturan yang sama dengan RPC (`kg > 0 and coalesce(price_ref,0) = 0`).
- `:226` `postWeek` (Admin, Cost Accounting): memposting `ready` dengan dua tulisan seperti sebelumnya; `held` tidak diposting dan disebut (batch dan SKU). Bila yang ada hanya `held`, ditolak dengan pesan lama ("harga acuan kosong — … override Finance/Admin dengan alasan"). Tidak ada jalur override di sini.
- `:253` `postWeekOverride(sb, viewer, week, reason)` (hanya `admin` dan `finance`): alasan di-trim, ≥ 10 karakter; hanya run `held` yang dikirim: `:261` `sb.rpc("post_allocation_override", { p_run_ids, p_reason })`. Galat RPC dilempar sebagai `WriteError(error.message)`, kata demi kata (K41). Jumlah kembalian harus sama dengan jumlah id, kalau tidak galat. Tanpa run `held`: ditolak sebelum RPC ("alokasi berharga lengkap diposting dengan posting biasa").
- `W/app/w/[week]/input/costing/actions.ts:50` `postOverride`: peran `["admin", "finance"]` (sebelumnya hanya `admin`). Pesan "menunggu B-R85" dihapus di semua tempat.
- Halaman: `W/app/w/[week]/input/costing/page.tsx:31-41`: terbuka untuk Finance (sebelumnya 404); Finance melihat tampilan ringkas (kontrol C21–C24, kartu "Posting ditahan" dengan form alasan) dan tombol Posting hanya menghitung draft berharga lengkap. `W/app/w/[week]/costing/page.tsx:61`: kartu bertaut untuk Finance dan Admin bila ada run tertahan.
- Tes: `W/lib/v5/costing-k59.test.tsx` blok R61 dan "R61 override" (9 tes): Finance dan Admin memanggil RPC dengan `p_run_ids: ["r1"]` dan alasan yang diketik (alasan di-trim) tanpa `allocation_run:update` atau `batch:update`; minggu campuran hanya mengirim run yang tertahan (harga 0 dan null sama-sama tertahan); Cost Accounting dan tujuh peran lain ditolak sebelum RPC; alasan pendek ditolak; minggu tanpa run tertahan ditolak sebelum RPC; galat DB tampil apa adanya; hitungan yang tidak cocok ditolak. `W/lib/v5/costing-override-action.test.ts` (5 tes, lewat aksi `post` dan `postOverride` dengan peran): Finance dan Admin lewat RPC, Cost Accounting dan peran lain ditolak aksi, Finance tidak punya posting biasa, run lengkap diposting biasa tanpa RPC dan run tertahan dilaporkan, hanya run tertahan ditolak tanpa tulisan.

### 3. A2 memakai kolom B5 (Q-v5.2-20…22)
**C58 terikat versi (`plan_check_reason.plan_week_id`)**
- `W/app/w/[week]/rencana/actions.ts:120` `reasonAction`: untuk C58 versi = rencana tersimpan terakhir (`plan_week`, `deleted_at` null, `version` tertinggi); alasan basi (terikat versi lain, atau tanpa versi dan ditulis sebelum versi terakhir) ditarik lebih dulu (indeks lama `(week_start, code)` masih aktif, Q-v5.2-62); alasan yang masih sah → "Alasan untuk kontrol ini sudah ada" tanpa tulis; `:145` insert membawa `plan_week_id` (tanpa rencana: dikosongkan; kode selain C58 tidak terikat).
- `W/lib/v5/copy-plan.ts:74` `reasonsFor`: alasan C58 ber-`plan_week_id` sah hanya untuk versi itu (rencana yang disalin), seberapa pun waktunya; tanpa `plan_week_id` tetap dinilai lewat waktu (sah bila ditulis sesudah versi tersimpan; tanpa stempel selalu sah); kode lain tidak berubah. `W/lib/v3/planning.ts:153` membaca kolom itu (select `code, reason, created_at, plan_week_id`).

**`plan_week_class.detail`**
- `W/lib/v5/ppic-data.ts:246` `planWeekClassRows(planId, demand, daily)`: tiap baris kelas membawa `detail` = `[{cut_date, heads, kg_lb}]`, pembagian `splitClassPlan` atas baris yang sama dan kebutuhan harian (`needByCutDate`); kelas tanpa kebutuhan harian: `detail` null (ditahan saat salin seperti sebelumnya). Dipanggil `W/app/w/[week]/rencana/actions.ts:51` `saveClassPlanAction`.
- `E/ppic-class.ts:273` `splitClassPlan`: baris ber-`detail` memakai detail itu apa adanya (tidak peduli demand hari ini); baris tanpa `detail` (null atau tidak ada) memakai profil demand seperti sebelumnya. `:247` `cutsOfDetail`: detail sah bila array tak kosong, tiap entri `{cut_date tanggal, heads bulat > 0, kg_lb > 0}`, tanggal tak ganda, Σ ekor = ekor baris, Σ kg dalam 0,01 dari kg baris; selain itu hasilnya `invalid` (tak pernah setengah dipercaya, tak pernah diganti profil). `:238` `classDetailOf`.
- `W/lib/v5/copy-plan.ts:95` membaca kolom `detail`; `:111` detail tak sah menahan salin: "Kelas K: rincian per tanggal tersimpan tidak cocok dengan ekor dan kg LB kelas: simpan rencana ulang".

**`batch.lb_price_source`**
- `W/lib/v5/copy-plan.ts:167` `lbPriceSourceOf`, dipakai `:209` pada baris batch yang disalin: keputusan kelas → `keputusan_kelas`; keputusan semua kelas → `keputusan_semua_kelas`; harga supply dan harga parameter → `manual` (Q-v5.2-70). Pesan salin tetap menyebut sumber yang lebih halus ("harga supply 6", "harga hari ini (parameter)"). Berlaku untuk salinan v4 dan v5 (satu gate, K58).

**Tes** (golden B.3/B.5 dan `plan-2026-08-24` tidak berubah):
- `W/lib/v5/a1c-b5.test.ts` (15 tes): `reasonAction` menulis `plan_week_id` versi terakhir (bukan versi pertama, bukan yang dihapus), tanpa rencana tanpa versi, alasan v1 ditarik saat v2 menulis dan alasan terakhir tidak ditulis dua kali; `copyGate`: alasan terikat v2 membuka C58 untuk v2 saja (v1 tetap `C58 BELUM DIISI` walau alasan lebih baru dari v1), alasan terikat v1 sah untuk v1 saat v2 ada; baris lama dinilai waktu; permintaan select memuat `plan_week_id` dan `detail` (klien memori mengembalikan baris utuh, jadi yang dicek adalah permintaannya); `saveClassPlanAction` menulis `detail` per kelas yang jumlahnya = ekor dan kg baris pada tanggal potong; salin membuat persis batch dari `detail` walau demand berubah sesudah simpan (PO membesar), dan baris tanpa `detail` mengikuti profil baru (pembagian berbeda); detail yang tidak cocok menahan salin, tak ada tulisan; `lb_price_source` tiga nilai pada jalur v5 dan v4.
- `E/test/a2-loop.test.ts` (6 tes baru): `splitClassPlan` memakai detail, null/tidak ada → profil, detail dipakai walau profil kosong, 12 bentuk detail tak sah → `invalid`, toleransi 0,01 kg, `classDetailOf` ↔ `splitClassPlan` bolak-balik.
- Bukti ke database bahwa DB menerima nilai-nilai itu: blok B5 `test:rls` ("B-R85 lb_price_source", "A2 plan_check_reason.plan_week_id plan_week_class.detail"), dijalankan ulang di gate ini.

### 4. Q-v5.2-15 sisi kode: Sales tidak membaca `plan_week`, `demand_weekly`, `demand_class_weekly`, `plan_week_class`
Daftar semua pembaca (grep tabel dan pemanggil `loadPlanning`, `demandWeekly`, `loadPpicV5`, `managementV3`, `v3ForWeek`, `loadManagementV5`) dikunci sebagai daftar di `W/lib/v5/planning-readers.test.ts` (tes gagal bila ada berkas pembaca baru yang tidak terdaftar, dengan siapa yang menjalankannya). Yang dijalankan dengan sesi Sales dan diubah:

| Pembaca | Sebelum | Sekarang | Lokasi |
|---|---|---|---|
| Jawab surplus (`answerSurplusAction`) | `plan_week` (id versi, daftar surplus) | Sales: view `surplus_for_sales_v52` (`loadSurplusForSales`: versi terbaru minggu itu, dua permintaan berurut, batas 500 baris = galat); Admin dan Kepala Sales: `plan_week` seperti dulu | `W/app/komersial/actions-v5.ts:111,141,147`; `W/lib/v5/surplus-view.ts:46,67` |
| Tile "Dari PPIC" Komersial untuk Sales | tidak ada surplus ("Tidak ditampilkan untuk Sales"), form jawaban tak muncul | surplus SKU yang ditugaskan (kg, jawaban terakhir) dan form jawaban; detail rencana tetap tidak ditampilkan | `W/lib/v5/komersial-data.ts:134`, `W/lib/v5/komersial.ts:138`, `W/app/komersial/v5.tsx:34` |
| Halaman Demand | `demand_weekly`, `plan_week`, `plan_day`, PO | Sales: pemberitahuan "tidak ditampilkan untuk Sales", tanpa bacaan; tautan Demand untuk Sales dihapus dari navigasi modul | `W/app/w/[week]/demand/page.tsx:22`, `W/lib/modules-core.ts:127` |
| Kontrol (`kontrol/page.tsx`) dan `snapshot.json` | `v3ForWeek`: demand, rencana, C28/C30 | `v3ForWeek(…, role)`: untuk Sales blok perencanaan dilewati (tanpa kunci `demand` dan `plan`, tanpa C28/C30) | `W/lib/v3/week.ts:67`, `W/app/w/[week]/kontrol/page.tsx:31`, `W/app/api/w/[week]/snapshot.json/route.ts:18` |
| Pratinjau tampilan manajemen di Outlook | `managementV3`: `demand_weekly`, `plan_week` | `managementV3(…, role)`: untuk Sales `demand` null dan `demandHidden`; kartu: "Tidak ditampilkan untuk Sales (data perencanaan)" | `W/lib/v3/management.ts:82`, `W/components/v3/ManagementV3.tsx:104`, `W/app/w/[week]/outlook/page.tsx:23` |
| Kartu Input "Karkas tanpa ukuran" | `demand_class_weekly` (kosong untuk Sales sejak B2 → "0 kg") | untuk sesi Sales: "tidak ditampilkan" tanpa bacaan; Admin atau Kepala Sales yang melihat sebagai Sales tetap melihat angkanya | `W/lib/v5/input-data.ts:346` |

Pembaca lain yang tidak dijalankan sebagai Sales (terdaftar di tes): Rencana dan aksinya (admin, ppic, finance, +pembaca K37), Minggu ini dan `management-data` (`MINGGU_INI_ROLES`), `loadPpicV5` di Komersial (hanya non-Sales: `ppic: sales ? null`), pembangun mart (klien layanan), rilis (Admin, Finance).

Tes peran Sales: `W/lib/v5/sales-plan-reads.test.tsx` (15 tes). Basis data memori berisi data rencana dan demand yang **berbeda** dari isi view, sehingga bacaan tak sengaja terlihat pada jawaban, dan log permintaan tidak boleh memuat `plan_week`, `plan_week_class`, `plan_day`, `demand_weekly`, `demand_class_weekly`:
- jawab surplus: versi dan kg dari view (versi terbaru), kunci Sales lain / SKU tanpa surplus / kunci yang hanya tinggal jawaban ditolak ("tidak ada di daftar surplus rencana"), tanpa rencana → "Belum ada rencana PPIC tersimpan", galat view tampil apa adanya, Kepala Sales membaca `plan_week` dan tidak memakai view;
- `salesSurplusRows`: kunci unit → `RPA|unit`, baris rencana dan baris jawaban digabung, hasil sama sebelum dan sesudah B6;
- `loadKomersialV5` sebagai Sales (`ppic` null, `surplusForSales` dari view), tile (kg, jawaban, "belum ada rencana", "tidak menyebut surplus", teks lama bila tidak dimuat);
- kartu Input untuk Sales / Kepala Sales / Admin; halaman Demand (log permintaan kosong); `v3ForWeek` Sales vs Admin; `managementV3` Sales vs Admin.
- Dicek dengan mutasi (empat): mengembalikan pembacaan di `v3ForWeek`, di aksi jawab surplus, di kartu Input, dan di `managementV3` masing-masing membuat tes yang bersangkutan gagal.

Bukti ke PostgREST sungguhan (`docs/v5.2/bukti/a1c-sales-postgrest.mts` dan `.txt`; PostgreSQL 16.15 + PostgREST 12.2.3, bukan Supabase; menjalankan `loadSurplusForSales` dari kode aplikasi dan sisipan jawaban surplus yang sama dengan aksi): di skema 5.2.4 Sales membaca `plan_week`, `demand_weekly` dan 4 baris jejak audit (belum ditutup); di 5.2.5 Sales membaca 0 baris dari semuanya, Kepala Sales tetap 1 baris, view memberi Sales A satu baris `RPA|Karkas` (6.332 kg, jawaban terakhir), jawaban masuk (FK ke `plan_week` diperiksa pemilik tabel), SKU Sales lain ditolak `42501`. Di 5.2.4 kode yang sama jalan: untuk rencana berkunci unit view B2 hanya memberi baris jawaban dengan kg surplus kosong, sehingga daftar surplus bagi Sales kosong sampai B6 (Q-v5.2-79).

### 5. Migrasi penutup (cabang `v5.2/b6-sales-plan-read`)
Dikerjakan di `/home/user/wt-b6`; lihat `docs/v5.2/b6.md`. Ringkas: `plan_week_read` dan `demand_weekly_read` tanpa Sales, jejak audit empat tabel tak terbaca Sales, `tg_plan_check_reason_scope` SECURITY DEFINER, view `surplus_for_sales_v52` menamai kunci unit sebagai `RPA|unit`, versi 5.2.5, blok RLS baru, bundel `docs/v5.2/kgr-os-migrasi-v52-b6.sql`.

## 3. Perubahan yang terlihat pengguna

1. Finance dapat memposting alokasi yang punya SKU tanpa harga acuan (alasan ≥ 10 karakter); Cost Accounting tetap tidak; halaman Input costing terbuka untuk Finance dalam tampilan ringkas.
2. Posting biasa memposting run berharga lengkap walau run lain minggu itu tertahan (Q-v5.2-75).
3. Alasan C58 hanya berlaku untuk versi rencana yang ditulis untuknya; versi baru perlu alasan baru (sudah begitu menurut waktu; kini pasti menurut versi).
4. "Salin ke batch" membuat batch sesuai pembagian per tanggal potong yang disimpan rencana (bukan dihitung ulang dari demand hari ini); detail yang tidak cocok menahan salin.
5. Sales: tile "Dari PPIC" menampilkan surplus SKU mereka dan form jawaban (sebelumnya "tidak ditampilkan"); halaman Demand, Kontrol, snapshot, pratinjau Outlook dan kartu Input tidak menampilkan data perencanaan untuk Sales (dan tidak ada angka 0).
6. Banner "skema database belum diperbarui" muncul bila DB di bawah 5.2.4.

## 4. Pertanyaan baru (Q-v5.2-70 … 79)

Belum dimasukkan ke `docs/v5/QUESTIONS.md` supaya tidak bentrok dengan cabang lain; pindahkan saat merge. Q-v5.2-71 … 74 dijelaskan lengkap di `docs/v5.2/b6.md` Bab 5: **71** view `surplus_for_sales_v52` salah untuk rencana berkunci unit (diperbaiki di B6), **72** `plan_day` masih terbaca Sales (belum ditutup), **73** `tg_plan_check_reason_scope` jadi SECURITY DEFINER, **74** jejak `audit_log` tabel rencana dan demand ditutup untuk Sales.

**Q-v5.2-70. `batch.lb_price_source` untuk harga supply dan harga parameter = `manual`.** Check kolom hanya mengizinkan `keputusan_kelas`, `keputusan_semua_kelas`, `manual`, atau null (null = belum ada harga, C57). Batch hasil salin selalu punya harga, jadi null salah. Harga dari baris supply LB (diketik Purchasing) dan harga hari ini (kolom parameter, diketik Purchasing) bukan keputusan; "diketik orang" adalah arti `manual`. Pembedaan supply atau parameter tetap ada di pesan salin, tidak di kolom. Bila Finance atau PPIC ingin keduanya dibedakan di basis data, itu perubahan check (satu `drop constraint`, pengecualian tertulis seperti Q-v5.2-62). Pemilik: PPIC dan Cost Accounting.

**Q-v5.2-75. Posting biasa tidak lagi menolak seluruh minggu karena satu batch tak berharga.** Sebelumnya `postWeek` menolak semua bila ada SKU tanpa harga acuan (kecuali override). Karena jalur dipisah (RPC hanya menerima run tak berharga, dan Finance tak punya hak posting biasa), run berharga lengkap kini diposting dan yang tertahan disebut dalam pesan; bila semua tertahan, ditolak seperti dulu. Alasan: tanpa itu Cost Accounting menunggu Finance untuk batch yang tak terkait. Kontrol rilis (C24) tetap menahan minggu sampai semua run diposting. Pemilik: Cost Accounting dan Finance.

**Q-v5.2-76. Halaman Input costing dibuka untuk Finance (tampilan ringkas), tautan Demand untuk Sales dicabut.** Finance tidak punya halaman lain untuk override (halaman Costing adalah baca saja untuk banyak peran); halaman Input costing 404 untuk Finance sebelumnya. Finance hanya melihat kontrol C21–C24 dan kartu override; formulir alokasi, cost pool, tarif tetap Admin dan Cost Accounting. Navigasi modul "Demand" tidak lagi memuat Sales karena halamannya kini hanya pemberitahuan (URL langsung tetap menampilkan pemberitahuan, bukan 404). Pemilik: Finance; Kepala Sales untuk Demand.

**Q-v5.2-77. `detail` tak sah menahan salin, tidak pernah diganti profil.** DB hanya meminta object atau array (Q-v5.2-63); bentuk dan konsistensinya dijaga kode: array `{cut_date, heads, kg_lb}`, total sama dengan baris (kg dalam 0,01). Detail yang diubah tangan atau rusak membuat kelas itu tak bisa disalin ("simpan rencana ulang") alih-alih diam-diam jatuh ke profil demand yang bisa berbeda dari yang disimpan PPIC. Bila ingin DB menjaga bentuknya, itu check atau RPC `save_class_plan` (O33(b)). Pemilik: PPIC.

**Q-v5.2-78. Alasan C58 ganda dicegah di kode, kode lain tidak terikat versi.** Sebelumnya duplikat hanya ditolak indeks unik DB; kini `reasonAction` memeriksa lebih dulu (pesan sama) dan hanya C58 yang membawa `plan_week_id` (B5 menyebut C58; kode lain, mis. C41, tetap per minggu). Bila PPIC ingin C41 dan lainnya ikut terikat versi, `plan_week_id` bisa ditulis untuk semua kode (indeks unik B5 sudah per `(plan_week_id, code)`), tetapi indeks lama `(week_start, code)` harus dipersempit lebih dulu (Q-v5.2-62). Pemilik: PPIC.

**Q-v5.2-79. Urutan production dan keadaan sebelum B6.** Kode ini dipasang dulu, bundel B6 sesudahnya (kode tidak butuh 5.2.5: `EXPECTED_SCHEMA` 5.2.4). Selama B6 belum ada: Sales masih bisa membaca `plan_week`, `demand_weekly` dan jejaknya lewat API (kode tidak lagi memintanya, jadi layar tidak menampilkannya), dan untuk rencana berkunci unit view B2 belum memberi Sales kg surplus (Sales melihat baris jawaban tanpa kg; form jawaban memakai hanya baris ber-kg, jadi tidak ada form) — terbukti di `a1c-sales-postgrest.txt` skema 5.2.4. Sesudah B6 keduanya beres tanpa perubahan kode. Dijalankan dalam urutan terbalik (B6 sebelum kode ini), halaman yang masih membaca dua tabel itu sebagai Sales (Demand, Kontrol, Outlook manajemen, kartu Input, jawab surplus) tampil kosong atau salah, jadi urutan ini wajib. Pemilik: koordinator.

## 5. Aturan merge

Aturan PRD A Bab 4: kode yang memakai objek DB baru di-merge sesudah bundelnya diterapkan di KGR-OS. Objek yang dipakai di sini (B5, 5.2.3 dan 5.2.4) sudah ada di KGR-OS sejak 18 Okt 2026 (tabel cek 26 baris `true`), jadi cabang ini boleh di-merge dan dipasang sekarang. Bundel B6 (5.2.5) dijalankan oleh koordinator sesudah kode ini ada di production dan backup dibuat; tidak ada bagian kode yang menunggunya.

## 6. Tidak dikerjakan dan batas

- Penerapan ke KGR-OS atau staging; tes yang sama di Supabase sungguhan (T21 di staging memakai berkas tes yang sama).
- `plan_day`, `sales_line` (PO semua pelanggan terbaca Sales), dan jejak `audit_log` tabel komersial lain (Q-v5.2-72, `b6.md` Bab 6): bukan bagian Q-v5.2-15.
- Bentuk `detail` dijaga DB (Q-v5.2-77); `save_class_plan` (O33(b)).
- Alasan C41 dan lainnya terikat versi (Q-v5.2-78).
- Penyatuan pembedaan sumber harga supply vs parameter di kolom DB (Q-v5.2-70).
- `docs/v5/QUESTIONS.md` dan `docs/v5.2/PROGRESS.md` tidak diubah (cabang lain menulis ke sana).
- Skrip bukti PostgREST (`a1c-sales-postgrest.mts`) bukan bagian `pnpm test`; PostgREST dan basis datanya disiapkan tangan (Bab 7).

## 7. Mengulang

```bash
pnpm typecheck && pnpm test
pnpm parity && git diff --exit-code -- docs/parity.md docs/parity-cells.csv
pnpm snapshot:diff
bash scripts/test-lint.sh
python3 -I scripts/lint.py k41; python3 -I scripts/lint.py k42; python3 -I scripts/lint.py missing
createdb a1c_rls && DATABASE_URL="postgresql://postgres@/a1c_rls?host=/tmp" pnpm test:rls
# bersama B6: salin 20261025000600_v52_sales_plan.sql dan supabase/tests/rls_roles.sql dari cabang v5.2/b6-sales-plan-read ke salinan
# scratch dari HEAD (git archive HEAD | tar -x -C <dir>), lalu DATABASE_URL=… bash scripts/test-rls.sh di <dir>  → 47 blok
# bukti PostgREST (dua DB: shim + semua migrasi + seed; satu ditambah B6; isi data minggu 2033-08-01 seperti kepala keluaran
# docs/v5.2/bukti/a1c-sales-postgrest.txt), PostgREST 12.2.3 di port 3918 (tanpa B6) dan 3919 (dengan B6):
NODE_OPTIONS=--conditions=react-server PGRST_URL=http://127.0.0.1:3919 AFTER_B6=1 pnpm exec tsx docs/v5.2/bukti/a1c-sales-postgrest.mts
```
