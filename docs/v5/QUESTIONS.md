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

## Irisan 3

Q-v5-27. O4 (default: ukuran kolom terpisah). Ukuran baris PO = `sales_line.size_kg` → `item_map.size_kg` → dibaca dari nama item ("Uk 1.3" = 1,30). Dua kolom pertama adalah koreksi manual dan tidak wajib diisi; selama flag mati tidak ada yang menulis atau membaca kolom itu. `sku_key` karkas tidak dipecah per ukuran.

Q-v5-28. Stok tidak punya ukuran, jadi netting tetap per key (v4 P3.3) dan porsi net key itu dibagi ke ukuran menurut kg PO. Di minggu contoh stok karkas fresh tidak layak (6,9 hari), sehingga net = PO.

Q-v5-29. Peta ukuran → K/S/B Lampiran B.3 adalah ilustrasi: hanya dipakai sebagai input tes berlabel (`fixtures/plan-2026-08-24` blok `v5`, `placeholder: true`), tidak di-seed. Di KGR-OS semua ukuran jatuh ke STD dengan C50 sampai PPIC mengisi `size_class_map`; kelas tanpa yield karkas memakai yield STD (C42).

Q-v5-30. Pembulatan ekor per kelas dari jumlah tak dibulatkan: S 4.420,5 tampil 4.421 (PRD 4.420), total 9.871 sama. Kekurangan by-product engine Kepala 842,5 → 843 (PRD 842), Ceker 547,5 → 547 (PRD 548), dalam toleransi golden v4 1 kg.

Q-v5-31. Versi "Tersimpan" di layar memakai batch rencana yang diinput dalam horizon (blok 2 v1), seperti mockup: surplus = kg LB × yield karkas STD − kebutuhan karkas, downgrade pada harga acuan fresh/frozen minggu itu. "Simpan rencana" menulis `plan_week` (aturan v4, kelas STD untuk ekor) dan `plan_week_class` per kelas dari kebutuhan.

Q-v5-32. C58 membaca `lb_supply.kg` sebagai kg LB per kelas per tanggal potong (status confirmed/received); supply tanpa kelas tidak dihitung untuk kelas mana pun. Salin ke batch butuh C58 LULUS atau alasan tertulis (kode C58 di `plan_check_reason`).

Q-v5-33. C51 di upload supply LB hanya saat `v5_ppic_class` hidup (perilaku v4 tetap). Upload yield sudah menolak kelas yang tidak terdaftar sejak v4.

Q-v5-34. O3: titik tengah "Uk x.x" = x.x + 0,05 sebagai konstanta (`SIZE_MID_OFFSET`); §5 tidak menyebut kolom parameter untuk itu. Lead time potong dari `parameter.lead_time_days` (1).

Q-v5-35. Kartu "Spot fresh hari ini" di tile "Dari Commercial" dan kalimat stok di headline mockup belum diisi data (tampil "belum ada"); data spot dari Commercial v5 (irisan 4).

## Irisan 4

Q-v5-36. Stok bebas di layar = `free_kg` mart Commercial (saldo lot − reservasi alokasi), seperti v4 M7. Komitmen minggu depan tidak dikurangkan dari stok hari ini; komitmen terkunci menjadi demand `Confirmed` di rencana Senin (K26) sebesar kg yang belum tertutup PO minggu itu, ditempatkan pada hari Senin. Baris komitmen tidak membawa ukuran, jadi di PPIC v5 dihitung kelas STD (C50).

Q-v5-37. Key komitmen dan price list = SKU dasar (`RPA|Karkas`); fresh kg → `|Fresh`, frozen kg → `|Frozen`. Harga di form komitmen menjadi `price_list_week.price_fresh` minggu depan saat Kepala Sales mengunci; `price_frozen` tidak diisi dari form (mockup hanya punya satu kolom harga). Costing minggu depan memakai harga itu (v5/1, K24).

Q-v5-38. Tarif simpan harian = beban "Storage Expenses" jurnal bulan lalu ÷ nilai stok (Σ `cost_ma` `sku_balance_daily`) pada akhir bulan lalu ÷ hari bulan itu. PRD memakai persediaan neraca (3.532,6 jt Agustus); app memakai mart stok yang mewakili angka yang sama. Tanpa jurnal atau mart bulan lalu, kartu menulis "tarif simpan belum ada". Sales tidak melihat tarif (jurnal bukan untuk Sales).

Q-v5-39. Lampiran C (126.434 kg / 3.233,3 jt / 26 SKU) berasal dari mart KGR-OS, bukan dari fixture minggu contoh; ledger fixture memberi 128.026 kg / 3.282,1 jt per 26 Agu. Angka ini tidak termasuk daftar reproduksi (B.1–B.5); tes layar memakai baris Lampiran C yang tertulis di mockup sebagai input.

Q-v5-40. Tile "Dari PPIC" di Commercial memakai loader PPIC v5 (satu angka dengan layar PPIC): surplus dari batch rencana, biaya rencana karkas fresh, kekurangan by-product. Sales tidak melihat tile ini berisi detail rencana (data planning bukan untuk Sales); Kepala Sales dan Admin menjawab surplus.

## Irisan 5

