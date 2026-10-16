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
