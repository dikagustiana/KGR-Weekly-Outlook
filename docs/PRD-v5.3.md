# PRD v5.3 — Kesiapan pilot 19 Okt, simulator COGS, rute RPA sendiri vs maklon, kas lewat Google Sheet

18 Okt 2026 · Dika

## Status dan cara baca

PRD ini menambah tiga modul tanpa mengubah rumus costing: simulator COGS yang inputnya bisa diubah, rute RPA sendiri vs maklon, dan input kas lewat Google Sheet. Dokumen ini mengamendemen PRD v5, v5.1, dan v5.2. Semua pasal ketiganya tetap berlaku kecuali yang disebut di sini.

| Butir | Isi |
| --- | --- |
| Owner | Dika (Group Project Finance, SAMB) |
| Repo | `dikagustiana/KGR-Weekly-Outlook`, basis `main` `6f9757f` (merge PR #64; kode sama dengan `7d83173`) |
| Database | KGR-OS `pczjhmzpkknzkziipvit`, `schema_version()` 5.2.6; hanya lewat bagian B dengan aturan v5.2-B |
| Konteks operasional | `docs/v5.2/REVIEW-CONTEXT.md` (handoff 18 Okt): keadaan production, aturan §3, gate §4, daftar review §6 |
| Sumber angka | `202609_Data_COGS_LB.xlsx` versi 18 Okt (sha256 `82ecefe3…`; beda dari salinan di `reference/` hanya di `Pot_ISA01`, 145 sel), `KGR - Budget Manufacturing v2.xlsx`, layar `/minggu-ini/2026-08-24` per 18 Okt |

Cara baca untuk agen coding:

- Bab Kesiapan pilot milik reviewer (Fable) dan dikerjakan lebih dulu. R95 dst. milik agen pembangun. Keduanya boleh paralel; merge mengikuti aturan yang sama.
- Bab Keputusan mengikat. Butir di Pertanyaan terbuka dibangun di belakang parameter dan tidak difinalkan.
- R95–R112 adalah kode (bagian A). B-R113–B-R118 adalah database (bagian B). Penomoran melanjutkan v5.2.
- Batas, larangan, dan aturan urutan merge v5.2-A Bab 4 dan v5.2-B berlaku penuh. PR kode yang memakai objek DB baru di-merge sesudah migrasinya ada di `main` dan diterapkan di KGR-OS.
- Aturan REVIEW-CONTEXT §3 berlaku penuh: backup sebelum setiap perubahan KGR-OS, bundel dengan tabel cek, batas connector, flag hanya dengan persetujuan Dika, repo publik, "lulus" selalu dengan lingkungan, kuota deploy, CI hijau sebelum merge.
- v5.3 dikerjakan sekarang, paralel dengan review, di cabang sendiri dari `main`. Merge tidak boleh mengganggu pemakaian mulai 19 Okt: fitur di balik flag `v53_*` (admin saja), CI hijau, dan tidak ada push ke `v5.2/a8-fixes`.
- Konvensi angka sama dengan PRD v5: titik ribuan, koma desimal, "jt", minus U+2212.
- Berhenti di akhir tiap irisan untuk sign-off.

## Kesiapan pilot 19 Okt (review v5.2)

Vonis kerja untuk 19 Okt: pilot terkontrol GO. Dashboard sebagai angka resmi dan laporan manajemen final NO-GO sampai satu siklus kerja nyata terbukti benar dan terekonsiliasi. Sumbernya review eksternal GPT 18 Okt dan temuan layar di bab Masalah; semua butir adalah hipotesis sampai terbukti di kode atau tes.

Laporan kesiapan memisahkan tiga status: code complete, deployed, dan business ready (data lengkap, akses benar, angka terekonsiliasi ke sumber).

| Pemakaian 19 Okt | Vonis kerja |
| --- | --- |
| Admin dan uji pengguna | GO terbatas |
| Pelatihan Finance, Sales, PPIC dengan skenario terkontrol | GO sesudah D2, minggu 19 Okt, dan akun pengguna |
| Dashboard sebagai angka resmi operasional | NO-GO |
| Output sebagai laporan manajemen final | NO-GO |

| ID | Temuan | Lokasi atau sumber | Tingkat awal | Arah perbaikan |
| --- | --- | --- | --- | --- |
| V1 | Mart production belum pernah dibangun; tanpa service key `processRebuildQueue` mengembalikan `REBUILD_NO_KEY` | `apps/web/lib/rebuild.ts:109`; REVIEW-CONTEXT §1 | P0 | D2 → redeploy → rebuild → cocokkan nilai dashboard ke sumber |
| V2 | Belum ada bukti end-to-end dengan pengguna nyata | review GPT | P0 | satu siklus Finance, Kepala Sales, Sales, PPIC, Direktur Operasional, Manajemen; cek output dan hak akses tiap role |
| V3 | Data Agu–Sep belum lengkap: jurnal, DI, bank, stok, FINAL; `fs_line_map` 15 baris draft | REVIEW-CONTEXT §7 | P0 untuk angka resmi | B-R90 berurutan; status belum lengkap tampil apa adanya, kontrol tidak dipaksa hijau (K62) |
| V4 | Simulasi K25 memakai angka contoh: breakeven 19.466 vs aktual 23.211–24.818 | bab Masalah | P0 untuk Direktur Operasional | label contoh (R97), atau langkah data di bawah |
| V5 | Kartu Stok dan Kas berangka dengan sumber "belum ada"; satu panel mencampur empat tanggal | bab Masalah | P1 | R97, R101 |
| V6 | Sales membaca `batch` (lb_price, freight, maklon) dan `release.snapshot` lewat PostgREST | Q-v5.2-85/86 | P1; blocker bila rahasia (keputusan Dika) | outlook Sales dihitung di server dengan klien servis, baca mentah ditutup |
| V7 | Rilis mengunggah JSON dan PDF sebelum RPC `release_week`; gagal di tengah meninggalkan berkas yatim | `apps/web/lib/release.ts:100-112` | P1 | unggah ke jalur staging, finalisasi sesudah RPC berhasil, bersihkan berkas yatim |
| V8 | Klaim antrean rebuild tidak atomik: baca `queued`, lalu tandai `running` di operasi terpisah | `apps/web/lib/rebuild.ts:125-139` | P1 | update bersyarat `status = 'queued'` dengan returning; tes konkuren cron + tombol |
| V9 | Status `done` belum berarti output terekonsiliasi | `rebuild.ts`; `data_status` | P1 | completeness, freshness, dan reconciliation per mart dipisah dari status eksekusi |
| V10 | `salesRepFor()` memakai nama sebagai fallback identitas Sales | `apps/web/lib/v5/assignment.ts:90` | P1 | uji nama kembar, assignment tumpang tindih, ganti nama, deaktivasi; jangka panjang ID pengguna |
| V11 | 6 flag v5 terbuka untuk semua role tanpa T19 | Q-v5.2-103 | P1; keputusan Dika | pilot terbatas per role |
| V12 | SIAP-PAKAI menyebut production `85f7684`, handoff `6f9757f` | `docs/v5.2/SIAP-PAKAI.md` | P2 | selaraskan dengan commit yang benar-benar di production |
| V13 | Hidrasi #418 di `v5.2/a8-fixes` | REVIEW-CONTEXT §1 | P2 | merge hanya bila semua gate hijau, bukan demi tanggal |

Temuan yang terbukti dan butuh kode dikerjakan reviewer sebagai PR sendiri, dengan aturan merge dokumen ini. Temuan yang butuh objek DB baru ditulis sebagai Q-v5.3-n untuk bundel berikutnya.

### Langkah data tanpa kode (19 Okt)

Simulator K25 bisa memberi angka masuk akal besok tanpa kode baru, karena rumusnya sudah benar dan yang salah inputnya. Angka di tabel adalah rata-rata tertimbang 7 batch 24–30 Sep.

| Langkah | Halaman | Isi |
| --- | --- | --- |
| 1 | Input → Parameter minggu 19 Okt | susut 6,2%; angkut 549 Rp/kg LB; maklon 1.464 Rp/kg diproses; yield atas kg diproses: karkas 71,85%, kepala 4,91%, ceker 3,26%, usus 4,27%, HJA 6,03%, lemak 0,30% |
| 2 | Input → Upload, jenis "PPIC — yield matrix" (kelas STD, pola karkas, berlaku 19 Okt) | yield atas kg LB beli: karkas 67,39%, kepala 4,61%, ceker 3,06%, usus 4,01% (ISA saja 4,57%), HJA 5,66%, lemak 0,28% |
| 3 | Input → Harga | price list Commercial minggu ini. Karkas Fresh = harga campuran premium dan grade A (Sep: grade A 12,6% → 36.623). Kepala, ceker, lemak wajib diisi. Karkas n/a dikosongkan, jatuh ke harga Fresh |
| 4 | Master → item_map | item code karkas dipetakan supaya demand PO tidak jatuh ke n/a |

Cek hasil: di harga September, nilai jual sekitar 25.990/kg LB dan breakeven sekitar 24.070. Kas sementara lewat upload `Template_Kas_Harian.xlsx`: upload ulang file utuh, jangan hapus baris yang sudah pernah diupload, dan jangan ubah urutan baris dengan tanggal, rekening, dan kategori yang sama.

### Keputusan untuk Dika

- Kerahasiaan harga beli LB, angkut, maklon, dan `release.snapshot` bagi Sales (V6). Bila rahasia, akun Sales menunggu V6 ditutup.
- Flag v5 untuk semua role (V11): tetap, atau dipersempit selama pilot.
- Peserta pilot dan cakupan masing-masing.

## Masalah

Breakeven live bird di layar Manajemen 19.466 Rp/kg LB, sedangkan tujuh batch 24–30 Sep memberi 23.211–24.818. Semua input simulasi K25 saat ini angka contoh atau placeholder, dan selain harga LB tidak ada yang bisa diubah.

| Input simulasi | Di layar (sumber) | Aktual 24–30 Sep (WP COGS LB) |
| --- | --- | --- |
| Harga karkas | 13.118 kg sebagai `RPA\|Karkas\|n/a` @ 30.000 (`supabase/seed/06_sku_price.sql:32`, catatan "contoh"); `Karkas\|Fresh` 0 kg | premium 37.000, grade A 34.000 (Price list Week 4) |
| Harga kepala, ceker | 4.029 dan 3.101 (seed `:24`, `:20`, "contoh") | 9.500 dan 16.000 |
| Harga lemak fresh | kosong (seed `:26`, "ISI harga acuan") | 24.000 |
| Yield | `yield_matrix` STD "Placeholder: yield v1 × (1 − 0,03)": karkas 71,46% dari kg LB beli | karkas 70,2–72,9% dari kg diproses; susut 5,0–7,3% |
| Angkut + potong | default `parameter`: angkut 1.000/kg LB, maklon 1.600/kg diproses, susut 3% → 2.552/kg LB (`apps/web/lib/v5/ppic-data.ts:179`) | angkut 387–858/kg LB; potong 1.441–1.500/kg diproses |
| Nilai jual per kg LB beli | 22.017 | 25.215–26.665 |

Masalah lain yang ditangani dokumen ini:

- **Demand karkas tak termapping.** Seluruh demand karkas minggu itu jatuh ke `RPA|Karkas|n/a` (`ppic-data.ts:183-184`) dan dihargai dengan harga n/a sendiri, bukan harga Fresh/Frozen.
- **Input terkunci.** Output dihitung dari demand ÷ yield STD (`needBasisOutputs`, `packages/engine/src/costing.ts:478`). PPIC dan Direktur Operasional tidak bisa mengulang hitungan WP COGS LB.
- **Kolom Margin/kg tidak informatif.** Dengan alokasi joint, COGS/kg = k × harga acuan, jadi semua SKU punya % margin sama (layar sendiri menulis "COGS 123% dari harga list").
- **Rute RPA sendiri belum ada di simulator.** `needCost` dihitung tanpa overhead (`ppic-data.ts:187`). Trigger `tg_batch_cost_mode` (`supabase/migrations/20261019000100_v4_release.sql:274-283`) mengubah setiap batch maklon bertanggal ≥ 1 Nov 2026 menjadi own, jadi luapan ke maklon sesudah Rawa Terate jalan tidak bisa dicatat.
- **Kunci baris kas posisional.** Upload `cash_daily` membuat `line_key` `tanggal|rekening|kategori|n` (`apps/web/lib/v3/cash.ts:231-236`). Menyisipkan baris menggeser kunci dan menimpa baris lain; baris yang dihapus dari file tetap hidup di DB.
- **Tanggal campur.** Minggu terpilih 24–30 Agu, tanggal potong "Sen 19/10" dari jam dinding, label "Data per 27 Agu", stempel "16 Okt 00.37".
- **Angka tanpa sumber.** Kartu Stok (2.782,2 jt) dan Kas (289,7 jt) tampil berangka dengan label sumber "belum ada". 289,7 jt adalah angka parity workbook (`docs/parity.md:342`), bukan data Finance.

## Keputusan

Rumus costing tidak berubah; yang berubah adalah siapa yang mengisi input, dari sumber mana, dan rute produksi mana yang dihitung.

| ID | Keputusan | Pemilik | Status |
| --- | --- | --- | --- |
| K71 | Simulator memakai `planCost` apa adanya: k = biaya ÷ nilai jual, COGS/kg SKU = k × harga acuan. Ini identik dengan sheet Pot_ di WP COGS LB. | Dika | ditetapkan |
| K72 | Daftar SKU output, kg atau yield, harga acuan, harga LB, susut, angkut, dan tarif proses semuanya input yang bisa diubah. Basis yield = kg diproses; kg SKU = kg LB beli × (1 − susut) × yield. Setiap input membawa label sumbernya. | Dika (18 Okt) | ditetapkan |
| K73 | Rute per batch: `own` (Rawa Terate) atau `maklon` dengan nama RPA. Mulai 1 Nov default own; maklon tetap boleh untuk luapan. Lot dan SKU mewarisi rute dari batch. | Dika (18 Okt) | ditetapkan |
| K74 | Perbandingan rute memakai biaya tambahan. Biaya penuh tampil untuk keputusan jangka panjang. Overhead own dibebankan pada volume normal; selisihnya masuk "Biaya kapasitas idle" (PRD v4 §3.5, Q63), tidak masuk COGS/kg SKU. | Dika (18 Okt) | ditetapkan |
| K75 | Volume normal adalah parameter periode milik Finance (`overhead_rate.basis_kg`). Volume mingguan dan rute per batch datang dari rencana PPIC. Simulator tidak punya input volume mingguan sendiri; override what-if hanya disimpan saat "Putuskan". | Dika (18 Okt) | ditetapkan |
| K76 | Google Sheet menjadi pintu input kas Finance; Supabase tetap system of record. Arus satu arah Sheet → app lewat jalur staged → commit yang sama dengan upload `cash_daily`. Service account read-only; kunci baris `id_baris` dari template. | Dika (18 Okt) | ditetapkan |

## Tujuan terukur

Lima tes menentukan selesai; T24 adalah golden yang mengikat simulator ke WP COGS LB.

| ID | Lulus bila |
| --- | --- |
| T24 | Input `Pot_ISA30` (LB 18.793,7 kg @ 24.800; angkut 9.000.000; potong 25.811.001; output per baris sheet) menghasilkan biaya 500.894.761, nilai jual 477.473.300, GP −23.421.461, GP ÷ nilai jual −4,91%, GP ÷ biaya −4,68%, COGS/kg premium 38.814,96, grade A 35.667,80, breakeven 23.553,8. Toleransi Rp 1 untuk total, 0,01 untuk per kg. |
| T25 | Minggu 24 Agu dengan data seed: tile K25 memberi label "contoh" pada harga, yield, dan tarif, C60 PERIKSA, dan breakeven tidak tampil tanpa label. |
| T26 | Batch own yang sama pada 50% dan 100% volume normal: COGS/kg SKU identik; selisih biaya sama dengan baris kapasitas idle = 50% × biaya tetap minggu itu. |
| T27 | Batch 3 Nov 2026 dengan `rpa` = "RPB-RPA" tersimpan sebagai maklon; batch 3 Nov tanpa `rpa` tersimpan sebagai own. |
| T28 | Sheet kas: sisip baris, urut ulang, hapus baris, dan isi baris baru → DB mengikuti per `id_baris`. Edit baris bertanggal minggu yang sudah rilis tidak diterapkan dan muncul di C62. |

## A1 — Simulator COGS input-driven (R95–R101)

Irisan ini membuat tile K25 bisa mengulang hitungan sheet Pot_ dengan input yang diisi pengguna, dan menandai setiap angka contoh.

**R95 [engine] (K71, K72)** · `packages/engine/src/costing.ts:405-442, 518-528`.

Spesifikasi:

- Fungsi murni baru `simulateCogs` untuk satu rute, memanggil `planCost`. Input: kg LB beli, ekor (opsional), harga LB, susut, angkut (truk × tarif, per kg LB, atau aktual), biaya proses (tarif + basis: per kg LB, per kg diproses, per ekor), dan baris output `{key, yield | kg, priceRef, priceSource}`.
- Tiap baris output mengisi salah satu dari yield atau kg; yang lain diturunkan: kg = kg LB beli × (1 − susut) × yield.
- Output: biaya per komponen, nilai jual, k, GP, GP ÷ nilai jual (label "% dari nilai jual"), GP ÷ biaya (label "markup atas biaya, sama dengan Est. GP Margin WP"), nilai jual dan biaya per kg LB beli, breakeven LB.
- Per SKU: kg, yield atas kg diproses, yield atas kg LB beli, nilai jual, kontribusi per kg LB (nilai ÷ kg LB beli), COGS/kg sebagai referensi.
- Dua sensitivitas: Δ nilai per kg LB untuk +1 poin yield karkas (semua key karkas) dan untuk +Rp 1.000 harga karkas.
- Kosong ≠ 0 (R62): yield, harga, atau tarif kosong → nilai baris null dan masuk `missing`; breakeven null bila tarif kosong.
- `simulateLivebird` tetap ada sebagai pembungkus supaya pemanggil lama tidak berubah.

Bukti: T24; `costing-v5.test.ts` dan `scripts/costing-sim-golden.ts` tetap hijau; parity 17.161/17.161; `snapshot:diff` kosong.

**R96 [sumber input] (K72)** · `apps/web/lib/v5/ppic-data.ts:150-240`; `apps/web/lib/v5/management-data.ts:46-70`.

Spesifikasi:

- Chip basis: "Kebutuhan PO" dan "Batch rencana" tetap; tambah "Batch terakhir", "Rata-rata 28 hari" (keduanya per RPA), dan "STD".
- Harga acuan: `price_list_week` yang dikunci untuk minggu potong → `sku_price` minggu itu → kosong.
- Yield dan susut: Σ kg output ÷ Σ kg diproses dari `batch` + `batch_output_sku` status Aktual 28 hari terakhir, per RPA. Batch tanpa output, dengan `processed_kg` kosong, atau `processed_kg > lb_kg` (susut negatif) dikeluarkan. Fallback STD.
- Angkut dan tarif proses: `route_tariff` yang berlaku (⛓ B-R114) → rata-rata aktual 28 hari per RPA (`freight ÷ lb_kg`, `maklon ÷ processed_kg`) → `parameter`.
- Setiap input menampilkan label sumber dan cakupannya, misalnya "rata-rata 28 hari ISA, 5 batch" atau "Price list dikunci 26/09".

Bukti: tes loader dengan fixture September; `Pot_ISA10`, `Pot_ISA09 (2)`, `Pot_ISA03` dikeluarkan karena susut negatif; yield karkas ISA sama dengan hitungan manual dari fixture.

**R97 [label contoh] (K72, K41) — C60** · tile `sim-lb`; kartu `c-stok`, `c-kas`.

Spesifikasi:

- Setiap input diklasifikasikan: `aktual`, `kontrak`, `price_list`, `override`, atau `contoh`.
- `contoh` = catatan seed diawali "contoh", "Placeholder", atau "ISI"; nilai `parameter` yang sama dengan default kolom; atau `parameter.placeholder_note` terisi.
- Input `contoh` → badge "contoh" di selnya; COGS, GP, breakeven, dan margin per kg LB berlabel "berisi angka contoh"; C60 PERIKSA menyebut inputnya.
- "Putuskan" tetap bisa dipakai (keputusan milik Direktur Operasional, K25), tetapi status contoh ikut tersimpan (R100).
- Kartu Manajemen yang angkanya berasal dari seed atau workbook parity berlabel "contoh", bukan "belum ada".

Bukti: T25.

**R98 [demand tak termapping]** · `ppic-data.ts:183-185`; ⛓ B-R117.

Spesifikasi:

- `RPA|Karkas|n/a` tidak punya harga acuan sendiri. Kg-nya dihargai dengan harga Fresh minggu itu, berlabel "demand belum termapping: n kg dari m item_code" dengan tautan ke `item_map`.
- Harga Fresh kosong → baris itu null (R62), bukan harga n/a.

Bukti: probe minggu 24 Agu: 13.118 kg tampil sebagai demand tak termapping dengan harga Fresh dan labelnya.

**R99 [UI simulator] (K25, K72)** · `apps/web/lib/v5/management.ts:148-195`; `apps/web/components/v5/`.

Spesifikasi:

- Input yang bisa diubah: chip basis, harga LB (chip + isian bebas), kg LB beli, susut, angkut, biaya proses, dan tabel output.
- Kolom tabel: SKU · yield % kg diproses · kg · harga acuan · nilai jual · kontribusi per kg LB · COGS/kg (referensi). Toggle yield↔kg per baris; tambah/hapus baris dari `sku_key` segmen RPA.
- Kolom Margin/kg dihapus. Gantinya satu kalimat hidup: "Dengan alokasi joint, setiap SKU memikul k = …% dari harga acuan."
- Peringatan bila total yield atas kg diproses di luar rentang parameter (O43).
- Ringkasan: biaya, nilai jual, GP dengan kedua % berlabel, nilai jual dan biaya per kg LB, breakeven, margin per kg LB, dan dua sensitivitas R95.
- Override disimpan di query URL (bisa dibagikan, tidak ke DB), dengan tombol "kembali ke basis".
- Hak ubah what-if: `operations_director`, `ppic`, `finance`, `admin`. Peran lain hanya baca.

Bukti: screenshot 1366/899/390; tes layar: ubah yield karkas +1 poin → nilai per kg LB naik sebesar sensitivitas yang tertulis.

**R100 [dasar keputusan] (K25, K75) ⛓ B-R115** · `apps/web/lib/v5/lb-decision.ts:15-30`.

Spesifikasi: "Putuskan" menyimpan `sim_inputs` (semua input + label sumber + flag contoh) dan `sim_result` (angka ringkasan) bersama keputusan. Halaman keputusan menampilkan dasar keputusan itu.

Bukti: e2e putuskan → baris `lb_price_decision` berisi kedua kolom.

**R101 [tanggal] (K38)** · `management-data.ts:32-35`.

Spesifikasi:

- Bila minggu terpilih bukan minggu yang memuat tanggal potong besok (jam dinding), tile menjadi baca-saja dan berlabel "minggu lampau, simulasi saja". Tombol "Putuskan" tidak tampil.
- Tanggal potong diambil dari `plan_day` terakhir minggu itu, label data dari tanggal data minggu itu.
- Stempel waktu tampil per sumber input, bukan satu stempel untuk seluruh tile.

Bukti: screenshot minggu 24 Agu diambil 18 Okt.

## A2 — Rute RPA sendiri vs maklon (R102–R106)

Irisan ini memungkinkan satu minggu berisi batch Rawa Terate dan batch maklon sekaligus, lalu menampilkan biaya keduanya berdampingan.

**R102 [rute batch] (K73) ⛓ B-R113** · upload `ops_batch` (`apps/web/lib/upload.ts:228`); parser WP (`packages/parsers/src/costing-wp.ts`); `apps/web/app/w/[week]/batch/page.tsx`.

Spesifikasi:

- Kolom `rpa` diisi di input dan upload batch. Batch maklon wajib menyebut RPA; batch own boleh kosong.
- Parser WP mengisi `rpa` dari dokumen biaya potong bila polanya dikenal (`RPB-RPA/…` → "RPB-RPA"); selain itu diisi manual.
- `allocateBatch` tidak berubah; ia sudah menangani own dan maklon (`costing.ts:155-162`).
- Stok dan COGS per SKU bisa difilter per rute lewat `lot.batch_id → batch.cost_mode, batch.rpa`.

Bukti: T27; tes upload `ops_batch` 2 Nov dengan `rpa` terisi → maklon.

**R103 [pembagian volume] (K73, K75)** · `apps/web/lib/v5/ppic-data.ts`; `apps/web/lib/v5/copy-plan.ts`; tabel `capacity`.

Spesifikasi:

- Simulator membaca rencana PPIC minggu itu per hari: kg LB tiap batch rencana beserta rutenya.
- Batch rencana tanpa rute: own sampai kapasitas hari itu (`capacity.cut_capacity_head × weight_class.avg_kg`), sisanya maklon ke RPA maklon terakhir. Kelebihan dihitung per hari, bukan per minggu.
- Override what-if: kg LB own per hari, dibatasi kapasitas; nilai di atas kapasitas memberi peringatan.
- Hasil tampil dalam tiga kolom: own, maklon, gabungan.

Bukti: tes rencana 5 hari dengan hari ke-3 di atas kapasitas → kelebihan hari itu masuk maklon walau total minggu di bawah kapasitas.

**R104 [biaya RPA sendiri] (K74) ⛓ B-R114** · `packages/engine/src/costing.ts:313-323, 610-628`.

Spesifikasi:

- Biaya own = biaya variabel (`route_tariff` own: tenaga kerja, kemasan, utilitas variabel; per kg LB atau per ekor) + overhead terbebankan = `overhead_rate.rate_per_kg_lb` × kg LB own.
- Biaya kapasitas idle minggu itu = max(0, basis minggu − kg LB own) × tarif, dengan basis minggu = `basis_kg` × hari minggu ÷ hari periode, sama dengan `idleCostDaily`.
- Baris kapasitas idle tampil sendiri di bawah kolom rute dan tidak masuk COGS/kg SKU.
- Breakeven own tampil dua: atas biaya tambahan (tanpa overhead tetap) dan atas biaya penuh.
- Biaya variabel own kosong → kolom own null dengan label "biaya variabel RPA sendiri belum diisi" (R62). Angka budget tidak dipakai sebagai fallback.

Bukti: T26.

**R105 [perbandingan rute] (K74)**

Spesifikasi:

- Baris "biaya tambahan per kg LB": maklon = tarif potong + angkut ke RPA maklon + blasting untuk porsi beku; own = biaya variabel own.
- Komponen yang ada di kedua rute (LB, susut, storage gudang sendiri, kirim ke pelanggan) tetap tampil tetapi tidak masuk selisih. Lingkup tarif maklon mengikuti O42.
- Label tetap: "Biaya penuh RPA sendiri tidak dipakai untuk membandingkan rute selama kapasitas masih tersisa." Bila kapasitas own penuh, baris selisih diganti "kapasitas RPA sendiri penuh".
- Tidak ada label rekomendasi (K25).

Bukti: tes dua kondisi kapasitas (tersisa, penuh).

**R106 [yield per RPA] (K72)**

Spesifikasi:

- Default yield, susut, dan porsi grade per RPA diambil dari R96. Di 24–30 Sep, porsi grade A atas kg diproses AGRO 14,4–23,6% dan ISA 5,2–10,0%; batch AGRO tidak mencatat usus dan lemak.
- "Rata-rata 28 hari" butuh minimal 3 batch aktual per RPA. Rawa Terate belum punya riwayat sebelum 1 Nov, jadi default own memakai STD berlabel contoh sampai syarat itu terpenuhi.

Bukti: dengan fixture September, default AGRO berbeda dari ISA dan sama dengan hitungan manual.

## A3 — Kas lewat Google Sheet (R107–R112)

Finance mengisi saldo dan rencana kas di satu Google Sheet. App menariknya ke jalur upload `cash_daily` yang sudah ada, dengan kunci baris stabil dan penjaga untuk minggu yang sudah rilis.

**R107 [adapter] (K76) ⛓ B-R116, B-R118** · `apps/web/lib/v3/cash.ts:220-275`; `packages/parsers/src/v3-tables.ts:96-116`.

Spesifikasi:

- Modul baru `apps/web/lib/v5/gsheet-kas.ts` membaca tab `Saldo` dan `Rencana` lewat Sheets API v4 `values.batchGet`, scope `spreadsheets.readonly`, dengan kredensial service account. ID spreadsheet ada di `app_setting.gsheet_kas`.
- Nilai yang dibaca dinormalisasi lalu lewat `stage` → `commit` kind baru `cash_gsheet`, memakai field `cash_balance` dan `cash_plan_daily` ditambah kolom Lampiran C.
- `upload.file_name` = judul spreadsheet + waktu baca; `file_sha256` = sha256 nilai ternormalisasi; `source` = `GSheet`. Hash sama dengan sinkron committed terakhir → tidak ada upload baru, dicatat "tidak ada perubahan".
- Upload xlsx `cash_daily` tetap ada. Baris ber-`source` `GSheet` tidak boleh ditimpa upload xlsx dan sebaliknya; tabrakan menjadi issue.
- Status Sheet dipetakan: rencana → `plan`, realisasi → `done` (+ `done_date`), batal → `cancelled`.

**R108 [kunci baris] (K76)**

Spesifikasi:

- Rencana: kunci = `id_baris` yang sudah tercetak di template (`K-000001`…`K-010000`, kolom diproteksi); `line_key` = `gs|<id_baris>`. Urutan baris tidak berpengaruh.
- Saldo: kunci alami (tanggal, no_rekening).
- Baris berisi data tanpa `id_baris` → ditolak dengan alasan "baris disisipkan; pindahkan isinya ke baris kosong di bawah". `id_baris` ganda → kemunculan kedua dan seterusnya ditolak.
- `id_baris` yang ada di sinkron committed terakhir tetapi hilang sekarang → `deleted_at` di minggu terbuka, atau koreksi tertunda di minggu rilis (R109).

**R109 [penjaga rilis] — C62**

Spesifikasi:

- Baris bertanggal di minggu yang sudah punya `release`, dengan nilai berbeda dari versi committed, tidak diterapkan. Baris itu masuk `cash_correction_pending` (⛓ B-R116) dan C62 PERIKSA.
- Halaman Input menampilkan sebelum/sesudah. Persetujuan Finance atau admin → diterapkan, dicatat di `audit_log`, rebuild diantrekan (`queueThroughNote`). Penolakan tetap tercatat.

**R110 [pemicu] — C63** · `apps/web/app/api/cron/`; `apps/web/vercel.json`.

Spesifikasi:

- Tombol "Sinkron sekarang" di `/input` untuk `finance` dan `admin` menulis dengan klien sesi (RLS), sama seperti upload. Tanpa D2 data tetap masuk; rebuild mengikuti `REBUILD_NO_KEY`.
- Endpoint `/api/cron/gsheet-kas` dengan Bearer `CRON_SECRET`, sama seperti `/api/cron/rebuild`. Jalur ini tidak punya sesi, jadi menulis dengan klien servis dan mencatat pelaku `gsheet-sync` di kolom audit; jalur ini butuh D2.
- Cron Vercel repo ini hanya sekali sehari (`0 22 * * *`), jadi jadwal 30 menit berjalan lewat GitHub Actions (O40).
- C63 PERIKSA bila sinkron berhasil terakhir lebih dari 3 jam pada 07.00–21.00 WIB hari kerja.

**R111 [validasi] — C61**

Spesifikasi:

- `kategori_cf` ∈ `CF_CATEGORIES` (`packages/engine/src/statements.ts:192`); `no_rekening` ∈ `bank_account` aktif; `jumlah` angka ≠ 0; tanggal dalam −13 s.d. +13 minggu dari tanggal data; `status` ∈ rencana/realisasi/batal; realisasi wajib `tanggal_realisasi`.
- "Pinjaman afiliasi (net)" dan "Transfer antar rekening" hanya dari dropdown, karena `dayPlanFlows` memisahkan keduanya (`cash.ts:164-172`).
- Baris ditolak tampil di `/input` dengan nomor baris Sheet dan alasannya; C61 PERIKSA selama ada. Baris valid lain tetap diterapkan.

**R112 [keamanan dan template]**

Spesifikasi:

- Kunci service account hanya di env Vercel `GOOGLE_SA_KEY_JSON` (dan secret GitHub bila O40 memakai Actions). Repo publik: kunci tidak boleh ada di kode, fixture, maupun log.
- Spreadsheet dibagikan ke email service account sebagai Viewer; editor hanya Finance.
- Template `reference/templates/Template_Kas_GSheet.xlsx` (Lampiran C) di-commit. Tes membandingkan dropdown template dengan `CF_CATEGORIES`.

Bukti irisan: T28 dengan fixture `fixtures/gsheet-kas/` (mock respons `values.batchGet`) untuk sisip, urut ulang, hapus, ID ganda, ID kosong, dan edit minggu rilis.

## B — Database (B-R113–B-R118)

Enam perubahan skema dan satu pembersihan data, dikirim sebagai satu bundel v5.3 dengan pola v5.2-B: backup dalam DB (B-R93), satu panggilan atomik, tabel cek semua true, sidik skema dibandingkan PG16 lokal, lalu `schema_version()` = 5.3.0.

Pelaksanaan bundel mengikuti REVIEW-CONTEXT §3:

- Migrasi baru bernama berurutan sesudah `20261025000700`. Bundel `docs/v5.3/kgr-os-migrasi-v53-b1.sql` = prasyarat + migrasi apa adanya + `bundle_sha256` + `notify pgrst` + tabel cek.
- Backup `bak_<UTC>` lewat `docs/v5.2/kgr-os-backup.sql` lebih dulu; setiap langkah dicatat di `docs/v5.2/kgr-os-log.md`.
- Sidik skema `docs/v5.2/bukti/schema-fingerprint-all.sql`: 9 kategori identik dengan PG16 lokal.
- Teks SQL lewat connector tanpa escape `\uXXXX`; backslash dibangun dengan `chr(92)`. Perubahan data (backfill B-R113, B-R117) butuh konfirmasi pengguna; jawaban `cancelled` berarti berhenti.
- Baris `app_setting` baru (B-R118 dan flag `v53_*`) masuk bundel dalam keadaan mati. Menyalakannya dan mengisi `spreadsheet_id` hanya dengan persetujuan Dika di percakapan.

**B-R113 [rute batch] (K73)** · `supabase/migrations/20261019000100_v4_release.sql:274-283`.

- `batch.rpa text` (nullable).
- Trigger `tg_batch_cost_mode` diganti: tanggal ≥ 2026-11-01, `cost_mode` = `maklon`, dan `rpa` kosong → `own`. Bila `rpa` terisi, `maklon` dipertahankan.
- Constraint: `cost_mode <> 'maklon' or date < '2026-11-01' or rpa is not null`.
- ✎ Backfill opsional `rpa` batch September dari `document_ref` (pola `RPB-RPA/…`), hanya sesudah Finance menyetujui daftarnya.

**B-R114 [`route_tariff`] (K74)**

- Kolom: `route` (own/maklon), `rpa`, `effective_from`, `effective_to`, `fee_basis` (per_kg_lb/per_kg_processed/per_head), `fee`, `blast_per_kg_frozen`, `freight_per_kg_lb`, `variable_basis` (per_kg_lb/per_head), `variable_rate`, `scope_note`, `source`, `note`, kolom audit standar, `deleted_at`.
- Unik `(route, rpa, effective_from)` nulls not distinct.
- RLS: baca untuk semua peran internal kecuali Sales; tulis `finance` dan `admin`.
- Tanpa seed. Finance mengisi; sebelum terisi, R96 memakai rata-rata aktual dan R104 menampilkan null.

**B-R115 [dasar keputusan] (K25)** · `lb_price_decision.sim_inputs jsonb`, `lb_price_decision.sim_result jsonb`, keduanya nullable. RLS tidak berubah (Sales tetap tidak bisa membaca `lb_price_decision`).

**B-R116 [kas Sheet] (K76)**

- Constraint `source` di `cash_daily` dan `cash_daily_plan` ditambah nilai `GSheet`.
- `cash_daily_plan`: kolom `document_ref`, `counterparty`, `entered_by` (text, nullable).
- Tabel `cash_correction_pending`: `upload_id`, `target` (cash_daily/cash_daily_plan), `row_key`, `before jsonb`, `after jsonb`, `status` (pending/approved/rejected, default pending), `decided_by`, `decided_at`, `created_at`. RLS `finance` dan `admin`.

**B-R117 [harga n/a] (R98)** ✎ · `sku_price` key `RPA|Karkas|n/a`: `ref_sell_price` = null, catatan "n/a memakai harga Fresh (R98)". Seed `06_sku_price.sql:32` disesuaikan. Baris `Trading|Karkas|n/a` tidak disentuh.

**B-R118 [setelan]** · `app_setting` key `gsheet_kas` = `{"spreadsheet_id": null, "enabled": false, "tabs": {"saldo": "Saldo", "rencana": "Rencana"}}`; `EXPECTED_SCHEMA` di kode naik ke 5.3.0 dalam PR terpisah sesudah bundel diterapkan.

## Irisan dan urutan merge

B-R113 dan R102 harus hidup di KGR-OS dan production sebelum 1 Nov 2026, karena batch pertama Rawa Terate dan luapan maklon mulai hari itu. Tanggal itu batas paling lambat, bukan tanggal mulai. Prioritas kerja: A1 lebih dulu karena simulator dipakai Direktur Operasional sekarang, lalu B1 + A2a, A2, dan A3.

| Irisan | Branch | R | ⛓ | Selesai bila |
| --- | --- | --- | --- | --- |
| B1 | `v5.3/b1-schema` | B-R113–B-R118 | — | bundel diterapkan, tabel cek semua true, sidik skema cocok, `schema_version()` 5.3.0 |
| A2a | `v5.3/a2a-rpa` | R102 | B-R113 | T27; input batch menerima `rpa` |
| A1 | `v5.3/a1-simulator` | R95–R101 | R98 → B-R117; R100 → B-R115 | T24, T25; screenshot 1366/899/390 |
| A2 | `v5.3/a2-route` | R103–R106 | B-R114 | T26 |
| A3 | `v5.3/a3-gsheet-kas` | R107–R112 | B-R116, B-R118; O40 | T28 |

Aturan:

- Satu branch dan satu PR per irisan. Setiap irisan menjalankan gate REVIEW-CONTEXT §4: `pnpm typecheck` (cek exit code), `pnpm test`, `pnpm parity` 17.161/17.161, `pnpm snapshot:diff` kosong, `test-rls.sh`, empat lint, dan `pnpm e2e` dengan `E2E_STRICT_XFAIL=1`.
- R95–R97, R99, dan R101 tidak memakai objek DB baru, jadi dikerjakan dan di-merge lebih dulu tanpa menunggu B1. R98 dan R100 menyusul sesudah B1 diterapkan.
- A3 boleh dikerjakan paralel dengan A2, tetapi pemicu terjadwal (R110) baru aktif sesudah D2 (`CRON_SECRET` di Vercel) dan O40 diputuskan.
- Vercel Hobby ±100 deploy per hari: merge dikumpulkan, status "Vercel" di commit `main` dicek sesudah merge.

## Pengujian dan fixture

Tiga fixture baru dan satu penyegaran; semuanya dibuat dari berkas sumber dengan sha256 tercatat, tanpa angka diketik ulang.

| Fixture | Isi | Sumber |
| --- | --- | --- |
| `fixtures/sim-2026-09-isa30/` | `inputs.json` (LB, angkut, potong, kg diproses, baris output key/kg/harga) dan `golden.json` (angka T24) | `Pot_ISA30`, lewat `scripts/extract_fixtures.py` |
| `fixtures/sim-own-idle/` | Satu batch own pada 50% dan 100% volume normal; biaya tetap dan `basis_kg` sintetis berlabel ilustratif | dibuat tes, bukan data KGR |
| `fixtures/gsheet-kas/` | Respons mock `values.batchGet`: dasar, sisip, urut ulang, hapus, ID ganda, ID kosong, edit minggu rilis | dibuat tes |
| `fixtures/costing-2026-09/` (segarkan) | Hanya `Pot_ISA01` berubah; golden sheet lain tetap | berkas COGS LB versi 18 Okt, sesudah Dika meng-commit ke `reference/` |

Tes per lapisan:

- **Engine:** golden T24; turunan yield↔kg; kosong ≠ 0; dua sensitivitas; idle own T26.
- **Web:** pengecualian batch di loader R96; klasifikasi contoh R97 (catatan seed, default `parameter`, `placeholder_note`); demand n/a R98; minggu lampau baca-saja R101.
- **DB:** `test:rls` untuk `route_tariff` dan `cash_correction_pending`; trigger B-R113 (T27) di PG16.
- **e2e:** putuskan harga dengan `sim_inputs`; skenario sinkron Sheet lewat mock; C60–C63 muncul di daftar kontrol.

Rollout memakai flag `v53_sim`, `v53_route`, dan `v53_gsheet_kas` di `app_setting`, terbuka untuk `admin` saja sampai sign-off per irisan.

Setiap klaim lulus menyebut lingkungannya ("vitest", "PG16 lokal + shim", "KGR-OS (connector)", "CI run N"). Repo publik: fixture baru hanya menyimpan kode RPA dan angka, tanpa nama pemasok, nomor faktur, nomor rekening asli, atau e-mail.

## Pertanyaan terbuka

Lima butir dibangun di belakang parameter dengan default di bawah; agen tidak memfinalkannya.

| ID | Pertanyaan | Default sementara | Pemilik |
| --- | --- | --- | --- |
| O40 | Pemicu sinkron 30 menit: GitHub Actions schedule (butuh secret `CRON_SECRET` di repo, D4) atau Vercel Pro | GitHub Actions; sebelum secret ada, hanya tombol manual + cron harian | Dika |
| O41 | Biaya variabel Rawa Terate per kg LB atau per ekor (tenaga kerja borongan, kemasan, utilitas). Budget v2 mencatat variabel Rp 824/kg LB, tetapi storage 347 dan kemasan 259 di dalamnya juga terjadi di rute maklon; Pool C JTS (fee bulanan) adalah biaya tetap | kosong → kolom own null (R104) | Finance |
| O42 | Lingkup tarif maklon per RPA: potong saja, atau termasuk kemas, blasting, storage | potong saja; blasting di `route_tariff.blast_per_kg_frozen` | Finance, PPIC |
| O43 | Rentang wajar total yield atas kg diproses. 24–30 Sep: ISA 90,5–92,3%; AGRO 84,3–85,3% (tanpa usus dan lemak) | peringatan di luar 84–93% | PPIC |
| O44 | Alokasi di simulator: joint (relative sales value, sama dengan WP) atau NRV dengan kredit by-product (`ByProductMethod` `nrv` sudah ada) | joint. Total GP dan breakeven tidak berubah; valuasi persediaan tetap mengikuti setelan M1 dan SOP v2.1 | Dika |

## Checklist eksekusi

Enam langkah Dika membuka jalan; sesudah itu agen bekerja per irisan dan berhenti untuk sign-off.

Dika, sebelum agen mulai:

- [ ] Putuskan apakah `202609_Data_COGS_LB.xlsx` boleh ada di repo publik. Isinya nama pemasok, harga LB, dan nomor faktur; salinan lama sudah publik di `reference/`.
- [ ] Bila boleh, commit versi 18 Okt ke `reference/`, menggantikan salinan lama.
- [ ] Commit `Template_Kas_GSheet.xlsx` ke `reference/templates/`.
- [ ] D2: `SUPABASE_SERVICE_ROLE_KEY` dan `CRON_SECRET` di Vercel Production.
- [ ] Buat Google Sheet dari template, bagikan ke email service account sebagai Viewer, simpan `GOOGLE_SA_KEY_JSON` di env Vercel.
- [ ] Putuskan O40–O44 atau terima default.

Agen coding:

- [ ] Baca `docs/v5.2/REVIEW-CONTEXT.md`, PRD v5, v5.1, v5.2-A, v5.2-B, lalu dokumen ini. Basis `main` `6f9757f`.
- [ ] B1: backup → bundel → tabel cek → sidik skema → `schema_version()` 5.3.0.
- [ ] A2a sebelum 1 Nov, lalu A1 → A2 → A3, satu PR per irisan, berhenti untuk sign-off di akhir tiap irisan.
- [ ] Setiap ketidakjelasan ditulis sebagai Q-v5.3-n di `docs/v5/QUESTIONS.md`; O40–O44 tidak difinalkan.

Larangan selama v5.3 sama dengan v5.2: tidak mengubah env Vercel atau flag production, tidak menjalankan SQL di luar bundel B1, dan tidak menaruh kunci apa pun di repo.

## Lampiran

### A. Golden `Pot_ISA30` per kelompok SKU

Batch 30 Sep 2026: LB 18.793,7 kg dibeli @ 24.800, 17.568,9 kg diproses (susut 6,52%), biaya total 500.894.761, k = 1,049053.

| Kelompok | kg | Yield atas kg diproses | Harga acuan | Nilai jual | COGS/kg |
| --- | --- | --- | --- | --- | --- |
| Karkas premium | 10.787,6 | 61,40% | 37.000 | 399.141.200 | 38.814,96 |
| Karkas grade A | 1.540,9 | 8,77% | 34.000 | 52.390.600 | 35.667,80 |
| HJA (giblet) | 1.084,1 | 6,17% | 4.500 | 4.878.450 | 4.720,74 |
| Kepala | 957,7 | 5,45% | 9.500 | 9.098.150 | 9.966,00 |
| Usus | 887,0 | 5,05% | 1.500 | 1.330.500 | 1.573,58 |
| Ceker | 580,5 | 3,30% | 16.000 | 9.288.000 | 16.784,85 |
| Lemak | 56,1 | 0,32% | 24.000 | 1.346.400 | 25.177,27 |
| Total | 15.893,9 | 90,47% | — | 477.473.300 | — |

### B. Batch 24–30 Sep 2026 (bukti default)

| Batch | kg LB beli | Susut | LB Rp/kg | Angkut Rp/kg LB | Potong Rp/kg diproses | Karkas % diproses | Grade A % diproses | Nilai jual Rp/kg LB | Breakeven Rp/kg LB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ISA30 | 18.793,7 | 6,52% | 24.800 | 479 | 1.469 | 70,17% | 8,77% | 25.406 | 23.554 |
| ISA29 | 19.357,6 | 5,73% | 25.000 | 387 | 1.441 | 72,12% | 9,54% | 26.191 | 24.445 |
| ISA28 | 19.855,3 | 6,15% | 25.000 | 529 | 1.441 | 72,92% | 10,02% | 26.347 | 24.466 |
| ISA25 | 16.426,9 | 5,01% | 25.000 | 457 | 1.465 | 72,42% | 5,15% | 26.665 | 24.818 |
| AGRO25 | 3.379,1 | 5,81% | 25.000 | 444 | 1.500 | 71,25% | 23,63% | 25.275 | 23.418 |
| ISA24 | 19.588,3 | 7,03% | 25.500 | 858 | 1.481 | 72,06% | 5,81% | 25.949 | 23.714 |
| AGRO24 | 9.800,1 | 7,25% | 25.500 | 612 | 1.500 | 71,20% | 14,42% | 25.215 | 23.211 |

Breakeven = (nilai jual − angkut − potong) ÷ kg LB beli. Sumber: sheet `Pot_*` di `202609_Data_COGS_LB.xlsx` versi 18 Okt.

### C. Kolom template Google Sheet

| Tab | Kolom | Ke kolom DB |
| --- | --- | --- |
| Saldo | tanggal · no_rekening · saldo_awal · saldo_akhir · catatan | `cash_daily` (sama dengan template xlsx lama) |
| Rencana | id_baris (terkunci) · tanggal · no_rekening · kategori_cf · deskripsi · jumlah (+ masuk / − keluar) · status · tanggal_realisasi · no_dokumen · lawan_transaksi · diinput_oleh · id_jadwal_tetap | `cash_daily_plan`; no_dokumen → `document_ref`, lawan_transaksi → `counterparty`, diinput_oleh → `entered_by` |
| Daftar | kategori_cf (12 baris = `CF_CATEGORIES`) · status (rencana, realisasi, batal) · no_rekening aktif | sumber dropdown |

Sumber dokumen ini: `202609_Data_COGS_LB.xlsx` (versi 18 Okt), `KGR - Budget Manufacturing v2.xlsx` (`B_UnitEcon`, `B_Summary`, `Assumptions`), repo `main` `6f9757f`, review eksternal GPT 18 Okt, dan layar `/minggu-ini/2026-08-24` per 18 Okt 2026.
