# PRD v4: pertentangan dan pilihan sementara

PRD v4 §0 meminta implementasi berhenti dan bertanya bila dua pasal bertentangan. Pemilik produk menulis "jalankan semuanya sampai selesai" dan tidak tersedia untuk ditanya selama pengerjaan, jadi setiap pertentangan dicatat di sini bersama pilihan sementara yang dipakai kode. Pilihan sementara dibuat supaya mudah dibalik: tidak ada yang diaktifkan di production, tidak ada SQL yang dijalankan ke Supabase mana pun, tidak ada merge. Setiap butir menunggu keputusan pemilik.

Nomor butir dipakai di komentar kode dan di deskripsi PR.

## Irisan 0

Q1. §0 dan §10 meminta berhenti di akhir tiap irisan untuk sign-off; pemilik meminta semua irisan dikerjakan sekaligus. Semua irisan dikerjakan sebagai branch bertumpuk: `v4/1-design-system` bercabang dari `v4/0-foundation`, dan seterusnya. Tiap PR menunjuk branch irisan sebelumnya sebagai base, jadi sign-off tetap bisa berurutan. Bila irisan 0 diubah saat review, irisan berikutnya perlu di-rebase.

Q2. S1 (§8) meminta `rebuildDay` berjalan dengan client service role di server. Baris terakhir §8 berbunyi "Env Vercel tidak berubah". Client service role butuh kunci service role di server, dan app saat ini tidak punya kunci itu. Migrasi `20261017000200` mencabut `mart_replace` dari `authenticated` dan memberikannya hanya ke `service_role`. `apps/web/lib/supabase-service.ts` membaca `SUPABASE_SERVICE_ROLE_KEY` bila ada. Tanpa kunci itu, bangun ulang data mart tidak jalan dan antrian menunggu dengan pesan yang menyebut alasannya. Hari ini semua modul mati di production, jadi tidak ada yang berubah. Sebelum modul pertama dinyalakan perlu dipilih satu dari tiga jalan. (a) Tambah `SUPABASE_SERVICE_ROLE_KEY` ke env server Vercel, bukan `NEXT_PUBLIC_*`. Ini mengubah env. (b) Env tetap; bangun ulang dipindah ke Supabase Edge Function atau cron dengan kunci tersimpan di secret Supabase. Engine TypeScript perlu dibundel ke function itu. (c) `mart_replace` dibuka lagi untuk peran sempit, misalnya admin saja. Ini bertentangan dengan bunyi S1.

Q3. §11 langkah 2 meminta menyalin `reference/design/` (mockup, screenshot samb-bi, `tokens.css`) di irisan 0. §5.5 menyebut mockup dibuat di irisan 1. Mockup, screenshot samb-bi, `samb-bi/samb_bi/web/styles.css`, dan arsip "KGR Management View v2" tidak ikut dikirim bersama PRD. `tokens.css` disalin dari blok CSS §5.2. Mockup HTML dibuat di irisan 1 dari teks §6 dan angka fixture. Karena mockup adalah spec (§2 prinsip 8), mockup buatan implementasi perlu direview pemilik sebagai spec sebelum halamannya dianggap lulus banding screenshot.

Q4. Kepala PRD menyebut Supabase ref `uxqbtverhnpiryhzbenr`, sedangkan app sekarang memakai project KGR-OS `pczjhmzpkknzkziipvit` (env Vercel diganti 15 Okt 2026). §11.1 meminta database uji, bukan production. Semua migrasi dan tes RLS di sini dijalankan pada PostgreSQL lokal dengan `supabase/tests/supabase_shim.sql` dan pada salinan lokal database latihan KGR-OS. Migrasi `20261017000100` dan `20261017000200` diterapkan ke KGR-OS oleh manusia setelah irisan 0 diterima.

Q5. §4.1 menamai kolom baru `forecast_line.source` ('stat'/'sales'). Kolom `forecast_line.source` sudah ada sebagai provenance ('Accurate','Ops','Manual'; konvensi §4), dan §2 prinsip 3 melarang rename. Kolom baru diberi nama `forecast_source`. Bila pemilik ingin nama lain, penggantiannya murah selama kolom belum dipakai pembaca (pembaca pertama datang di irisan 3).

