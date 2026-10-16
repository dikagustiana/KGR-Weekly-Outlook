# Pertanyaan dan default — PRD v5

Pertanyaan terbuka O1–O14 PRD v5 §11 dibangun di belakang parameter dengan default PRD dan tidak difinalkan di sini. Q1–Q78 v4 (`docs/v4/QUESTIONS.md`) tetap berlaku kecuali Q17 (→ O7), Q26 (§4.7), Q47 (§4.3), Q63 (§4.1). Pertanyaan baru dari implementasi v5 diberi nomor Q-v5-n.

## Default O1–O14 yang dipakai

| # | Default | Di mana |
|---|---|---|
| O1 | `cogs_line` | `parameter.revaluation_sold_mode` (v5/0); dipakai engine revaluasi (v5/1) |
| O2 | satu harga LB untuk semua kelas | `lb_price_decision.weight_class` null = semua kelas; `lb_supply.price_per_kg` per baris sudah ada |
| O3 | Uk 1.3 = 1,30–1,39 kg/ekor, titik tengah 1,35 | parser ukuran (v5/3) |
| O4 | ukuran sebagai kolom terpisah (`size_kg`) | `item_map.size_kg`, `sales_line.size_kg` (v5/0) |
| O5 | K/S/B tanpa rentang dan rata-rata | seed `weight_class` null (v5/0) |
| O6 | C22 2%, susut 3%, yield karkas 68–76% | `parameter.yield_karkas_min/max`, `target_shrink` (v5/0) |
| O7 | stok di atas umur per lot | kartu Manajemen (v5/6) |
| O8 | approval parameter > 5% atau > Rp 5 jt per minggu | form parameter (v5/5) |
| O9 | grafik harian tanpa pilihan ukuran | Outlook bulan (v5/2) |
| O10 | rilis Kamis | `input_task_rule.release_week` = `week_start + 3 days 17:00` (v5/0) |
| O11 | harga lantai by-product fresh tampil dengan C54 | Commercial (v5/1, v5/4) |
| O12 | kunci service role disimpan manusia di env server Vercel | tidak diubah di sini |
| O13 | belum ada pengecualian MA vs HPP; G3 terbuka | — |
| O14 | 1–2 Agu ditandai anomali, tidak diubah | P&L per minggu (v5/2) |

## Irisan 0

Q-v5-1. Dua kolom §5.1 sudah ada dengan nama lain: `lb_supply.price` → `lb_supply.price_per_kg` (m3), dan `parameter.shrink_target` → `parameter.target_shrink` (v1, 0,03). Kolom baru tidak ditambah supaya satu besaran tidak punya dua tempat; engine membaca kolom lama. Bila nama PRD yang diinginkan, kolomnya bisa ditambah sebagai alias di migrasi berikut.

Q-v5-2. `lot_revaluation` menyimpan `lot_ref`, bukan `lot_id` (§5.2). Tabel `lot` adalah mart yang dibangun ulang, sehingga `id` tidak stabil dan foreign key akan menahan rebuild. `lot_ref` adalah referensi engine yang stabil. `lot_revaluation` sendiri diperlakukan sebagai mart (ditulis builder costing), dengan kolom tambahan `kg_sold` dan `amount_sold` untuk porsi yang sudah terjual (K22).

Q-v5-3. `demand_class_weekly` diberi kolom kunci `size_code` ('Uk 1.3' atau 'tanpa'), karena `size_kg` null untuk baris tanpa ukuran dan tidak bisa menjadi bagian primary key.

Q-v5-4. Status tugas dan kelengkapan memakai kode Inggris di database (aturan 11): `input_task.status` ∈ open / waiting / received / passed / late (tampil: belum / menunggu / masuk / lolos cek / terlambat); `input_completeness_daily.status` ∈ passed / noted / late / not_due (tampil: masuk lolos / masuk dengan catatan / terlambat / belum jatuh tempo). `input_task` dan `input_completeness_daily` adalah mart: ditulis job, tidak dicentang tangan (§4.9).

Q-v5-5. Aturan tenggat (`input_task_rule.due_rule`) ditulis sebagai teks `<anchor> ± n day(s) HH:MM` dengan anchor `week_start`, `cut_date`, `date`, `batch.date`, `month_start`, atau `event` (tanpa tenggat). Tenggat bulanan Finance (beban tetap, budget) tidak disebut PRD; sementara `month_start + 0 days 17:00`.

