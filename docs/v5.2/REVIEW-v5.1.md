# Review v5.1: KGR Weekly Outlook (`67c7f03..cb76753`, PR #32–#36)

Tanggal: 17 Okt 2026 (WIB) · Basis: `main` = `cb76753` · Peninjau: Claude (Opus 5.5), tiga reviewer paralel dengan cek silang
Bahan: `konteks-fable-brief.md` dan `konteks-fable-lengkap.md` (PRD v5, v5.1, QUESTIONS, journey, bukti), snapshot `cb76753`, `kode-v51.diff`, `skrip-uji-lokal.zip`, `screenshot-bukti.zip`, audit v5 `67c7f03` (ChatGPT, F01–F29), dan audit evidence `KGR-v5-Audit-Evidence-67c7f03`.

## Ringkasan

**Putusan: v5.1 belum layak disebut selesai, dan production KGR-OS saat ini tidak bisa dipakai.**

v5.1 memperbaiki banyak hal nyata:
- K44: rilis tidak lagi terkunci oleh tugasnya sendiri.
- RPC `lock_commitments` atomik.
- `base_key` membuka penulisan komitmen Sales.
- `must`/`LoaderError` di loader v4/v5.
- Solvabilitas memakai `nibtAfter`.
- PDF rilis mengikuti K25.

Masih ada tiga kelompok masalah:

1. **Production tertinggal dari kode** (A-LIVE). Vercel sudah menjalankan `cb76753`, tetapi migrasi v5.1 belum diterapkan di KGR-OS. Mart juga belum pernah dibangun: 49 antrean `queued` sejak 15–16 Okt. User baru satu, yaitu admin.
2. **Kontrol rilis dan RLS masih bisa dilewati di DB.** Contohnya:
   - `week.update_date` bisa diubah 8 role, termasuk di minggu `closed`;
   - Sales membaca rencana dan jawaban surplus SKU orang lain;
   - C53 hanya dinilai dari snapshot kiriman klien;
   - K45 lolos untuk grid parsial.

   Beberapa celah ini sudah terbukti ada di policy KGR-OS sendiri.
3. **Putaran inti dan angka FS belum tersambung.** Rinciannya:
   - komitmen terkunci yang melebihi PO menjatuhkan seluruh halaman Rencana v5 (F02 masih terbuka);
   - batch masih dibuat dari rencana STD v4;
   - faktur tie membuat status "final" tanpa alokasi;
   - beban tetap hilang tanpa tanda di bulan sesudah jadwal;
   - "Selisih costing" ikut masuk COGS "Actual · jurnal", sehingga P&L tidak bisa sama dengan FS.

Jumlah temuan: 46 pasti dan 22 dugaan. Dari 29 temuan audit v5 (F01–F29): **4 diperbaiki** (F10, F15 dengan efek samping, F24, F25 sebagian besar), **8 sebagian**, dan **17 masih terbuka**.

### Cara bukti dibuat (dan batasnya)

| Bukti | Lingkungan | Yang dibuktikan |
|---|---|---|
| Kueri read-only ke KGR-OS `pczjhmzpkknzkziipvit` (Supabase MCP) | production, 17 Okt | keadaan skema, flag, data, policy, user |
| Daftar deploy Vercel `kgr-weekly-outlook` | production | commit yang live. Env dan log **tidak bisa dibaca** (403/404 dari connector) |
| `scripts/test-rls.sh` + 16 probe role-JWT (rollback) | PostgreSQL 16.15 lokal + shim, bukan Supabase | celah RLS/RPC A-REL-* |
| `vitest` engine (362 lulus + 1 todo) + probe | Node 22, engine saja (`xlsx` dari cdn.sheetjs.com diblokir 403, web/parsers tidak terpasang) | A-CST-1, -3, -7, F04 |
| Baca kode `file:baris` | snapshot `cb76753` | sisanya. Disebut "kode" di kolom Bukti |

Tidak dijalankan: PostgREST, `next start`, browser, dan journey. Tidak ada klaim "lulus" untuk alur aplikasi.

---

## 1. Production (A-LIVE): keadaan 17 Okt 2026