Q6. `pl_daily_v4` memakai primary key `(date, segment, pl_line, basis)` (§4.1). Kolom primary key tidak boleh null, padahal baris opex dan bunga tidak punya segmen. Baris tanpa segmen memakai `segment = 'Umum'`.

Q7. §4.3 meminta tiap mart dan tabel sumber punya `status`, `built_at`, `input_fingerprint`, `stale_from`. Beberapa tabel sumber sudah punya kolom `status` dengan arti lain (`sales_line.status` Aktual/Order, `batch.status`, `week.status`, `upload.status`), sehingga kolom baru bernama `status` tidak bisa ditambahkan. Dibuat registri `data_status` (satu baris per mart × scope, ditulis `mart_replace`) dan `status_map` (pemetaan eksplisit nilai status lama ke sembilan status §4.3, 15 baris).

Q8. §3.0 menyebut kontrol baru C41–C48, sedangkan §7.1 mencantumkan C41–C49. Dipakai daftar §7.1.

Q9. K7 dan engine v1. Engine mingguan v1 membaca `sales_line.status`, bukan `fulfilled_kg`. Order yang baru terkirim sebagian tetap tampil di blok v1 sebagai Order dengan kg penuh sampai sisanya terkirim atau dibatalkan, lalu baris menjadi Aktual. Pilihan ini menjaga snapshot dan parity. Pilihan lain adalah memecah baris saat pengiriman parsial (bagian terkirim jadi Aktual, sisa tetap Order); itu mengubah jumlah baris v1 dan perlu keputusan. Ledger M2 membaca tabel `delivery` mulai irisan 3.

Q10. G1 meminta tes hijau "di CI". GitHub Actions di repo ini tidak menjalankan job sejak 15 Okt 2026 sekitar 15.18 UTC (tidak ada runner atau kuota habis). Bukti di PR adalah keluaran perintah yang dijalankan lokal.

Q11. §10 meminta demo di staging (Supabase branch). Branch Supabase tidak dibuat: itu tindakan pada project production dan berbayar. Penggantinya PostgreSQL lokal dan salinan database latihan.

Q12. Cakupan S2. Default deny diterapkan pada view `commercial_daily_sales`, halaman `/komersial` dan `/komersial/[key]`, dan pada `discount_approval` (sales hanya membaca permintaannya sendiri atau SKU yang ditugaskan). `sales_line` tetap terbaca semua peran karena PRD v1 §2 menetapkan semua peran membaca outlook. Membatasi `sales_line` per pelanggan akan mengubah view v1 untuk sales. Perlu konfirmasi apakah "lintas customer/SKU" di G2 juga berlaku untuk `sales_line`.

Q13. Cakupan S4. Sales tidak dapat membaca baris audit dari 21 tabel yang memuat biaya (cost pool, alokasi biaya batch, overhead, lot dan SI, biaya tetap, kas, penyesuaian tutup buku). Penyaringannya per tabel, bukan per kolom. Baris audit tabel lain tetap utuh, termasuk `receipt_line.unit_cost`, yang memang terbaca sales di v1.

Q14. §5.3 menetapkan ECharts untuk komponen Chart. Hasilnya dicatat di Q23 (irisan 1): tidak bisa dipasang di lingkungan ini, chart dibuat sebagai SVG.

Q15. Penulis `delivery` adalah admin, inventory_accounting, sales, dan commercial_lead. P3.8 menyebut "Sales (Terkirim dengan kg)". Inventory accounting ditambahkan karena peran itu sudah boleh menulis `sales_line` (konfirmasi DO Accurate). Koreksi pengiriman hanya oleh Admin lewat soft delete.

## Irisan 1

