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

Q14. §5.3 menetapkan ECharts untuk komponen Chart. Instalasi dependency baru di lingkungan kerja ini belum tentu bisa karena `pnpm install --frozen-lockfile` gagal mengambil `xlsx` dari `cdn.sheetjs.com`. Hasilnya dicatat di irisan 1.

Q15. Penulis `delivery` adalah admin, inventory_accounting, sales, dan commercial_lead. P3.8 menyebut "Sales (Terkirim dengan kg)". Inventory accounting ditambahkan karena peran itu sudah boleh menulis `sales_line` (konfirmasi DO Accurate). Koreksi pengiriman hanya oleh Admin lewat soft delete.