| # | Fakta (diperiksa) | Akibat |
|---|---|---|
| A-LIVE-1 | Vercel production = `cb76753` (READY, deploy dari push `main`) | kode v5.1 sudah dipakai |
| A-LIVE-2 | KGR-OS tidak punya `base_key(text)`, `lock_commitments(date,jsonb)`, `advance_update_date`, `price_list_week.deleted_at`, `parameter.po_unsized_mode`, `tg_sales_line_scope` | Dengan `v5_costing` hidup, `rebuildDay` dan `releaseWeek` gagal di bacaan `price_list_week.deleted_at` (`lib/v3/ledger.ts:45` → `lib/v5/costing.ts:111`). Kunci komitmen gagal. Upload jurnal menulis "TIDAK dimajukan". DB v5 tidak menegakkan K44/K45/C53, sementara UI melakukan pre-check, sehingga aturan tampak berlaku padahal tidak |
| A-LIVE-3 | `supabase_migrations.schema_migrations` hanya mencatat s.d. `20261016001300_m7_approval`, karena v4/v5 diterapkan lewat bundel SQL editor | tidak ada sumber kebenaran versi skema |
| A-LIVE-4 | Semua mart kosong (`pl_daily`, `pl_daily_v4`, `lot`, `sku_balance_daily`, `cash_position_daily`, `demand_class_weekly`, `input_task`, `input_completeness_daily` = 0). `rebuild_queue` 49 baris `queued`: 24–30 Agu (15 Okt) dan **19 Okt–29 Nov** (16 Okt, tanggal masa depan) | semua layar manajemen "belum dibangun" atau "belum ada". Antrean hanya dikuras app dengan `SUPABASE_SERVICE_ROLE_KEY` (`lib/supabase-service.ts:12`). Dugaan kuat kunci belum dipasang di Vercel (O12) |
| A-LIVE-5 | `app_user` = 1 baris (admin) | putaran dengan role sebenarnya mustahil di production |
| A-LIVE-6 | 16 flag `{"enabled": true}` tanpa `roles` dan tanpa `since` | revaluasi K22 berhenti. Seluruh v5 terbuka untuk semua role sebelum lulus uji |
| A-LIVE-7 | `fixed_cost_schedule`: GAJI, BUNGA, SEWA-ABF-NMG `amount_per_month` null (angka FS hanya di `note`). `parameter.accurate_sales_kg` / `accurate_opening_stock_value` null | C55 PERIKSA dan NIBT setelah beban tetap tidak lengkap. C8/C9 BELUM DIISI menahan rilis (`v4_release` hidup) |
| A-LIVE-8 | `gl_line` 1.840 baris, 1–26 Agu saja. Tidak ada September, `bank_account` 0, `month_outlook` hanya Sep | tujuan "dashboard = FS" belum bisa diuji |
| A-LIVE-9 | `coa_map.fs_mapping_reference` bergeser terhadap `pl_line`: 4101008 Sales Return LB → "Revenue - Trading"; 6100003 Advertising → "Salaries and allowance - Sales"; 5100010 tol/parkir → "COGS - Labor"; 6100005 Komisi → "Delivery Expenses - SE" | rekonsiliasi per baris FS tidak bisa memakai kolom ini sebelum dikoreksi Finance |
| A-LIVE-10 | `apps/web/vercel.json`: region `hnd1` (Tokyo), KGR-OS `ap-northeast-2` (Seoul). Tidak ada `crons` | latensi lintas region per query. Tidak ada job harian |
| A-LIVE-11 | Fungsi SECURITY DEFINER di KGR-OS: semuanya `search_path=""`, tidak ada yang bisa dieksekusi `anon` | baik. Pemeriksaan ini perlu diulang sesudah bundel v5.1/v5.2 |

---

## 2. Temuan pasti, urut berat

Kolom **Jalur**: **K** = cukup kode (PRD v5.2-A), **D** = butuh migrasi atau data DB (PRD v5.2-B), **K+D** = keduanya.

### 2.1 P1 — rilis, keamanan, putaran putus