Q16. Revenue proyeksi minggu contoh. §3.4 menulis "angka revenue proyeksi tetap 1.639,0 jt" (revenue blok 1, basis DO dan order). Aturan yang sama menyebut `weekOutlook` dihitung dari `pl_daily`, yang memakai jurnal untuk hari yang sudah lewat (K11): 589,0 jt jurnal 24–26 Agu ditambah 1.067,8 jt PO 27–29 Agu menjadi 1.656,8 jt. Selisihnya 17,8 jt adalah komponen timing faktur di jembatan GP. Kartu `c-outlook` dan grafik harian memakai 1.656,8, supaya kartu, grafik, dan GP P&L (−67,5 jt, −4,1%) satu basis. Tabel segmen tetap 1.639,0 karena itu tabel GP produk. Mockup menulis 1.639,0 di kartu, jadi screenshot banding mencatat selisih ini. Persentase GP −4,1% sama pada kedua basis.

Q17. Stok di atas batas umur. Tile `c-stok` (§6.1) bersumber `sku_balance_daily.over_age_kg × cost_per_kg_ma`, yaitu kg yang umurnya melewati batas per lot. Contoh headline di PRD (Rp 2.782,2 jt, 7 SKU, 116.289,8 kg) adalah angka blok 4 v1, yang menandai seluruh stok sebuah SKU bila umur rata-ratanya di atas batas. Pada fixture, ledger M2 menghitung Rp 685,4 jt, 38.659,8 kg, 30 SKU. Selama M2 mati, kartu dan headline memakai blok 4 (2.782,2 jt, persis contoh PRD). Begitu M2 dinyalakan angkanya turun ke definisi per lot. Perlu diputuskan definisi mana yang menjadi angka manajemen; catatan 2 di bawah halaman menyebut "per SKU" dan perlu disesuaikan.

Q18. Kalimat kas di headline. Templat §6.1 memasang slot kas hanya bila `kas_terendah < 0,25 × rata-rata`, tetapi contoh PRD memuat kalimat kas (289,7 jt). Rata-rata saldo harian minggu contoh 824,5 jt, jadi 289,7 adalah 0,35 kali rata-rata dan syaratnya tidak terpenuhi. Kode mengikuti rumus (kalimat kas tidak muncul untuk minggu contoh); mockup mengikuti contoh. "Rata-rata" belum didefinisikan (rata-rata saldo tujuh hari dipakai di kode).

Q19. Navigasi admin. §5.4 menulis admin "semua di atas + Admin" dengan batas 7 item per peran. Itu tidak muat. Admin mendapat enam halaman yang paling sering dipakai ditambah satu halaman `/admin` yang menautkan pengaturan dan ruang kerja semua peran.

Q20. Judul tile. §5.1 aturan 1 meminta judul seksi berupa temuan, sedangkan tabel tile §6.1 menamai tile dengan label topik ("Revenue dan GP P&L per hari Sen–Min", "Input minggu ini"). Judul tile mengikuti §6.1 (label pendek); temuan ada di headline halaman dan di catatan di bawah tile. Tile jembatan memakai "Dari GP produk ke GP P&L" karena aturan §5.1.5 dan grep §9.4 melarang tanda "→" di teks, sedangkan §6.1 menulis "GP produk → GP P&L".

Q21. Token yang gagal kontras. Pemeriksa §9.4 mengukur `--chart-2` #9fb8d8 pada 2,03:1 terhadap putih (batas 3:1, dan §5.2 sendiri meminta penggantian bila terukur kurang) dan `--muted` #6b7280 pada 4,43:1 terhadap `--bg` (batas 4,5:1; §5.2 hanya mengukurnya terhadap putih, 4,83:1). Diganti `--chart-2` #5798d1 (3,08:1) dan `--muted` #69707d (5,00:1 di atas putih, 4,58:1 di atas `--bg`). `reference/design/tokens.css` mengikuti.

Q22. Angka di mockup. §5.5 meminta mockup "dengan angka fixture". Mockup `minggu-ini.html` memakai angka teks PRD di tempat PRD menyebutnya (§3.4, §3.7, Lampiran B) dan angka fixture `week-2026-08-24` sisanya; tiap tile mencatat sumbernya di atribut `data-src`. Angka fixture itu dibaca dari keluaran engine yang sama dengan halaman, jadi perbandingan nilai di tile tersebut tidak independen; yang diuji independen hanyalah posisi, ukuran, judul, struktur, dan angka dari teks PRD. Mockup `outlook-bulan`, `kas-solvabilitas`, dan `ppic-rencana` sudah ada tetapi halamannya baru dikerjakan di irisan 2 dan 3.