Q-v5-41. C51 "kelas terdaftar" = kelas di `weight_class` yang sudah diberi angka oleh PPIC (rata-rata, atau rentang min–maks). Seed v5/0 menyiapkan kode K/S/B tanpa angka (O5), jadi K/S/B belum terdaftar sampai PPIC mengisinya — sama dengan mockup ("1 dari 3 · baru STD 2,0 kg") dan Lampiran B.5 (yield K/S/B 0 lolos). Aturan yang sama (`registeredClasses`) dipakai C51 layar PPIC (v5/3 sebelumnya menghitung semua kode). Kelas batch WP = kelas terdaftar yang rentangnya memuat kg/ekor: dengan seed (STD 1,8–2,2) 1,93 kg/ekor = STD; "kelas S" Lampiran B.5 memakai rentang mockup (ilustrasi) dan hanya diuji sebagai input tes berlabel.

Q-v5-42. SheetJS: `xlsx@0.18.5` dipasang di `apps/web` sesuai PRD §12.4. Versi ini punya CVE-2023-30533 (prototype pollution saat membaca file buatan) dan CVE-2024-22363 (ReDoS), diperbaiki di 0.19.3 / 0.20.2; `packages/parsers` memakai 0.20.3 dari cdn.sheetjs.com. Di jalur Input file hanya dibaca di browser pengunggahnya sendiri; server menerima grid, tidak mem-parse xlsx. Usul: naikkan web ke tarball 0.20.3 yang sama saat cdn.sheetjs.com terjangkau dari lingkungan build (di sini diblok, sehingga `pnpm add` tidak bisa me-resolve ulang lockfile; entri 0.18.5 dibangkitkan pnpm di salinan scratch lalu disisipkan, `--frozen-lockfile --lockfile-only` lolos). Build mini tidak membaca .xls (BIFF): layar meminta simpan ulang sebagai .xlsx atau tempel dari Excel; .csv dan tempel TSV tanpa library.

Q-v5-43. Template PO menambah kolom opsional `ukuran` (tidak ada di tabel §4.9) supaya baris karkas tanpa ukuran bisa dilengkapi lewat file (tindakan journey N). Ukuran: kolom `ukuran` → `item_map.size_kg` → nama item ("Uk 1.3"). Yang wajib ukuran: `RPA|Karkas|Fresh` dan `RPA|Karkas|n/a` (mockup); karkas frozen tidak.

Q-v5-44. Baris PO di bawah lantai lolos cek (`warn`), tetapi saat simpan dengan `m7_approval` hidup baris itu tidak ditulis: permintaan approval pending dibuat (`floorGuard`, C38) dan guard database v4 tetap menolak Order di bawah lantai tanpa approval. Setelah Kepala Sales menyetujui, upload ulang menulis baris itu (kunci baris sama). Lantai cek = `commercial_daily.price_floor` (yang dibaca guard database); bila Sales tidak boleh melihat biaya (`sales_sees_cost` false) cek lantai menjadi `info` di browser dan server.

Q-v5-45. Tile "Form parameter" menampilkan nilai yang berlaku per role dan halaman tempat mengubahnya. Alur usulan → persetujuan Finance (O8: perubahan > 5% atau > Rp 5 jt per minggu) belum dibangun karena butuh tabel usulan baru; begitu juga "default ukuran per pelanggan" (mockup Sales). Direktur Operasional menulis keputusan harga LB langsung dari tile ini (K25).

Q-v5-46. Repo tidak punya cron. `input_task` dan `input_completeness_daily` dibangun lewat antrean rebuild (setiap upload v5, keputusan harga LB, tombol "Perbarui status tugas", atau Admin → Modul). "Terlambat" dihitung saat dibaca (`effectiveStatus`, `effectiveCell`) dan di `release_week` (sel `not_due` yang lewat `due_at` = merah), sehingga jam yang lewat tidak membuat grid basi; tugas hari baru muncul saat rebuild berikutnya. Cron Vercel harian adalah perubahan proyek oleh manusia.

Q-v5-47. Override K35 satu per minggu (kode `K35` di `release_override`, alasan ≥ 10 karakter dan bukti, hanya Finance), bukan per sel. Sel merah yang muncul setelah override tidak menahan rilis minggu itu lagi; override bisa ditarik Finance. Cek kode `release_override_policy` diperlebar dari `C\d{1,2}` ke `C\d{1,2}|K35`.

Q-v5-48. Grid Finance memakai minggu yang dirilis Senin–Sabtu (mockup: enam hari kerja terakhir Jum–Kam). Sel faktur (event) "belum jatuh tempo" sampai faktur masuk. Aturan tugas baru `po_lines` (Sales, `cut_date - 1 day 12:00`, mockup Sales) ditambahkan di registry. WP harus menunjuk batch aktual (`batch.batch_ref`); faktur memakai commit PI v3 (`cost_pool_pi`, PI menggantikan biaya WP dokumen yang sama) lalu `batch.invoice_status` received / tied; tie = Σ debit voucher Purchase Invoice 90 hari terakhir = nilai (± Rp 1). Yield tersimpan dengan pola `karkas` dan berlaku mulai hari ini bila kolomnya kosong; supply LB tersimpan `confirmed`. "Pakai file contoh" memuat contoh mockup (ilustrasi) dan tidak bisa disimpan. Upload "lainnya" v4 §4.4 (jurnal, stok awal, kartu stok, pengiriman, kas, budget) tetap di wizard v4.