| # | Kategori | Lokasi (`cb76753`) | Skenario → dampak | Jalur |
|---|---|---|---|---|
| A-UI-1 | keamanan, K41 | `apps/web/lib/modules.ts:15-16` (`if (error \|\| !data) return {}`) | Bacaan `app_setting` gagal → semua modul dianggap mati. `k25On` false, sehingga "REKOMENDASI RPA/TUNDA" muncul lagi. Rebuild jadi "skip". `releaseWeek` membuat snapshot tanpa `controls_v3` → C53 lolos | K |
| A-UI-2 | bug (F02 terbuka) | `lib/v3/planning.ts:117` (`id: e.ref`), `lib/v5/ppic-data.ts:49-54` (`.in("id", part)` pada UUID) | Komitmen terkunci > PO Confirmed → ID `commitment:…` masuk query UUID → 22P02. Ikut gagal: halaman Rencana v5, simpan/salin, builder `demand_class_weekly`, dan tile `sim-lb`. Putaran putus di langkah 2→3. Journey L tidak menangkapnya karena minggu 31/08 tidak pernah dibuka | K |
| A-REL-1 | keamanan, DB | `supabase/migrations/20261014000200_security.sql:168-170` (`week_upd`: admin, inventory_accounting, finance, ppic, sales, purchasing), `20261016000100_v3_foundation.sql:215` (`week_upd_v3`), `20261019000100_v4_release.sql:149` (`tg_week_guard` melewati `update_date` untuk semua role tanpa cek status) | Sales `PATCH week set update_date` mundur atau maju, termasuk minggu `released`/`closed` → UPDATE berhasil (probe P8/P8b). Policy yang sama **ada di KGR-OS**. Akibatnya `dataToday`, batas aktual/outlook, C53, dan grid bergeser untuk semua orang. Cek role di RPC `advance_update_date` tidak berarti | D |
| A-REL-3 | keamanan (F16 terbuka) | `20261021000100_v5_foundation.sql:395-412` (`*_read` = `is_app_user()`) | Sales ber-assignment `RPA\|Karkas\|Fresh` membaca `plan_week_class` `{"Trading\|BLP\|Frozen":100}` dan `surplus_response` key Trading (P1). Policy sama di KGR-OS | D |
| A-REL-2 | keamanan | `20261024000200_v51_security.sql:148-153`, `20261017000200_v4_security.sql:72` | `sales_sees_cost=false`: `cost_per_kg` null, tetapi `cost_per_kg_ma`, `price_floor`, `margin_*` tetap terbaca lewat API, di view v5 maupun v4 (P7) | D |
| A-REL-4 | keamanan | `…0200_v51_security.sql:111-118` (hanya NEW). `sales_line_upd` tanpa filter baris (`20261014000200_security.sql:210-212`) | Sales PT A: `update sales_line set customer=null where customer='PT B'` → 1 baris (P10). PO rep lain bisa diambil alih atau dihapus | D |
| A-REL-5 | PRD, DB (F07 sebagian) | `20261024000100_v51_release.sql:29-37`. C53 hanya ada bila `v5_costing` hidup global (`lib/v3/week.ts:49`, `lib/release.ts:63-67`) | `rpc/release_week` dengan snapshot `{"controls":{"overall":"LULUS","controls":[]}}` tanpa `controls_v3` → UUID rilis (P2). Kontrol v1 dan C53 dilewati tanpa override | D |
| A-REL-6 | PRD, DB (F09 sebagian) | `…0100_v51_release.sql:45` (cukup satu sel ada), `lib/v5/input-data.ts:201-216` | Grid berisi satu sel Senin `passed` → rilis diterima (P4). Journey P merilis Senin 10.30 dengan `v4_release` mati | D |
| A-REL-7 | keamanan | `20261021000100_v5_foundation.sql:440,448`, `…0200:100` | Sales menimpa jawaban surplus Kepala Sales; `responded_by` tetap nama lead (P13) | D |
| A-UI-4 | K41 gagal-terbuka | `lib/release.ts:16-27,39`, `lib/v3/stale.ts:11-13` | Bacaan gagal → `strict=false`, `staleDates=[]` (C45 LULUS), dan pesan K45 palsu "grid belum dibangun" | K |
| A-UI-5 | DB, deploy | tidak ada pemeriksaan versi skema | lihat A-LIVE-2. Kerusakannya lebih luas dari "tile error" di brief §5.3 | K+D |
| A-UI-7 | DB, ketahanan | `lib/rebuild.ts:105,108,112` (update tanpa cek error), tanpa pemulihan `running` | Rebuild s.d. 62 tanggal dijalankan inline di server action. Bila fungsi terhenti, baris tetap `running` → STALE permanen dan rilis ketat terkunci | K |
| A-CST-1 | bug, PRD (F12 bentuk lain) | `packages/engine/src/pl-v5.ts:47-52` (`scheduled` tanpa periode), `:93-98`, `:205-207`, `lib/v3/cash.ts:104` | Jadwal 8.3 lewat Input v5 berlaku sebulan (`input-save.ts:196`). Contoh: jadwal September berisi gaji/penyusutan/bunga. Di Oktober hanya sewa yang dihitung, FINAL tidak dipakai, dan C55 LULUS. NIBT setelah beban tetap dan solvabilitas terlalu tinggi (probe) | K |
| A-CST-2 | bug (F04 terbuka) | engine `costing.ts:347-348` (`invoiceStatus === "tied"` → final), `lib/v5/input-save.ts:212-218`, `lib/v5/costing.ts:121,154-158`, `lib/v3/ledger.ts:90-94,214` | Satu faktur LB tie → batch `final` tanpa `allocation_run`. Lot memakai biaya penerimaan, berlabel final, dan tidak direvaluasi (probe) | K |
| A-CST-3 | PRD (K50, R17 setengah) | `lib/v3/costing.ts:117,123,200-213`, engine `costing.ts:232-234,250` (`canBeFinal` tidak dibaca), `ledger.ts:65-94` | Lemak tanpa harga acuan → Rp0/kg dan C21 lolos, batch diposting. Akibatnya lot Lemak bernilai 0 dan harga lantai 0. `nullMissing` jadi kode mati | K |
| A-UI-3 | PRD (F01 terbuka, F06 sebagian) | `app/w/[week]/rencana/actions.ts:43,83-90`, `lib/v3/planning.ts:408-449` | Batch dibuat dari `plan_day` STD v4 dengan yield v1, dan harga LB dari supply/parameter, bukan keputusan. `copyPlanAction` lama tidak memeriksa C57/C58 dan sah dipakai saat `v5_ppic_class` dibatasi role | K (K27 penuh: K+D) |