Q23. ECharts. Komponen Chart §5.3 menyebut ECharts. Menambah dependency itu butuh mengubah `pnpm-lock.yaml`; `pnpm add --lockfile-only` gagal di lingkungan ini (registry meminta otorisasi), dan `pnpm install --frozen-lockfile` tidak bisa mengambil `xlsx` dari `cdn.sheetjs.com`. Chart dibuat sebagai SVG di server dengan kontrak yang sama (kolom, garis, waterfall, batang berpasangan, batang bertumpuk; periode terpilih disorot; klik batang = tautan yang memfilter tile terkait; label nilai bila titik ≤ 12; tooltip membawa basis). Mengganti ke ECharts nanti hanya menyentuh `components/v4/Chart.tsx`.

## Irisan 2

Q24. Tanggal kunci V1. K9 menetapkan `v1_lock_week` = 3, dan kode membacanya sebagai Kamis ketiga bulan itu: Agustus 2026 jatuh pada 20 Agu, September pada 17 Sep. Contoh label di §6.2 berbunyi "V1 dikunci 27 Agu 2026 · cut-off 26 Agu", padahal 27 Agu adalah Kamis keempat. Kedua pasal ini tidak cocok. Kode mengikuti K9 (minggu ketiga), dan label di halaman menampilkan tanggal kunci yang sebenarnya. Perlu dipastikan apakah yang dimaksud minggu ketiga atau Kamis setelah cut-off.

Q25. Persen akurasi. P13 menulis contoh "+649,4 jt, +8,4%", dan 8,4% itu dihitung terhadap V1: (8.361,8 − 7.712,4) ÷ 7.712,4. MAPE yang lazim dihitung terhadap actual: 649,4 ÷ 8.361,8 = 7,8%. Tile akurasi menampilkan keduanya. Kolom selisih memakai cara PRD (persen terhadap versi), dan baris "MAPE revenue" memakai |selisih| ÷ FINAL. Perlu dipilih salah satu sebagai angka resmi.

Q26. Cost rencana di hari ber-PO (P6). PRD meminta porsi PO yang tidak tertutup stok bebas dinilai pada cost rencana M1/M3 (harga LB × yield + ekspedisi + maklon, atau harga beli ulang trading). Itu belum dibuat. Sementara ini HPP order memakai biaya rata-rata v1 per key, termasuk penerimaan yang direncanakan. Pada fixture Agustus semua key punya biaya, jadi hasilnya sama. SKU tanpa biaya ditandai `costKnown = false`, dan V1 tidak bisa dikunci selama masih ada yang begitu. Cost rencana dibuat bersama M3 di irisan 3.

Q27. Berkas golden. §9.2 meminta `golden.json` ditulis ulang oleh engine. Ekstraktor fixture ditulis dalam Python dan tidak bisa menjalankan engine TypeScript. Karena itu angka engine ditulis ke berkas terpisah, `fixtures/month-2026-08/golden-v4.json`, oleh `packages/engine/scripts/month-golden.ts`. `golden.json` tetap berisi angka FS, dan target v3 yang dicabut K4 dipindah ke kunci `revoked_v3_targets` sebagai catatan.

Q28. Golden Agustus versi engine dan Lampiran B.2. Hasil engine: forecast revenue 1.378,2, GP forecast −51,0, outlook 7.764,1 / GP 296,4 (3,8%), rentang 7.626,3–7.901,9, NIBT 79,2 jt. Lampiran B.2 menulis −51,2 / 296,2 / 7.902,0. Selisih GP berasal dari margin: PRD membulatkannya ke 5,4%, engine memakai 5,44%. Batas atas rentang dihitung dari angka yang belum dibulatkan. NIBT dihitung karena biaya run-rate diambil dari actual bulan berjalan; mockup menulis "belum diisi". Statusnya "diusulkan" sampai pemilik produk memeriksa (K4). Saat menyusun bukti ini ditemukan kesalahan engine: di hari run-rate, biaya ekspedisi dan blasting dikurangkan lagi di atas margin, padahal margin acuan (GP P&L ÷ revenue) sudah memuatnya. Kesalahan itu membuat GP forecast −54,9. Sudah diperbaiki, dan ada tesnya.