Q-v5-6. Versi komitmen setelah kunci: draft versi baru boleh dibuat Sales dengan alasan; baris terkunci lama tetap berlaku sampai Kepala Sales mengunci versi baru, lalu versi lama menjadi `superseded`. Dengan begitu PPIC tidak pernah kehilangan komitmen terkunci di antara dua versi.

Q-v5-7. `weight_class.avg_kg` dibuat boleh null supaya K/S/B bisa ada tanpa angka (§5.1). Rencana v4 hanya memakai kelas yang sudah punya rata-rata, jadi STD tetap kelas bawaan sampai PPIC mengisi.

Q-v5-8. Screenshot 1366×768 per layar mockup (§12 butir 2) belum bisa dibuat: berkas `.dc.html` butuh runtime `support.js` Claude Design yang tidak ikut diekspor (README mockup). Mockup dibaca sebagai spec dari markup dan `renderVals()`.

## Irisan 1

Q-v5-9. Lampiran B.1 direproduksi dalam toleransi, dengan selisih 1–2 Rp/kg dari pembulatan input PRD (kg 18.358, nilai 486,7 jt): breakeven basis kebutuhan 23.961 (PRD 23.960), basis batch 20.726 (20.727); GP pada 24.600 −11,7 jt (−11,8), k 1,0241 (1,0242); basis batch COGS 739,0 jt (739,1), GP −105,4 jt. Fixture `costing-sim-2026-08-24` menyimpan hasil engine; tes memeriksa angka PRD dengan toleransi ±0,1 jt dan ±2 Rp/kg.

Q-v5-10. Mode `estimasi` (hari potong, sebelum WP): kg SKU = kg LB batch × yield standar `yield_matrix` STD pola karkas, karena yield K/S/B belum diisi (O5). Karkas dibagi fresh/frozen menurut `out_karkas_fresh / out_karkas_frozen` di header batch; tanpa pembagian semua fresh.

Q-v5-11. Harga acuan (K24): `price_list_week` terkunci minggu lalu. Sebelum price list pertama dikunci, costing memakai `sku_price.ref_sell_price` minggu batch dan memberi label "harga acuan minggu ini". SKU tanpa harga (Lemak fresh di minggu contoh) = biaya `missing`, tidak 0.

Q-v5-12. Harga LB untuk estimasi/sementara: `lb_price_decision` tanggal potong (keputusan terakhir), lalu `batch.lb_price`, lalu `parameter.lb_price_today`. Sumbernya ditampilkan di halaman Costing.

Q-v5-13. C54 pada stok: lot stok awal Ceker dan Kepala fresh dinilai 14.221 dan 13.024 Rp/kg (nilai buku). Setelah alokasi joint batch baru, biaya per kg SKU di mart tetap di atas 3 × harga sampai lot stok awal habis, sehingga Commercial masih menandai keduanya "periksa biaya" (O11). Uji G9 memakai biaya per SKU dari costing batch 126: penerimaan menandai Ceker dan Kepala (Usus juga), joint costing sementara membersihkannya.

Q-v5-14. Revaluasi (K22) memakai biaya sementara yang dihitung ulang dari input (WP + harga keputusan + angkut/maklon aktual), bukan disimpan, supaya mart bisa dibangun ulang. Batch yang diposting sebelum `v5_costing` hidup (`app_setting.value.since`, atau tanggal flag diubah) tidak direvaluasi: lotnya tidak pernah membawa biaya sementara. Tanggal final = tanggal WIB `allocation_run.posted_at`.

Q-v5-15. "Biaya kapasitas idle" diperlakukan sebagai beban pokok (seperti "Selisih costing"), segmen LB main, basis `fixed`; hari setelah cut-off memakai kg LB batch rencana dan masuk kolom forecast. Bila Finance ingin di bawah GP, cukup mengubah `V5_COGS_LINES`.

Q-v5-16. Kolom biaya v5 untuk Sales lewat view baru `commercial_daily_sales_v5` (dibaca app saat `v5_costing` hidup). View `commercial_daily_sales` tidak diubah, karena migrasi m7 dan v4 menggantinya dengan daftar kolom lama dan tidak akan bisa dijalankan ulang bila view itu bertambah kolom.