### 2.2 P2 — angka salah, kontrol hijau palsu, dan alur tidak bisa diselesaikan

| # | Kategori | Lokasi | Inti | Jalur |
|---|---|---|---|---|
| A-CST-4 | PRD, FS | engine `costing.ts:593-607`, `monthly.ts:29-30`, `lib/v5/pl-tiles.ts:39` | "Selisih costing" dan biaya idle masuk COGS pada kolom "Actual · jurnal". GP/NIBT berbeda dari FS sebesar Σ baris itu. C49 tidak menangkapnya | K (setelah O24) |
| A-CST-5 | bug (F19 terbuka) | `lib/rebuild.ts:18-25` (`v3/cash` diimpor sebelum `v4/month`) | Rebuild satu tanggal → `solvency_monthly.basis_nibt` dari `pl_daily_v4` / `note.fixed` lama | K |
| A-CST-6 | DB (dugaan B v5 terbukti di kode) | `lib/v5/costing.ts:134-135,154-158`, `lib/v3/ledger.ts:173-191` | Revaluasi K22 dihitung ulang dari input yang bisa berubah (keputusan LB, WP, `since`, mode). Selisih costing bulan yang sudah dirilis berubah tanpa jejak | K+D |
| A-CST-7 | missing ≠ 0 | `lib/v5/costing.ts:140,146,149-150` (`?? "0"`) | Yield atau tarif kosong → biaya 0, `canBeFinal` true, C54/C57 LULUS (probe) | K |
| A-CST-8 | bug | `components/v5/CommitmentForm.tsx:24-30`, `app/komersial/actions-v5.ts:27-37` | Lead menekan Simpan sesudah kunci → versi baru untuk **setiap** SKU terkunci, tidak atomik | K |
| A-UI-6 | bug (F18 sebagian) | `app/komersial/actions-v5.ts` | Simpan, kunci, dan jawab surplus tidak meng-queue tanggal jatuh tempo tugas (`commitment_lock` = Jumat). K35 tetap merah sesudah kunci | K |
| A-UI-9 | bug (F03 terbuka) | `lib/v5/ppic-data.ts:70`, engine `ppic-class.ts:86-88` | PO Tentative 100 kg (bobot 70%) dihitung 100 kg. `fulfilled`/`cancelled` tidak dikurangi. Forecast tidak masuk | K |
| A-UI-10 | bug (F11 terbuka) | engine `ppic-class.ts:161-165,221` | Kebutuhan STD tanpa kelas tidak dicek C58. Screenshot `journey-KMNO-m-ppic`: supply "belum diisi", tetapi tanpa penahan C58 | K |
| A-UI-11 | bug (F05-B terbuka) | engine `upload-validate.ts:394,426` | C22 menghitung baris yang ditolak: 70 + 27 (kode X) = 97 → lolos, padahal yang tersimpan 70 | K |
| A-UI-12 | UI (F27 sebagian) | `app/w/[week]/rencana/v5.tsx:15` | Tidak ada form persetujuan downgrade di v5, sementara salin menolak "belum disetujui" → jalan buntu | K |
| A-REL-8 | keamanan, PRD (Q-v5.1-3) | `…0100_v51_release.sql:11-14`, dipakai `…0200:23,59,97,116,137,143,164` | Assignment Fresh mencakup Frozen (tulis dan baca). View v4 tetap key persis, sehingga lantai harga upload hilang untuk assignment key dasar (`input-data.ts:68-71`) | D (setelah O21) |
| A-REL-9 | keamanan | `…0200_v51_security.sql:73` | Price list terkunci yang diarsip Admin bisa diubah harganya dan dihidupkan lagi oleh Kepala Sales (P11) | D |
| A-REL-10 | bug | `20261024000300_v51_params.sql:59-74` (tanpa `order by`), `:42` | Satu key dengan beberapa ukuran berharga beda → harga price list acak. Minggu lampau (`2020-01-06`) bisa dikunci (P12) | D |
| A-REL-11 | K41 | `lib/release.ts:16-21,39` | sama dengan A-UI-4 (dua reviewer) | K |
| A-UI-8 | K41 di builder | `lib/v3/ledger.ts:55,58,59,62` (`.catch(() => [])`), `lib/v3/planning.ts:109`, `lib/v5/costing.ts:189` | Ledger dibangun tanpa alokasi/pengiriman. Stok bebas naik tanpa error | K |
| A-CST-9 | K41 | `lib/v4/kas-data.ts:17-21,37`, `lib/v4/month.ts:93,119,261,268`, `lib/v3/cash.ts:181`, `lib/v3/costing.ts:66,211`, `lib/v3/ledger.ts:300` | Error dibaca sebagai "Saldo kas belum diisi" | K |
| A-UI-16 | K41 di `app/**` | contoh `app/komersial/actions-v5.ts:33,87`, `app/w/[week]/rencana/actions.ts:44`, `lib/session.ts:19` | Draft ganda. User sah dialihkan ke "not-allowed". Q-v5.1-16 (lint hanya `lib/v4`, `lib/v5`) dinilai **salah**: > 60 bacaan tanpa cek error di `lib/**` + `app/**` | K |
| A-UI-17 | K42 | `lib/data.ts:25-37` (`fetchAll` tanpa urutan unik, ±190 pemanggil), 21 `.in()` tanpa chunk (mis. `app/sku/[key]/page.tsx:36-37`, `lib/v5/input-save.ts:93,131,162`), `app/komersial/approval/page.tsx:22` | Duplikat atau baris hilang pada data > 1 halaman. URL terlalu panjang | K |
| A-UI-13 | UI (F23 terbuka) | `lib/v5/pl-tiles.ts:230`, `lib/v5/management.ts:148-195`, `components/v4/TilePage.tsx:99`, `app/v4.css:170` | < 900 px: laba rugi dan keputusan muncul paling bawah | K |
| A-UI-14 | UI (F26 terbuka) | `lib/v5/management-data.ts:171-202` | Label sumber global: "PO · 15 Okt 23.20" tampil di minggu Agustus. Simulasi berlabel "WP" | K |
| A-CST-10 | missing ≠ 0 | `lib/v5/pl-tiles.ts:193-195` → engine `pl-v5.ts:287` | Grafik "NIBT setelah beban tetap" menggambar NIBT jurnal saat beban tetap belum ada | K |
| A-CST-11 | missing ≠ 0 | `lib/v4/outlook-bulan-data.ts:115,117`, `lib/v4/close.ts:217` | V1 tanpa NIBT → "NIBT 0". Selisih akurasi = \|FINAL\| | K |
| A-CST-12 / A-UI-15 | missing ≠ 0 (F28 terbuka) | `lib/v5/komersial-data.ts:64-65,73,80`, `lib/v5/management-data.ts:108`, `lib/v5/komersial.ts:81,94` | `over_age_kg` "0" untuk Sales dan Manajemen | K (+D bila view agregat) |
| A-CST-13 | missing ≠ 0 | `lib/v4/minggu-ini-data.ts:56,101`, `lib/v4/kas-data.ts:41`, `lib/v4/outlook-bulan-data.ts:143`, `lib/v4/month.ts:143`, `lib/v3/ledger.ts:105,323`, `lib/v3/commercial.ts:66`, `lib/v3/cash.ts:108,147-153` | `affiliate_payable ?? "0"`, `blast_cost ?? "0"`, runrate `?? 0`, dll. | K |
| A-UI-18 | verifikasi | `lib/v5/flags-matrix.test.tsx:37,51-52` | Matriks hanya 3 role. Satu tes tautologis. Lint K41/K42 tidak ada di CI | K |
| A-UI-19 | UI (Q-v5.1-25) | `lib/v4/nav.ts:67,87` | Upload Finance terpotong `slice(0, 7)` | K (setelah O23) |
| A-UI-20 | bug | `app/komersial/actions-v5.ts:92` | Jawaban surplus selalu key `RPA\|Karkas` | K |
| A-UI-21 | bug | `lib/v5/lb-decision.ts:24-27` | Keputusan tersimpan, lalu `queueThrough` melempar (> 62 hari). Action melapor gagal, pengguna mengulang | K |
| A-UI-22 | UI | `components/v5/UploadPanel.tsx:45` vs `:68` | `.xls` ditolak padahal ditawarkan `accept` | K |