Q29. Biaya run-rate di forecast. Untuk pos yang bukan biaya tetap atau variabel, biaya per hari = actual bulan berjalan ÷ hari kalender yang sudah lewat, tanpa `cost_event`. Pos tanpa actual bulan ini memakai nominal bulanan tabel `runrate` v1 ÷ hari dalam bulan. PRD §3.3 hanya menyebut "rata-rata harian actual tanpa hari anomali", jadi jendelanya adalah pilihan kode.

Q30. Tanda `cost_event.amount`. Finance mengisi biaya satu kali sebagai angka positif. Engine mengubahnya ke tanda P&L (negatif), kecuali Other Income.

Q31. Budget. Form di halaman Outlook bulan menyimpan segmen "Total". Upload menyimpan per segmen. Setiap perubahan isi menjadi versi baru, dan yang dibaca adalah versi terbaru. Kolom `approved_by` diisi pengunggah karena belum ada langkah persetujuan terpisah. Metrik kg tidak dibandingkan: mart belum membawa kg actual untuk semua hari, sehingga pemecahan volume / harga / margin (P9) belum tampil. Garis budget di grafik kumulatif dibagi rata per hari kerja; PRD tidak menyebut cara membaginya.

Q32. Skenario "tanpa fasilitas afiliasi". Yang dikeluarkan adalah arus "Pinjaman afiliasi (net)" yang direncanakan, ditambah pinjaman afiliasi yang sudah masuk minggu ini menurut actual arus kas mingguan. Untuk minggu contoh, angka terendahnya −910,3 jt, sama dengan §6.1. Pinjaman afiliasi dari bulan-bulan sebelumnya tetap ada di saldo awal. Ini asumsi, dan tertulis di catatan tile. Transfer antar rekening sendiri tidak dihitung sebagai arus operasi maupun pendorong defisit, karena jumlahnya nol bersih.

Q33. Proyeksi kas 13 minggu dan 12 bulan disimpan di mart. §4 tidak punya tempat untuk deret proyeksi. Kolom baru `cash_position_daily.horizon` (jsonb, migrasi `20261017000400`) diisi job rebuild kas, dan halaman membacanya tanpa menghitung (K17). Proyeksi 12 bulan memakai NIBT outlook bulan berjalan dari `pl_daily_v4` ditambah penyusutan, dianggap tetap. Tanpa outlook v4, tile menulis "tidak tersedia".

Q34. Grafik kumulatif. Teks §6.2 menyebut garis actual, garis outlook putus-putus, band ±10%, dan garis budget. Mockup `outlook-bulan.html` menggambar empat batang (MTD, outlook, rendah, tinggi). Teks dan mockup bertentangan. Halaman mengikuti teks; empat angka mockup tampil sebagai label pada garis. Perlu dipastikan mana yang dimaksud.

Q35. Grafik harian. Mockup hanya menampilkan 20–31 Agu, yaitu jendela run-rate dan sisa bulan. Halaman mengikuti mockup. Seluruh bulan terlihat di grafik kumulatif.

Q36. Status register. Mockup menulis "ditetapkan K3" dan "ditetapkan K9" untuk run-rate dan toleransi. P10 menyatakan asumsi tanpa pemilik dan tanggal disepakati menahan kunci versi. Engine mengusulkan semua baris dengan status "belum" sampai Finance menyepakatinya, termasuk baris yang angkanya sudah ditetapkan keputusan K. Perlu dipastikan apakah baris yang ditetapkan K dianggap sudah disepakati.

Q37. Dua builder bulanan. Saat `m4_monthly` hidup, builder v3 (`pl_daily`) tetap berjalan untuk halaman v3 dan PDF bulanan, dan builder v4 menulis `pl_daily_v4`. Builder mingguan irisan 1 (`v4_design`) dilewati selama `m4_monthly` hidup, karena builder bulanan sudah menulis tanggal yang sama.