Q-v5-17. K25 diterapkan saat `v5_costing` hidup: headline manajemen, blok 2 (manajemen, preparer, cetak, PDF) dan baris "Aksi" di Ekonomi rencana diganti angka simulasi + "Harga dan volume live bird diputuskan Direktur Operasional." Saat flag mati layar sama dengan `ebe4ad8` (aturan 6). `block2.action` tetap dihitung `computeWeek` (snapshot v1) tetapi tidak ditampilkan. "REKOMENDASI" blok 3 (beli trading) bukan live bird dan tidak diubah.

Q-v5-18. Builder ledger, Commercial dan P&L v5 belum dijalankan terhadap API Supabase di sesi ini (tidak ada PostgREST lokal). Logika diuji di engine (fixture minggu contoh) dan hak akses di `rls_roles.sql`; jalankan rebuild setelah flag hidup di KGR-OS (lihat `docs/v5/irisan-1.md`).

## Irisan 2

Q-v5-19. Lampiran B.2 direproduksi dalam ±0,1 jt (`docs/v5/bukti/irisan-2-b2.txt`). Selisih pembulatan: COGS forecast −1.429,3 (PRD −1.429,2, golden v4 −1.429,3); NIBT actual 165,2 (PRD menulis 165,3 dan mencatat engine 165,2); nominal tetap 87,02 jt → 2,807 jt/hari dan 19,7 jt per minggu penuh (PRD membagi 87,0 yang sudah dibulatkan: 2,806 / 19,6); NIBT setelah beban tetap 24–30 Agu −125,6 (PRD −125,7). GP per hari 27–30 Agu dari engine −7,6 / −0,4 / −56,1 / −3,8 = −67,9, sama dengan angka mockup.

Q-v5-20. Baris tetap = baris jadwal 8.3 (`fixed_cost_schedule`) yang berlaku di bulan itu. Baris tanpa nominal memakai jurnal FINAL terakhir baris itu ("estimasi bulan lalu"); tanpa baris jadwal sama sekali dipakai daftar K29 (gaji, penyusutan, bunga, sewa). Untuk Agustus seed menghasilkan depresiasi 10,4 (jadwal) + gaji 52,2 + bunga 24,4 (Juli FINAL) = 87,0, sama dengan B.2; sewa Juli 3,3 tidak ikut karena baris sewa baru berlaku Sep/Nov. Baris P&L yang punya baris jadwal berisi dan kosong sekaligus memakai yang berisi saja.

Q-v5-21. "FINAL terakhir" = bulan terakhir sebelum bulan berjalan yang punya versi FINAL di `month_outlook_version`; nominal per baris dari jurnal bulan itu (`gl_line` lewat `coa_map`). Bila jurnal bulan itu tidak ada di KGR-OS, nominal "belum ada" dan C55 PERIKSA. Penyesuaian tutup buku yang belum dijurnal tidak ikut.

Q-v5-22. Estimasi tidak pernah dobel: estimasi s.d. hari d = nominal × d ÷ hari kalender dikurangi jurnal + forecast baris itu s.d. d (min 0). Bila driver 8.3 atau run-rate sudah memproyeksikan baris itu setelah cut-off, estimasinya turun; akhir bulan baris = max(nominal, jurnal + forecast) seperti K6. Baris `fixed_estimate` ditulis builder bulanan (`m4_monthly`); builder minggu v4 tidak menulisnya.

Q-v5-23. Kolom Budget di Actual vs run-rate: revenue, COGS (= GP − revenue), GP, beban operasi, dan budget NIBT dibandingkan dengan "NIBT setelah beban tetap" (budget memuat semua beban). Baris NIBT jurnal dan beban tetap kosong di kolom itu.

Q-v5-24. C55 menahan kunci V1 di pre-flight app (`lockBlockers`); `release_month` di database tidak menolak status PERIKSA dan tidak diubah. Tidak ada kebijakan override untuk C55: Finance mengisi jadwal beban tetap bulan itu.

Q-v5-25. COGS hari ber-PO memakai biaya per kg order dari engine mingguan (HPP per key) seperti `ebe4ad8`; biaya `planCost` v5/1 per SKU belum menggantikannya supaya B.2 tetap. Bila diinginkan, penggantian bisa dibuat di belakang `v5_costing` dengan golden baru.

Q-v5-26. Tata letak: di Outlook bulan dan Minggu ini v4, tile laba rugi masuk baris 5–8 lebar 12 dan tile di bawahnya turun empat baris. Penyatuan "Versi dan bridge" dan urutan mockup Manajemen v5 lainnya dikerjakan di v5/6.