---

## 3. Dugaan (belum direproduksi)

| # | Isi | Jalur |
|---|---|---|
| B-UI-1 | Rebuild 62 tanggal inline bisa melewati batas durasi fungsi Vercel. Perlu diukur di salinan KGR-OS | K |
| B-UI-2 | Env Preview Vercel bisa menunjuk KGR-OS → preview PR berjalan di DB production sebelum migrasinya | D/ops |
| B-UI-3 | `fetchAll` tanpa `order` unik → duplikat atau hilang (`synchronize_seqscans`) | K |
| B-UI-4 | Tanggal data macet bila baris `week` baru belum dibuat. Production: data 27 Agu, 51 hari di belakang jam dinding. Sekitar 29 Okt jaraknya melewati 62 hari (K40) | K+D |
| B-UI-5 | Keputusan form Manajemen (jam dinding + 1) tidak bisa membuka C57 selama data tertinggal | K (keputusan) |
| B-UI-6 | "1,234" dari file berlokal Inggris dibaca desimal | K |
| B-UI-7 | Batas body 4 MB vs grid JSON dari file besar | K |
| B-REL-1 | Upload PO Sales berbatas key gagal di tengah, tulisan parsial (`po-lines.ts:13-15`, `input-save.ts:93-94,127-132`) | K |
| B-REL-2 | Admin mengubah `release_override_policy` lalu meng-override sendiri (P16b terbukti teknis; desain) | D |
| B-REL-3 | F08: `release_month` V1 menerima C55 PERIKSA (P5). Diterima K47, perlu konfirmasi | D (O32) |
| B-REL-4 | Minggu tanpa `parameter` → `coalesce(…, true)` → Sales melihat biaya (`…0200:158-159`) | D |
| B-REL-6 | Bundel tanpa `notify pgrst, 'reload schema'` | D |
| B-REL-7 | Trigger memakai `item_code` persis, engine memakai `norm` → false deny | D |
| B-REL-8 | Sel grid dinilai terhadap `now()` tanpa rebuild sebelum rilis → merah atau hijau palsu | K |
| B-REL-9 | Guard Minggu ini berjalan sesudah `weekContext` (komputasi sia-sia, tidak bocor) | K |
| B-CST-1 | `coa_map.pl_line` memasukkan akun non-tetap ke baris K29 (`seed/04_coa_map.sql:189` Stock Difference → Depreciation, `:152` Travelling → Salaries) | K+D |
| B-CST-2 | `commitmentDemand`: PO per key vs komitmen per key×ukuran → hitung ganda (laten) | K |
| B-CST-3 | Overhead mode own (Nov 2026) tidak ada di planCost v5 | K |
| B-CST-4 | Fallback "estimasi bulan lalu" dari jurnal bulan FINAL, bukan snapshot FINAL + DI | K |
| B-CST-5 | Cut-off kunci V1/V2 memakai jam dinding (`month.ts:265`), mart memakai `dataToday` (`:229`) | K |
| B-CST-6 | Beban tetap sebagian kosong: total tampil tanpa menyebut baris kosong (hanya C55) | K |
| B-LIVE-1 | `rebuild_queue` berisi tanggal 19 Okt–29 Nov yang dibuat 16 Okt. Sumber pemicu belum diketahui | D |