Q38. FINAL, tutup buku, dan PDF bulanan masih memakai jalur v3 sampai irisan 4. Dengan flag hidup, angka di layar Outlook bulan (v4) bisa berbeda dari PDF bulanan (v3) sampai irisan 4 selesai.

Q39. Upload `delivery` (CSV) dipindah ke irisan 3 bersama M3, karena pembacanya ledger M2 dan alokasi.

Q40. Tombol "Bangun ulang" di halaman bulanan v3. Sejak S1 di irisan 0, `mart_replace` menolak klien pengguna, sehingga tombol itu gagal. Sekarang tombol itu, juga versi v4-nya, memasukkan bulan ke antrian lalu memprosesnya dengan service role.

Q41. C33 dan tanggal berlaku driver. §3.3 menyebut driver hanya diganti lewat master dengan tanggal berlaku. `coa_map` tidak punya kolom tanggal berlaku, dan §4.1 tidak menambahkannya. Perubahan driver saat ini hanya tercatat di audit log. Driver bertanggal berlaku butuh kolom atau tabel baru; perlu keputusan.

Q42. Tile solvabilitas di Outlook bulan memakai `solvency_monthly` terakhir yang tidak melewati akhir bulan yang dilihat; mockup memakai angka September dari §1.1 di halaman Agustus. Baris bunga memakai Interest Expense bulan yang dilihat dari `pl_daily_v4`. Untuk fixture Agustus nilainya "belum diisi", karena bunga Agustus baru dibukukan di akhir bulan dan belum ada input template 8.3.

Q43. Simulasi termin di tile siklus kas berupa isian (termin LB, termin trading, porsi LB, target hari stok) dengan tombol Hitung, bukan slider yang bergerak sendiri. Halaman membaca isian dari alamat URL.

Q44. Versi yang tampil. Halaman Outlook bulan menampilkan draft terkini secara default. Versi yang dikunci dibuka lewat baris tabel Versi (`?versi=V1`) dan diberi label "versi aktif". Label di slicer menyebut versi terkunci yang terakhir.

## Irisan 3

Q45. Tanggal stok untuk netting. P3.3 meminta stok pada Minggu sebelum minggu rencana, dengan kelayakan dinilai pada tanggal kirim. Kode menghitung jarak dari tanggal stok ke tanggal kirim pertama minggu itu, lalu memakai satu jarak untuk semua order minggu itu. Order yang dikirim lebih akhir dinilai dengan kelayakan tanggal kirim pertama, jadi stok fresh bisa tampak layak lebih lama daripada yang sebenarnya. Untuk stok frozen di minggu contoh hal ini tidak mengubah hasil. Di fixture, "stok Minggu" adalah stok awal minggu (saldo ledger 24 Agu). Netting per tanggal kirim bisa ditambah bila perlu.

Q46. Forecast statistik (K2). P3.2 menyebut forecast "non-PO". Kode memakai rata-rata kg per hari kerja Normal selama 8 minggu sebelumnya (hari tanpa stok bebas di `sku_balance_daily` dikeluarkan), dikali hari kerja minggu itu, lalu dikurangi kg PO terbuka key itu di minggu yang sama. Dengan begitu PO tidak terhitung dua kali. Hanya skenario Base, dengan pola harian rata. Konfigurasi musiman dan skenario dari workbook tidak ada di database. Forecast statistik dihitung saat rebuild dan di halaman, tidak disimpan sebagai baris `forecast_line`: menulis `forecast_line` dari rebuild akan memicu rebuild lagi. Sumbernya tercatat di `demand_weekly.source_forecast`. Tanpa ledger M2, semua hari dianggap Normal.

Q47. Simpan, setujui, salin. P3.5 menulis "savePlan menolak bila C42/C45/C46 bukan LULUS". P3.4 dan mockup menyatakan rencana dengan yield sementara (C42) boleh disimpan dengan label tetapi tidak boleh disalin ke batch. P3.5 sendiri menulis C46 membuat rencana "tidak bisa disetujui". Pasal-pasal ini bertentangan. Sementara ini: simpan hanya ditolak oleh C45 STALE; C42 memberi label `yield_provisional`; C46 menahan persetujuan; salin ke batch butuh C42, C45, C46, C47 LULUS (§6.4). Perlu dipilih.