---

## 4. Status temuan audit v5 (F01–F29) di `cb76753`

| Status | F |
|---|---|
| Diperbaiki | F10 (K44), F15 (dengan efek samping A-REL-8), F24 (PDF rilis K25), F25 (sebagian besar) |
| Sebagian | F05 (A selesai, B terbuka), F06, F07, F09, F12, F13 (proyeksi 12 bulan masih NIBT jurnal, `cash.ts:109`), F18, F27 |
| Terbuka | F01, F02, F03, F04, F08 (diterima K47), F11, F14 (§3.11), F16, F17, F19, F20 (O16), F21 (§3.11), F22 (§3.11), F23, F26, F28, F29 |
| Juga terbuka (dugaan v5) | revaluasi dari input mutable (A-CST-6), `.xls`, form parameter O8, editor `size_class_map`, cron harian |

---

## 5. Penilaian keputusan pelaksanaan Q-v5.1-1 … 33

| Nilai | Q |
|---|---|
| Sesuai | 1, 6, 9, 10, 12, 13, 14, 19 (catatan basi A-CST-5), 20, 21, 22, 26, 28, 29, 31, 32 |
| Sesuai dengan celah | 5 (filter key Sales, B-REL-1), 7 (A-REL-9), 8 (A-REL-10), 15 (landasan "RLS week tertutup" salah, A-REL-1), 24 (guard hanya di action v5, A-UI-3), 30c (`since` wajib masuk checklist deploy) |
| Menyimpang, bisa diterima | 2 (C53 hanya mode ketat; perlu O22), 11 (diungkap jujur; T8 belum lulus dengan flag production), 23 (b: baris v5 tidak disaring per role; tetapi lihat A-CST-4), 30a (risiko preview B-UI-2), 33 |
| Menyimpang, perlu keputusan | 3 (Fresh mencakup Frozen → O21), 25 (nav Finance → O23) |
| Salah | 4 sebagian (UPDATE tanpa cek OLD, A-REL-4; item tidak dinormalisasi, B-REL-7), 16 (lint K41 terlalu sempit), 17 sebagian (A-CST-1), 18 dalam akibat (ledger tetap 0, A-CST-3) |

---

## 6. Klaim yang lebih kuat dari buktinya

1. **R8/K53.** `irisan-1.md` menyatakan "biaya v5 kosong untuk Sales". Tesnya hanya memeriksa `cost_per_kg`; `cost_per_kg_ma`/`price_floor` bocor (A-REL-2). Matriks T11 hanya membuka halaman, tidak memeriksa API.
2. **K39.** "Sales denied" (`irisan-1.md`) dan komentar `lib/update-date.ts:5` ("the week's RLS stays closed") salah: Sales bisa langsung meng-UPDATE `week.update_date`.
3. **R3/K47** tanpa menyebut mode. Semua tes C53 memakai `v4_release` hidup (`rls_roles.sql:1641-1660`). "Di DB" hanya berlaku untuk snapshot kiriman klien.
4. **T8.** Journey P merilis Senin 10.30, saat yang jatuh tempo baru `plan_week`, dengan `v4_release` mati. Itu bukan "minggu lengkap".
5. **T7.** Langkah diuji per journey, belum pernah satu putaran berurutan. Minggu 31/08 (minggu komitmen) tidak pernah dibuka di Rencana, sehingga F02 lolos.
6. **T11.** Hanya 3 dari 10 role. Satu tes membandingkan `k25On` dengan definisinya sendiri.
7. **CI hijau** tidak memuat journey, matriks flag, lint K41/K42, maupun uji API Sales.
8. **"Admin tidak bisa override"** hanya benar selama Admin tidak mengubah `release_override_policy`.
9. **Semua bukti RLS dan journey** berasal dari PostgreSQL 16 + shim + mock auth, bukan Supabase. Production berbeda jauh dari lingkungan uji (A-LIVE).