Q48. Kontrol per langkah. PRD tidak menyebut kontrol mana milik langkah mana. Sementara ini langkah 1 memakai C41, C44, C45; langkah 2 C42, C46; langkah 3 C30, C47. PERIKSA membuka langkah berikutnya bila alasannya sudah ditulis. Alasan disimpan di tabel baru `plan_check_reason`, yang tidak ada di §4.2.

Q49. Mockup `ppic-rencana.html` menampilkan langkah 2 terbuka ("yield sementara") padahal C41 berstatus PERIKSA tanpa alasan. Menurut aturan §6.4 langkah 2 terkunci sampai alasan C41 ditulis. Halaman mengikuti teks §6.4. Varian fixture dengan alasan ada di `ppic-rencana-alasan.html`.

Q50. `demand_shortfall.output_kg_at_plan` dihitung pada ekor yang dibutuhkan demand (K1), bukan pada ekor rencana tersimpan. Ekor rencana bisa lebih besar karena komitmen supply. Bila supply menaikkan ekor, output by-product naik dan kekurangan yang tampil lebih besar dari yang sebenarnya. Perlu dipilih basis mana yang dipakai.

Q51. Pembulatan golden M3. Lampiran B.3 menulis kekurangan Kepala 842 kg dan Ceker 548 kg, dihitung dengan kg/ekor yang dibulatkan ke 4 desimal. Engine menghasilkan 843 dan 547. `fixtures/plan-2026-08-24/golden.json` menyimpan angka B.3 dengan toleransi 1 kg dan `placeholder: true`. Ekor 9.179, kg LB 18.358, dan net karkas 13.118 sama persis.

Q52. Varian aktual lawan rencana (P3.7) dihitung per unit potong (Karkas, Usus, …), karena `plan_day.target_kg_by_key` disimpan per unit. Output aktual per key SKU dipetakan ke unitnya. Ekor aktual diambil dari `batch.head_count`; hari tanpa angka itu tetap kosong, tidak 0.

Q53. Pengiriman di ledger M2 (lanjutan Q9). Pengiriman pada baris Order menjadi stok keluar aktual pada tanggal kirim, dan sisanya tetap rencana. Bila nomor DO pengiriman sudah masuk sebagai baris Aktual dari Accurate untuk item yang sama, pengiriman itu dianggap baris tersebut dan tidak dihitung lagi. Baris yang sudah Aktual tidak menambah pengiriman. Bila nomor DO ditulis berbeda di Ops dan di Accurate, stok keluar terhitung dua kali; C26 (rekon kartu stok) akan menangkapnya. Alokasi lot dipakai sekali untuk seluruh pengiriman sebuah baris.

Q54. Upload pengiriman (CSV). Setiap baris dicocokkan ke baris Order terbuka dengan PO dan item yang sama, mulai dari tanggal kirim paling awal. kg dipecah ke beberapa baris bila satu PO punya beberapa baris item itu. `no_dokumen` wajib, supaya unggah ulang tidak mencatat dua kali. Index unik baru `delivery (sales_line_id, document_ref)` juga menahan dua Terkirim paralel dengan DO yang sama.

Q55. Spot lalu blast (K8). Halaman Alokasi menampilkan sisa fresh sebagai calon jual spot, dengan tautan ke Komersial. Pencatatan penjualan spot (`sales_line.channel = 'spot'`) masuk irisan 5 (M7). Server menolak cut-off sebelum `cut_off_time` hari itu; hari yang sudah lewat selalu terbuka.

Q56. Seed kapasitas. Baris per tanggal 19 Okt–29 Nov 2026 tanpa angka, dengan keterangan periode: maklon sampai 31 Okt, RPA Rawa Terate mulai 1 Nov. C47 memperlakukan nilai kosong sebagai belum diisi. Tanggal sesudah 29 Nov tidak di-seed.

Q57. Syarat selesai irisan 3 di §10 ("paralel 2–4 minggu dengan rencana PPIC sebelum flag on") adalah langkah operasional PPIC dan pemilik produk. Pekerjaan ini menyiapkan halaman dan angka; perbandingannya belum dijalankan.