---

## 7. Dashboard vs laporan keuangan (tujuan §1.3)

**Keadaan:** belum ada satu pun angka dashboard yang bisa dibuktikan sama dengan FS. Sebabnya:
- data Agustus belum lengkap dan September belum dimuat (A-LIVE-8);
- mart kosong (A-LIVE-4);
- ada perbedaan definisi.

**Yang bisa sama dengan FS bila datanya lengkap** (definisi sudah sama):
- FINAL bulan (jurnal + `closing_adjustment` posted, `lib/v4/close.ts:3-4,96`) untuk Revenue PL b.12, COGS b.13, GP b.15, NIBT b.51;
- saldo bank akhir bulan (BS b.14);
- C23 PI vs GL;
- neraca v1 pada tanggal akhir bulan (BS b.14–77, bila TB awal + DI dimuat).

**Berbeda definisi** (harus diputuskan atau diberi label):

| Angka | Bedanya |
|---|---|
| GP/NIBT "Actual · jurnal" | memuat Selisih costing + biaya idle (A-CST-4) |
| Revenue sebelum tutup buku | memuat DO belum difaktur (K11) |
| Solvabilitas, ekuitas, utang afiliasi | dari neraca mingguan, bukan akhir bulan |
| Per baris beban | `fs_mapping_reference` bergeser (A-LIVE-9) dan `pl_line` memuat akun non-tetap (B-CST-1) |
| Struktur baris | app punya 3 baris revenue dan 4 COGS, FS satu-satu |
| Bunga solvabilitas | tanpa estimasi (FS Agu 31,9 jt) |

**Tidak punya padanan FS:**
- outlook, forecast, simulasi, bulan ke ekuitas negatif;
- biaya per batch, GP produk, stok lewat umur, harga lantai;
- arus kas 13 minggu/12 bulan (FS tanpa sheet CF);
- "NIBT setelah beban tetap" sebelum bulan ditutup.

**Angka FS acuan** (dari `fixtures/fs-2026-09/inputs.json`, perlu dicocokkan ulang ke workbook asli):

| Pos | Agustus | September |
|---|---|---|
| Revenue | 8.361,8 jt | 5.039,9 jt |
| GP | 306,7 jt | −475,4 jt |
| NIBT | −26,5 jt | −910,1 jt |
| Kas | 495,4 jt | 103,0 jt |
| Ekuitas | 1.612,6 jt | 702,6 jt |

---

## 8. Requirement v5 dan v5.1 yang belum punya implementasi operasional sama sekali

1. K27: rencana per kelas × pola × fresh/frozen sebagai sumber batch.
2. Demand pola parting/boneless per kelas. Forecast di demand kelas.
3. Tugas "jawab surplus" dan konsumsi jawaban absorb/reduce ke versi rencana berikutnya.
4. Form usulan parameter → dampak → persetujuan O8.
5. Editor `size_class_map` di aplikasi.
6. Job harian untuk instance `input_task`/grid dan pengurasan antrean rebuild (tidak ada `crons`).
7. COGS forecast dari `planCost` (§4.7, Q-v5-25).
8. Proyeksi kas 12 bulan dengan NIBT setelah beban tetap.
9. C53 dihitung di DB dari tabel (bukan snapshot klien). C55 di `release_month`. C57 di **semua** jalur copy.
10. Tren revenue/GP per minggu dan tile demand per kelas di Manajemen (§6.1 baris 16–18, 30–33).
11. Grafik utang afiliasi vs ekuitas dan neraca ringkas di Kas (§4.8).
12. Bacaan parsial lintas role §8 (Q-v5-49).
13. `.xls` di Input. Upload terpadu untuk semua jenis v4.
14. Pemeriksaan versi skema saat app jalan.
15. Journey sebagai bagian dari repo dan CI. T7 satu putaran utuh.
16. Kontrol rekonsiliasi dashboard ↔ FS.

PRD v5.2-A (kode) dan v5.2-B (database) menjadikan temuan di atas requirement. Rujukan silang ada di kolom "Temuan" tiap R.
