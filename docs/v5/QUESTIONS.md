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

**Amandemen PRD v5.1 (17 Okt 2026, Bab 1.3):** default implementasi, **menyimpang dari PRD v5 §4.6** (stok bebas dikurangi komitmen terkunci minggu depan). Dibuka kembali sebagai O16; default sementara tetap: tidak dikurangi.

Q-v5-37. Key komitmen dan price list = SKU dasar (`RPA|Karkas`); fresh kg → `|Fresh`, frozen kg → `|Frozen`. Harga di form komitmen menjadi `price_list_week.price_fresh` minggu depan saat Kepala Sales mengunci; `price_frozen` tidak diisi dari form (mockup hanya punya satu kolom harga). Costing minggu depan memakai harga itu (v5/1, K24).

Q-v5-38. Tarif simpan harian = beban "Storage Expenses" jurnal bulan lalu ÷ nilai stok (Σ `cost_ma` `sku_balance_daily`) pada akhir bulan lalu ÷ hari bulan itu. PRD memakai persediaan neraca (3.532,6 jt Agustus); app memakai mart stok yang mewakili angka yang sama. Tanpa jurnal atau mart bulan lalu, kartu menulis "tarif simpan belum ada". Sales tidak melihat tarif (jurnal bukan untuk Sales).

Q-v5-39. Lampiran C (126.434 kg / 3.233,3 jt / 26 SKU) berasal dari mart KGR-OS, bukan dari fixture minggu contoh; ledger fixture memberi 128.026 kg / 3.282,1 jt per 26 Agu. Angka ini tidak termasuk daftar reproduksi (B.1–B.5); tes layar memakai baris Lampiran C yang tertulis di mockup sebagai input.

Q-v5-40. Tile "Dari PPIC" di Commercial memakai loader PPIC v5 (satu angka dengan layar PPIC): surplus dari batch rencana, biaya rencana karkas fresh, kekurangan by-product. Sales tidak melihat tile ini berisi detail rencana (data planning bukan untuk Sales); Kepala Sales dan Admin menjawab surplus.

## Irisan 5

Q-v5-41. C51 "kelas terdaftar" = kelas di `weight_class` yang sudah diberi angka oleh PPIC (rata-rata, atau rentang min–maks). Seed v5/0 menyiapkan kode K/S/B tanpa angka (O5), jadi K/S/B belum terdaftar sampai PPIC mengisinya — sama dengan mockup ("1 dari 3 · baru STD 2,0 kg") dan Lampiran B.5 (yield K/S/B 0 lolos). Aturan yang sama (`registeredClasses`) dipakai C51 layar PPIC (v5/3 sebelumnya menghitung semua kode). Kelas batch WP = kelas terdaftar yang rentangnya memuat kg/ekor: dengan seed (STD 1,8–2,2) 1,93 kg/ekor = STD; "kelas S" Lampiran B.5 memakai rentang mockup (ilustrasi) dan hanya diuji sebagai input tes berlabel.

Q-v5-42. SheetJS: `xlsx@0.18.5` dipasang di `apps/web` sesuai PRD §12.4. Versi ini punya CVE-2023-30533 (prototype pollution saat membaca file buatan) dan CVE-2024-22363 (ReDoS), diperbaiki di 0.19.3 / 0.20.2; `packages/parsers` memakai 0.20.3 dari cdn.sheetjs.com. Di jalur Input file hanya dibaca di browser pengunggahnya sendiri; server menerima grid, tidak mem-parse xlsx. Usul: naikkan web ke tarball 0.20.3 yang sama saat cdn.sheetjs.com terjangkau dari lingkungan build (di sini diblok, sehingga `pnpm add` tidak bisa me-resolve ulang lockfile; entri 0.18.5 dibangkitkan pnpm di salinan scratch lalu disisipkan, `--frozen-lockfile --lockfile-only` lolos). Build mini tidak membaca .xls (BIFF): layar meminta simpan ulang sebagai .xlsx atau tempel dari Excel; .csv dan tempel TSV tanpa library.

Q-v5-43. Template PO menambah kolom opsional `ukuran` (tidak ada di tabel §4.9) supaya baris karkas tanpa ukuran bisa dilengkapi lewat file (tindakan journey N). Ukuran: kolom `ukuran` → `item_map.size_kg` → nama item ("Uk 1.3"). Yang wajib ukuran: `RPA|Karkas|Fresh` dan `RPA|Karkas|n/a` (mockup); karkas frozen tidak.

**Amandemen PRD v5.1 (Bab 1.3):** "wajib ukuran" berarti baris karkas RPA tanpa ukuran = fail (kode 67c7f03, golden B.5). Dibuka sebagai O15; default baru = warn C50 dan baris tersimpan dengan `size_kg` null (dihitung STD), di belakang `parameter.po_unsized_mode` (`warn` | `fail`, default `warn`). Dibangun di v5.1 irisan 4 (R33); sampai irisan itu kode masih fail.

Q-v5-44. Baris PO di bawah lantai lolos cek (`warn`), tetapi saat simpan dengan `m7_approval` hidup baris itu tidak ditulis: permintaan approval pending dibuat (`floorGuard`, C38) dan guard database v4 tetap menolak Order di bawah lantai tanpa approval. Setelah Kepala Sales menyetujui, upload ulang menulis baris itu (kunci baris sama). Lantai cek = `commercial_daily.price_floor` (yang dibaca guard database); bila Sales tidak boleh melihat biaya (`sales_sees_cost` false) cek lantai menjadi `info` di browser dan server.

Q-v5-45. Tile "Form parameter" menampilkan nilai yang berlaku per role dan halaman tempat mengubahnya. Alur usulan → persetujuan Finance (O8: perubahan > 5% atau > Rp 5 jt per minggu) belum dibangun karena butuh tabel usulan baru; begitu juga "default ukuran per pelanggan" (mockup Sales). Direktur Operasional menulis keputusan harga LB langsung dari tile ini (K25).

Q-v5-46. Repo tidak punya cron. `input_task` dan `input_completeness_daily` dibangun lewat antrean rebuild (setiap upload v5, keputusan harga LB, tombol "Perbarui status tugas", atau Admin → Modul). "Terlambat" dihitung saat dibaca (`effectiveStatus`, `effectiveCell`) dan di `release_week` (sel `not_due` yang lewat `due_at` = merah), sehingga jam yang lewat tidak membuat grid basi; tugas hari baru muncul saat rebuild berikutnya. Cron Vercel harian adalah perubahan proyek oleh manusia.

Q-v5-47. Override K35 satu per minggu (kode `K35` di `release_override`, alasan ≥ 10 karakter dan bukti, hanya Finance), bukan per sel. Sel merah yang muncul setelah override tidak menahan rilis minggu itu lagi; override bisa ditarik Finance. Cek kode `release_override_policy` diperlebar dari `C\d{1,2}` ke `C\d{1,2}|K35`.

Q-v5-48. Grid Finance memakai minggu yang dirilis Senin–Sabtu (mockup: enam hari kerja terakhir Jum–Kam). Sel faktur (event) "belum jatuh tempo" sampai faktur masuk. Aturan tugas baru `po_lines` (Sales, `cut_date - 1 day 12:00`, mockup Sales) ditambahkan di registry. WP harus menunjuk batch aktual (`batch.batch_ref`); faktur memakai commit PI v3 (`cost_pool_pi`, PI menggantikan biaya WP dokumen yang sama) lalu `batch.invoice_status` received / tied; tie = Σ debit voucher Purchase Invoice 90 hari terakhir = nilai (± Rp 1). Yield tersimpan dengan pola `karkas` dan berlaku mulai hari ini bila kolomnya kosong; supply LB tersimpan `confirmed`. "Pakai file contoh" memuat contoh mockup (ilustrasi) dan tidak bisa disimpan. Upload "lainnya" v4 §4.4 (jurnal, stok awal, kartu stok, pengiriman, kas, budget) tetap di wizard v4.

## Irisan 6

Q-v5-49. "Lihat sebagai" (K37) mengikuti Bab 8: Admin, Management, Direktur Operasional, Finance → Manajemen · Commercial · PPIC · Input; Sales dan Kepala Sales → Commercial · Input; PPIC → PPIC · Input; peran lain hanya Input (tidak ditampilkan karena kurang dari dua). Bacaan sebagian di Bab 8 (Kepala Sales "PPIC langkah 1–2", Purchasing "langkah 3", Cost Accounting "batch", Inventory Accounting "stok", PPIC "Commercial stok bebas") butuh tampilan PPIC/Commercial yang disaring per langkah dan belum dibangun; tautannya tidak ditampilkan. Layar PPIC dibuka baca-saja untuk management dan operations_director saat `v5_management` hidup (tulis tetap admin / PPIC).

Q-v5-50. Tile simulasi dan "Perlu keputusan" memakai 5 baris (mockup: baris 9–11, 3 baris). Pada skala huruf v4 (baris 76 px) tabel SKU simulasi dan status putaran tidak muat dalam 3 baris, dan journey K meminta keputusan + pemilik terbaca tanpa scroll. Tile v4 di bawahnya turun 5 baris dan urutannya tetap v4; tile tren revenue/GP per minggu dan demand per kelas di tile "Demand dan rencana potong" (mockup baris 16–18, 30–33) belum ada di v4 dan tidak dibangun di irisan ini.

**Amandemen PRD v5.1 (Bab 1.3):** tata letak ini diputuskan implementasi, bukan pemilik; dibuka sebagai O17. Tidak diubah di v5.1 sampai pemilik memutuskan; klaim journey K "tanpa scroll" dicabut dari bukti.

Q-v5-51. Simulasi: basis kebutuhan = kebutuhan PO per kelas dari loader PPIC v5 (K28, yield placeholder sampai PPIC mengisi), basis batch = blok 2 v1 (`batchBasisInputs`). Tombol harga 20.000–26.000 per 1.000 + harga hari ini + harga yang sudah diputuskan; harga terpilih default = keputusan untuk potong besok, lalu harga hari ini. Keputusan dari Manajemen = untuk tanggal potong besok, harga yang sedang dicoba, volume opsional, tanpa kelas (O2).

Q-v5-52. "Perlu keputusan" dibentuk dari data: harga LB besok belum diputuskan; batch rencana di atas kebutuhan (downgrade vs batas `threshold`); permintaan diskon pending terbesar (Kepala Sales); kas terendah minggu ini negatif (Direksi). Mockup menulis "Pinjaman afiliasi 1.200,0 jt": jumlah pinjaman butuh rencana pendanaan per tanggal yang belum ada di mart kas, jadi yang tampil titik terendah kas.

Q-v5-53. Label sumber K36 dipasang pada angka utama: Manajemen (kartu Outlook minggu ← jurnal + PO, Stok di atas umur ← kartu stok, Kas terendah ← kas, Outlook bulan ← jadwal beban tetap, simulasi ← WP), Commercial (stok bebas ← WP, komitmen ← PO), PPIC (PO, biaya rencana ← harga LB, batch ← supply LB). Waktu = data terakhir (created/updated) dalam WIB; "lewat tenggat" (merah, hanya labelnya) dari `input_task` 7 hari terakhir. Angka lain di ketiga layar belum berlabel.

## Perbaikan setelah uji pada salinan KGR-OS (semua flag aktif)

Q-v5-54. Tanggal data (`dataToday`): tanggal update minggu terakhir, atau hari ini bila datanya sudah terkini. Rebuild bulanan (cut-off), loader Manajemen v5 (tanggal potong, keputusan, putaran), Kas, Stok per SKU, Komersial, Outlook bulan dan tanggal default "Bangun ulang" memakainya, sama seperti engine mingguan memakai `update_date` sebagai hari ini. Tenggat, status terlambat, cut-off jam dan stempel waktu tetap memakai jam. Tanpa ini data contoh 24–30 Agu yang dibuka 16 Okt menampilkan potong 17/10, Agustus seluruhnya jurnal dan hari 27–31 Agu kosong.

**Amandemen PRD v5.1 (K38):** tanggal data hanya untuk membaca mart dan menentukan cut-off aktual/outlook. Tanggal potong keputusan harga LB (jam dinding + 1), keputusan, jendela tugas dan grid Input, status putaran, tenggat, cut-off jam, stempel waktu, dan spot memakai jam dinding WIB lewat `clock()` (`apps/web/lib/clock.ts`). Dibangun di v5.1 irisan 2 (R10); sampai irisan itu kode masih memakai tanggal data untuk tanggal potong dan keputusan.

Q-v5-55. Hari kas tanpa satu pun saldo rekening (template kas harian belum di-upload; `cash_position_daily.accounts = 0`) bukan saldo Rp 0: Minggu ini memakai arus kas mingguan, halaman Kas menulis "belum diisi" untuk saldo dan proyeksinya. Keputusan "Pendanaan kas" memakai saldo tanpa pendanaan afiliasi (kolom `closing_without_affiliate`, atau `weekCash.lowestWithoutAffiliate`), sesuai teksnya.

Q-v5-56. Tile yang modulnya aktif tetapi data mart-nya belum dibangun tetap di tempatnya dengan teks "belum dibangun" dan langkahnya (Admin, halaman Modul); tile yang modulnya mati tetap tidak ditampilkan. Baris grid minimal 76 px dan tumbuh mengikuti tile tertinggi; isi tile tidak lagi di-scroll atau terpotong. `.headline` dan `.card` dari stylesheet v1 tidak berlaku di dalam grid v4.

**Amandemen PRD v5.1 (Bab 1.3):** grid `minmax(76px, auto)` menyimpang dari PRD v4 §5.3 "baris 76px" dan diputuskan implementasi; dibuka sebagai O18. Default sementara tetap `minmax`; menjadi amandemen v4 §5.3 bila pemilik menyetujui.

## Pertanyaan terbuka PRD v5.1 (O15–O20)

Dari PRD v5.1 Bab 6: dibangun di belakang parameter, tidak difinalkan implementasi. Kolom "Kode" = keadaan di `67c7f03`.

| # | Pertanyaan | Default sementara | Pemilik | Kode |
|---|---|---|---|---|
| O15 | Baris PO karkas tanpa ukuran: warn + tersimpan STD (K33/C50) atau fail (journey N/B.5)? | warn (`parameter.po_unsized_mode`) | Sales + PPIC | fail; default warn dibangun di irisan 4 (R33) |
| O16 | Stok bebas di Commercial dikurangi komitmen terkunci minggu depan (§4.6) atau tidak (Q-v5-36)? | tidak dikurangi; **ditandai menyimpang dari §4.6** | Kepala Sales + Finance | tidak dikurangi |
| O17 | Journey K: laba rugi di baris 4–7 membuat "Perlu keputusan" di bawah fold 1366×768. Pindah keputusan ke baris 4 kanan (laba rugi lebar 7), default laba rugi collapsed, atau terima scroll? | tidak diubah; klaim journey K "tanpa scroll" dicabut dari bukti sampai diputuskan | Pemilik produk | keputusan di baris 8–12 |
| O18 | Grid v4 §5.3 "baris 76px" vs `minmax(76px, auto)` PR #31 | tetap `minmax`; dicatat sebagai amandemen v4 §5.3 bila disetujui | Pemilik produk | `minmax(76px, auto)` |
| O19 | Baris "Beban tetap belum dijurnal" positif di minggu posting gaji (kumulatif, benar per bulan) vs distribusi ulang per hari | tetap kumulatif; catatan tile menjelaskan | Finance | kumulatif; catatan tile belum menjelaskan angka positif (v5.1 §3.11) |
| O20 | C58: supply tanpa kelas (O2 satu harga) dihitung untuk semua kelas proporsional, atau diabaikan? | diabaikan + C58 menyebut "n kg tanpa kelas" | PPIC + Purchasing | diabaikan, tanpa menyebut kg tanpa kelas (v5.1 §3.11) |

## Pertanyaan terbuka PRD v5.2-A (O21–O33)

Dari PRD v5.2-A Bab 6: dibangun di belakang parameter, tidak difinalkan implementasi. Rekomendasi = pendapat peninjau, bukan keputusan. Pertanyaan yang perubahannya di DB dirujuk ke PRD v5.2-B dengan nomor yang sama.

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

Keputusan lama yang masih terbuka, dengan rekomendasi: **O15** tetap `warn`; **O16** kurangi komitmen terkunci yang belum tertutup PO, sesuai §4.6; **O17** default laba rugi collapsed di ≤ 768 px; **O18** terima `minmax`, amandemen v4 §5.3; **O19** catatan tile; **O20** "n kg tanpa kelas" (R50); **O13** tulis pengecualian 88,2% dan tutup tes `todo`.

## Pelaksanaan PRD v5.1 (Q-v5.1-n)

Keputusan yang diambil saat membangun PRD v5.1 tanpa sign-off per irisan (instruksi pemilik "selesai sampe beres", 17 Okt 2026). Semua menunggu konfirmasi pemilik di PR masing-masing; tidak ada yang di-merge.

Q-v5.1-1. Nomor migrasi (pertanyaan PR #32): semua objek skema v5.1 ada di irisan 1, dalam tiga file `20261024000100_v51_release.sql`, `…0200_v51_security.sql`, `…0300_v51_params.sql` (rentang `202610240001..03` Bab 0). File ketiga memuat skema irisan 2–4 (`advance_update_date` K39, `lock_commitments` + `price_list_week.price_frozen_source` K46, `parameter.po_unsized_mode` O15) supaya KGR-OS cukup sekali menjalankan bundel `docs/v5.1/kgr-os-migrasi-v51.sql` (tiga file, bukan dua seperti checklist). Irisan 2–4 tidak menambah migrasi.

Q-v5.1-2. R3 dibangun harfiah lewat `release_rejections(controls_v3, ['C53'], …)`: C53 BELUM DIISI menahan rilis hanya saat `v4_release` hidup (mode ketat, sama dengan BELUM DIISI kontrol v1); dengan `v4_release` mati hanya GAGAL yang menahan, dan C53 tidak pernah GAGAL. Halaman Kontrol menghitung verdict yang sama (v1 + C53) sehingga override C53 dicatat Finance dari panel override yang sudah ada.

Q-v5.1-3. K43 ikut diterapkan pada dua policy baca Sales (`sales_commitment_read`, `discount_approval_sales_scope`, lewat `alter policy`): tanpa itu Sales dengan assignment `RPA|Karkas|Fresh` bisa menulis komitmen `RPA|Karkas` tetapi tidak bisa membacanya kembali. Akibat K43 "di kedua sisi": assignment `RPA|Karkas|Fresh` juga mencakup `RPA|Karkas|Frozen`. View v1/v4 `commercial_daily_sales` tidak diubah (masih key persis); loader Commercial v5 mencocokkan key dasar seperti view v5.

Q-v5.1-4. K49 (`tg_sales_line_scope`): key baris = `key_manual`, kalau kosong key `item_map` dari `item_code`; assignment `customer` kosong = semua pelanggan, `key` kosong = semua SKU; baris tanpa pelanggan (spot) hanya dicek key-nya.

Q-v5.1-5. R7 menyebut `line_key like upload_prefix%`, tetapi `line_key` PO tidak punya prefiks upload (`<po_ref>|<item_code>|<n>`). Yang dibangun (`lib/v5/po-lines.ts`, dipakai `input-save.ts`): baris lama yang boleh diganti / dihapus = line key berawalan `<po_ref>|` (kanal upload PO), pasangan (PO, pelanggan) ada di file, dan untuk Sales pelanggan miliknya. Tes `apps/web/lib/v5/input-save.test.ts` menguji fungsi itu (file parsial tidak menghapus pelanggan lain di nomor PO yang sama).

Q-v5.1-6. R9 mengasumsikan `sales_assignment.email` tersimpan huruf kecil; di v5 tidak ada yang menjamin. Migrasi 0200 menambah trigger yang menulis email huruf kecil dan sekali `update` baris lama (satu-satunya perubahan data di migrasi v5.1; guard DB sudah membandingkan `lower(email)`).

Q-v5.1-7. R40: `price_list_week` belum punya `deleted_at`; migrasi 0200 menambah `deleted_at`, `deleted_by`. Admin boleh mengisi `deleted_at` pada baris komitmen atau price list yang terkunci asal kolom lain tidak berubah (tidak membuka kunci). Pembaca `price_list_week` menyaring `deleted_at is null` di irisan 4.

Q-v5.1-8. `lock_commitments`: menolak (22023) bila minggu itu tidak punya draft; baris price list yang sudah terkunci untuk key itu tidak ditimpa walau versi komitmen baru dikunci (K24: price list terkunci tidak berubah) — untuk menggantinya Admin mengarsip baris itu (R40) lalu kunci berikutnya menulis harga baru. "sku_price frozen minggu berjalan" = `sku_price` minggu sebelum minggu komitmen (`p_week_start − 7`), key `base_key(key)|Frozen`.

Q-v5.1-9. Pesan K45 sama di DB dan app ("… Admin → Modul → Perbarui status tugas"), sesuai R2. Finance juga bisa membangun grid dari Input → "Perbarui status tugas" (dipakai journey P).

Q-v5.1-10. Sel `release_week` yang tersimpan sebelum K44 diabaikan oleh `k35()` dan `release_week()`; builder grid tidak lagi menulisnya. `k35()` mengembalikan `built: false` untuk minggu tanpa sel, dan override K35 tidak melewati K45.

Q-v5.1-11. Journey P (T8) di stack lokal: fixture asli mengosongkan total Accurate (`accurate_sales_kg`, `accurate_opening_stock_value` = null di `fixtures/week-2026-08-24/parameters.json`), jadi dengan `v4_release` hidup (seperti KGR-OS) C8 dan C9 BELUM DIISI menahan rilis apa pun keadaan K35. "Rilis tanpa override" dijalankan dengan `v4_release` mati di DB lokal; langkah P6 menunjukkan dengan `v4_release` hidup penolakannya hanya C8/C9 (perlu angka Accurate dari Inventory Accounting atau override Finance), bukan K35. Jam uji (faketime) Senin 24 Agu 10.30 WIB: pada 27 Agu 09.00 (Bab 5.2) fixture punya 13 sel merah karena input pemilik v5 (alokasi, keputusan dan supply LB, kartu stok harian) tidak ada di workbook; minggu dengan semua input terisi dibangun oleh journey L (irisan 3).

Q-v5.1-12. R12 Bukti menulis "queue dari 1 Jul (data 27 Agu) → ditolak", tetapi 1 Jul … 27 Agu = 58 hari, di bawah batas 62 hari K40. Yang dibangun mengikuti K40 (62 hari inklusif); tes memakai 27 Jun (62 hari, diterima) dan 26 Jun (63 hari, ditolak). Tanggal terdampak setelah tanggal data (PO minggu depan, keputusan LB besok) hanya meng-queue dirinya sendiri. Upload yang sudah tersimpan tidak digagalkan oleh batas ini: pesannya menyebut "rebuild manual dari Admin".

Q-v5.1-13. K41 di layar: setiap loader halaman memetakan bacaannya ke id tile (`fail(failed, ids, tileData(...))`); tile itu tampil "Gagal memuat data tile ini: <loader> — <tabel>: <pesan PostgREST>", tile lain tetap. Bila loader Manajemen v5 gagal seluruhnya, kedua tile v5 tetap di tempatnya dengan pesan. Tile "x-pending" (mart belum dibangun) dari bagian yang gagal juga menampilkan error, bukan "belum dibangun". Builder, action, Tutup buku, Outlook bulan, dan costing v5 melempar `LoaderError` (rebuild atau halaman menampilkan error).

Q-v5.1-14. "Perbarui status tugas" (Input) memakai `queueThrough` untuk 7 hari jam dinding terakhir; saat tanggal data lebih lama dari jam dinding hasilnya sama dengan sebelumnya (tanggal di depan tanggal data hanya meng-queue dirinya).

Q-v5.1-15. K39 di wizard v4: jurnal (`accurate_journal`, tanggal baris `gl_line` yang disisipkan) dan kartu stok (`stock_card`); di Input v5: WP (`costing_wp`, tanggal batch). Bila RPC gagal, upload tetap tersimpan dan pesannya menyebut "TIDAK dimajukan (…)".

Q-v5.1-16. Lint K41 hanya menangkap pola tertentu; di file yang disentuh irisan ini semua bacaan `const { data } = await …` tanpa cek error juga diganti `must()`. Halaman `app/**` di luar `lib/v4`, `lib/v5` tidak disisir. **Dicabut PRD v5.2-A §1.3, diganti K56 (lint K41 seluruh `apps/web/**` + CI).**

Q-v5.1-17. K51 "lines = unique(K29 ∪ jadwal bulan ini)" dibaca: baris jadwal yang berlaku di bulan itu ∪ baris K29 yang **tidak punya jadwal sama sekali**. Baris K29 yang punya jadwal tetapi tidak berlaku bulan itu (sewa mulai Sep / Nov) tidak diambil dari FINAL bulan lalu: union harfiah menambah sewa Juli 3,3 jt ke Agustus dan mengubah golden B.2 (beban tetap −87,0 → −90,3 jt), yang dilarang R19. Baris tanpa jadwal dan tanpa FINAL: nominal null, sumber "belum ada", tanpa baris `fixed_estimate`. `plTable` menulis "Beban tetap" dan "NIBT setelah beban tetap" null hanya bila **semua** baris null; bila sebagian, total = Σ yang ada dan C55 PERIKSA menyebut baris yang kosong. **Diganti PRD v5.2-A R59 (baris K29 keluar hanya bila semua jadwalnya belum mulai).**

Q-v5.1-18. K50 di jalur lama: kolom `allocation_line.cost_per_kg` NOT NULL, jadi builder M1 (v3) dan `computeWeek` v1 tetap memakai `allocateBatch` tanpa `nullMissing` (biaya 0 + baris issue, golden tidak berubah); jalur v5 (`planCost`, `lib/v5/costing.ts`) memakai null. Harga acuan 0 dihitung kosong. Ledger tidak punya kolom `cost_check`: batch final dengan SKU tanpa harga acuan menjaga lot-nya `sementara` (ada WP) atau `estimasi`; alasannya ("harga acuan kosong: <key>") tampil di layar Costing, dan C54 menyebut SKU itu "biaya belum ada". Tanpa harga LB sama sekali (keputusan, harga batch, `lb_price_today` kosong atau 0) tidak ada biaya rencana; batch itu masuk C57 ("batch …: harga LB belum ada"). **Diganti PRD v5.2-A R61 (akibat ledger).**

Q-v5.1-19. K52 di builder kas: NIBT setelah beban tetap memakai catatan builder bulan (`data_status month_lock`, `note.fixed`). Catatan tanpa `fixed` (bulan dibangun saat `v5_pl` mati atau belum dibangun) = NIBT setelah beban tetap tidak diketahui → `basis_nibt` null → kartu "belum ada (NIBT bulan ini belum bisa dihitung)", bukan NIBT tanpa beban tetap. Kartu "Bulan sampai ekuitas negatif" (Minggu ini, Kas, Outlook bulan) membedakan: angka / "tidak berlaku (laba)" (basis ≥ 0, juga data v4 tanpa basis) / "belum ada" (basis null).

Q-v5.1-20. R14/R15: harga frozen tidak disimpan di draft (`sales_commitment` tidak punya kolomnya); ia bagian dari kunci (`p_price_frozen`). Kolom "harga frozen" di form komitmen milik form kunci (atribut HTML `form`), jadi hanya Kepala Sales / Admin yang mengisinya; nonaktif untuk baris price list yang sudah terkunci (RPC tidak menimpanya, Q-v5.1-8). Aturan R15 yang sama untuk keempat input: baris terkunci nonaktif bagi role yang tidak bisa mengunci (Sales); versi 2 setelah kunci dibuat Kepala Sales dengan alasan (journey L4). `loadPlanning` kini melempar error bila bacaan `sales_commitment` ditolak (sebelumnya `.catch(() => [])`, K41) dan memberi `size_kg` ke engine (versi tertinggi per key dan ukuran).

Q-v5.1-21. R23: `batch_ref` baris PI harus menunjuk batch `status = 'Aktual'` (tidak dihapus, tidak di-supersede); satu ref tanpa batch aktual menolak seluruh upload sebelum baris apa pun ditulis ("batch aktual … belum ada — upload WP batch itu dulu, lalu upload PI ini lagi"). PI tanpa `batch_ref` tetap menjadi biaya periode seperti sebelumnya.

Q-v5.1-22. R21: saldo bank terbawa ke hari berikutnya (`balancesOn`), jadi hari dengan `accounts = 0` berarti belum ada saldo sampai hari itu; `.gt("accounts", 0)` dan `noBalance` di `kas-data.ts` memberi jawaban yang sama. R22/K55: `pl_daily_v4` tidak punya kolom v5 (baris v5 per tanggal diganti `mart_replace`), jadi tidak diubah; `lot_revaluation` (tabel, bukan kolom) tetap hanya ditulis saat `v5_costing` hidup. Pembaca `price_list_week` di Commercial v5 sudah menyaring `deleted_at is null` di irisan ini (bacaan yang diubah untuk harga frozen); pembaca lain di irisan 4.

Q-v5.1-23. R28 / K53 dibaca begini. (a) Pembaca mart Commercial (`commercialMart`, Komersial v4/v5, Manajemen stok bebas) mengambil kolom v5 hanya bila `v5_costing` aktif untuk role yang membuka. Bila tidak, nilainya null dan layar memakai biaya MA seperti v4. (b) Baris v5 di `pl_daily_v4` ("Selisih costing", "Biaya kapasitas idle") adalah baris laba rugi perusahaan, bukan kolom. Baris itu ditulis builder bila flag hidup global dan tidak disaring per role. (c) "Status putaran" menulis "modul belum aktif" menurut flag global (proses berjalan atau tidak), bukan role pembaca. (d) PDF rilis memakai K25 role yang merilis (sama dengan "Unduh PDF" orang itu).

Q-v5.1-24. R29: C57 untuk "Salin ke batch rencana" diambil dari `v5CostingControls`, sama dengan kontrol rilis. C57 hanya ada saat `v5_costing` hidup. Tanggal potongnya adalah batch minggu itu dari `update_date` ke depan. Form Manajemen memutuskan tanggal potong besok (jam dinding + 1, K38), sehingga batch hari ini yang belum diputuskan menahan salin sampai keputusannya ada. Journey M menunjukkan C57 tetap BELUM DIISI setelah 28/08 diputuskan, karena 27/08 (batch 128 Rencana) belum. `reasonAction` menolak alasan untuk C57. **Diganti PRD v5.2-A K58 (C57 di semua jalur salin, satu gate).**

Q-v5.1-25. R35: dengan Input dan Upload sebagai dua item, Finance punya 8 item navigasi. Batas v4 §5.4 adalah 7, sehingga Upload Finance terpotong dari baris menu. Wizard v4 Finance (budget, kas harian, jadwal beban tetap v4) tetap bisa dibuka lewat `/w/<minggu>/upload`. **Perlu keputusan pemilik:** naikkan batas untuk Finance, atau pilih item yang turun dari baris.

Q-v5.1-26. R36: aturan v4 §5.1 butir 3 ("tanpa ikon dan tanpa badge berwarna") juga diterapkan pada daftar cek upload di layar Input yang sama. ✓ ✕ ! i diganti kata "ditahan:" / "catatan:"; cek yang lolos tanpa awalan.

Q-v5.1-27. R37: label kartu menjadi "tanpa pinjaman afiliasi". Dari mart kas, nilainya adalah `closing_without_affiliate` terendah dari hari-hari yang punya saldo. Bila kolom itu kosong di semua hari, kartu menulis "belum ada", bukan 0.

Q-v5.1-28. R38: baris akurasi "NIBT jurnal" dan "NIBT + beban tetap" hanya tampil saat `v5_pl` aktif untuk pembaca. Tanpa flag itu, baris "NIBT" v4 tetap seperti semula. "NIBT + beban tetap" dihitung dari NIBT versi ditambah total `fixed_estimate` yang dibawa snapshot versi itu. Versi tanpa `fixed_estimate` ditulis "belum ada". Kolom FINAL berisi NIBT FINAL, yang sudah memuat semua beban tetap dari laporan keuangan.

Q-v5.1-29. R39: status biaya per segmen adalah `statusMode` dari status key `sku_balance_daily` dalam segmen itu: satu status bila sama semua, "campur" bila berbeda. Status per SKU pada tabel stok umur adalah status key itu. t-batch PPIC memakai `statusMode` dari status biaya v5 batch Aktual minggu itu. Semua status ini hanya tampil saat `v5_costing` aktif untuk role pembaca; bila tidak, kolom kosong.

Q-v5.1-30. R40 dikerjakan dengan tiga catatan. (a) Fail-fast env tidak berlaku saat `next build` (`NEXT_PHASE`), supaya preview tetap terbangun. **Sebelum merge irisan 4, Vercel Production wajib berisi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY`**; tanpa itu app berhenti dengan pesan, tidak diam-diam memakai project pilot. (b) Tinggi grafik dibuat dengan CSS, bukan ResizeObserver: SVG `position: absolute` dalam kotak `min-height` = tileBox 76 px, mengisi tinggi body tile sebenarnya dan menjaga proporsi. Efeknya sama tanpa JS klien. Di lebar 1366 hasilnya identik dengan sebelumnya. (c) `since` v5 costing diisi lewat Admin → Modul (kolom "mulai" pada `v5_costing`). Simpan flag tanpa tanggal tetap mempertahankan tanggal yang tersimpan. Tanpa `since`, revaluasi lot K22 tidak berjalan dan halaman Costing menyebutnya. **Di KGR-OS, Admin perlu mengisi tanggal mulai v5 costing** (sebelumnya otomatis memakai tanggal flag terakhir diubah).

Q-v5.1-31. O15 (R33) dibangun dengan default `warn`. Golden `fixtures/upload-samples/expected.json` untuk PO berubah dari 4 menjadi 5 baris lolos (diff per baris di CHANGELOG [v5.1-4]). Mode `fail` mempertahankan perilaku v5 dan diuji terpisah.

Q-v5.1-32. R31: kode ukuran sekarang memakai dua desimal bila perlu ("Uk 1.25"). Ukuran satu desimal tetap "Uk 1.3", sehingga golden B.3 tidak berubah. Kunci mart `demand_class_weekly (week_start, ship_date, size_code)` tetap unik per ukuran.

Q-v5.1-33. T11: tes `flags-matrix` dan matriks PostgREST memeriksa kata rekomendasi live bird (TUNDA, NEGOSIASI, REKOMENDASI RPA). "BELI" di blok keputusan trading (blok 4) bukan keputusan live bird. K25 tidak menyentuhnya, sehingga blok itu dikecualikan dari pemeriksaan.

## Keputusan v5.2 (diputuskan agen atas delegasi Dika, 17 Okt 2026)

Dasar: brief "selesaikan PRD v5.2" Bab 3 dan Bab 7. Keputusan di bawah menggantikan status "usulan/terbuka" di tabel O15–O33 di atas dan PRD v5.2-B Bab 6.

| # | Keputusan | Akibat di kode / DB |
|---|---|---|
| O13 | Tulis pengecualian 88,2% dan tutup tes `todo` | A3 |
| O15 | `warn` (default `parameter.po_unsized_mode`) | tidak berubah |
| O16 | Stok bebas di Commercial dikurangi komitmen terkunci yang belum tertutup PO (§4.6) | A2/A6 |
| O17 | Laba rugi Manajemen collapsed di ≤ 768 px | A6 |
| O18 | `minmax(76px, auto)` diterima; amandemen PRD v4 §5.3 | tidak berubah |
| O19 | Kumulatif; catatan tile menjelaskan angka positif | A6 |
| O20 | Supply tanpa kelas diabaikan, C58 menyebut "n kg tanpa kelas" | R50 |
| O21 | (b) persis: `base_key` hanya untuk assignment tanpa akhiran bentuk (`assignment_covers`) | B-R83, R58 |
| O22 | (b) C53 BELUM DIISI selalu menahan rilis saat `v5_costing` hidup | B-R84 |
| O23 | (b) Upload Finance masuk panel Input; nav Finance 7 item | R77 |
| O24 | (b) baris memo: production `v5_pl.costing_rows_mode = 'memo'`; golden tetap `'cogs'` | R66; data KGR-OS sesudah A3 di production |
| O25 | (c) impor FS sebagai acuan, app menghitung, C59 membandingkan | B-R86, R68, R69 |
| O26 | ±Rp 1 | C59 |
| O27 | (a) baris Management Report dulu, lalu (b) per akun TB; sebelum Agustus di luar cakupan, saldo awal = TB 31 Jul | R68 |
| O28 | (b) wajib sel K35 s.d. `min(ws+6, wall−1)`; lebih awal butuh override | B-R84 |
| O29 | (b) `v5_*` `roles:["admin"]` sampai T19 lulus, lalu dibuka untuk semua role | KGR-OS (log 17 Okt) |
| O30 | Harian 05.00 WIB (`0 22 * * *`) | R46 |
| O31 | (a) tolak (`23514`) bila harga per ukuran berbeda pada key yang sama | B-R83 |
| O32 | (b) C55 ditegakkan di `release_month` V1 (DB), override Finance | B-R84 |
| O33 | (b) K27 tahap 2 ke PRD berikutnya | tidak dikerjakan |
| O34 | (b) project terpisah `KGR-OS-staging`, compute terkecil | B-R92 |
| O35 | (b) promosi production manual | lihat Q-v5.2-3 |
| O36 | Production `v5_costing.since` = 2026-09-01 (Agustus FINAL dengan biaya M1); staging 2026-08-24 untuk T7 | KGR-OS (log 17 Okt) |
| O37 | Ukur latensi; pindah `icn1` bila halaman > 3 dtk | lihat BUTUH-DIKA |
| O38 | (b) `release_override_policy` hanya lewat migrasi | B-R83 |
| O39 | Tidak menyalin data production ke staging | B-R92 |
| Q-v5-42 | SheetJS 0.20.3 disetujui, versi di-pin, cache pnpm di CI; `.xls` Accurate diterima di UploadPanel (balikkan default R78) | A6 |
| K62, K63 | Ditetapkan (bukan usulan lagi) | R66, R68, R69 |

## Pelaksanaan PRD v5.2 (Q-v5.2-n, diputuskan agen atas delegasi Dika)

Q-v5.2-1. **Backup KGR-OS tanpa `pg_dump`.** Dari container agen, port database KGR-OS dan `api.supabase.com` diblokir (hanya SQL lewat connector Supabase), dan repo ini **publik**, sehingga dump tidak boleh lewat artifact/input GitHub Actions (artifact repo publik bisa diunduh siapa pun). Pengganti: snapshot logis di dalam DB, skema `bak_<UTC>` (salinan semua tabel `public` + `auth.users` + katalog DDL `_ddl` + manifest jumlah baris dan md5 per tabel), tanpa grant ke `anon`/`authenticated`. Perintah: `docs/v5.2/kgr-os-backup.sql`; catatan per backup: `docs/v5.2/kgr-os-log.md`. Ini melindungi dari kesalahan logis bundel/data; kehilangan project tetap bergantung pada backup harian Supabase (plan Pro). **Catatan:** `.github/workflows/backup.yml` mengunggah dump sebagai artifact; di repo publik itu membocorkan data production. Jangan isi `SUPABASE_DB_URL` sebelum workflow itu diubah (artifact dihapus, hanya bucket privat).

Q-v5.2-2. **Lint K41/K42 di `scripts/lint.py`.** `catch {` tanpa binding yang tidak melempar ulang = hit K41 (pola PRD `catch () {` bukan sintaks TS yang sah). Pengecualian per baris dengan penanda `// k41-ok: <alasan>` / `// k42-ok: <alasan>`; penanda tanpa alasan = hit. K42: builder `fetchAll` wajib `.order()` yang mencakup satu kunci unik tabelnya (PK / unique / unique index non-parsial, dibaca dari `supabase/migrations`; kolom yang dikunci `.eq()` dihitung tetap; dua view Commercial memakai kunci `commercial_daily`). `.limit(n>1)` hanya boleh sebagai top-n berurutan (ada `.order(` di builder yang sama) dan tidak pernah di dalam `fetchAll`.

Q-v5.2-3. **O35(b) belum bisa dijalankan agen.** Connector Vercel di sesi ini tidak punya izin project/env/deployment (404/403), dan `*.vercel.app` diblokir dari container. Sampai Dika mematikan auto-assign domain production (BUTUH-DIKA), berlaku aturan urutan merge PRD A Bab 4 secara ketat: kode yang memakai objek DB baru di-merge **sesudah** bundelnya diterapkan di KGR-OS dan tabel ceknya true.

Q-v5.2-4. **"Staging dulu" berlaku juga untuk bundel v5.1 (B0-3).** Bundel v5.1 belum pernah diuji di PG17/Supabase (CI PG16). Bundel v5.1 masuk KGR-OS sesudah lulus di `KGR-OS-staging`. Langkah B0 yang hanya mengubah data (flag O29, `since` O36, antrean B0-6) dijalankan lebih dulu, sesudah backup.

Q-v5.2-5. **`costing_rows_mode = 'memo'` (O24) diisi di KGR-OS sesudah kode A3 di production**, dan `setFlag` (Admin → Modul) mempertahankan field selain `enabled/roles/since`; tanpa itu, menyimpan flag `v5_pl` dari layar Admin menghapus mode.

Q-v5.2-6. **Data production lewat SQL yang meniru upload.** Jalur upload app (template 8.3, upload v4/v5) tidak terjangkau dari lingkungan agen (`*.vercel.app` diblokir, tanpa sesi pengguna). Data yang punya jalur upload dimasukkan dengan SQL berkolom sama dengan hasil upload (`source` sesuai, `upload_id` null), satu berkas per jenis di `docs/v5.2/kgr-os-*.sql`, dengan sumber per angka (berkas + sheet + sel) di kolom `note` atau komentar. Bila Dika ingin jejak upload, berkas yang sama bisa diunggah ulang lewat app (idempoten).

Q-v5.2-7. **Uji bundel DATA = uji kering di KGR-OS.** Staging tidak memuat data production (O39), jadi bundel data (bukan DDL) diuji dengan menjalankannya di KGR-OS dalam `begin … rollback` lalu memeriksa tabel ceknya, sesudah backup. Bundel skema/migrasi tetap wajib lulus di staging dulu.

Q-v5.2-8. **Data master PPIC tidak diisi dari fixture.** PRD v5 (baris 280, 491, 621) menyatakan rentang kelas K/S/B, yield per kelas, dan kapasitas di mockup/fixture adalah ilustrasi yang tidak boleh menjadi seed. Hanya `weight_class` STD (sudah terisi) yang bersumber. `size_class_map`, rentang/rata-rata K/S/B, yield per kelas, dan `capacity` menunggu data PPIC (BUTUH-DIKA D8). Tanpa itu kebutuhan kelas memakai STD (fallback berlabel, O20/R63).

Q-v5.2-9. **Cakupan B-R89.** `fs_mapping_reference` diisi kolom Q sheet `PL`/`BS` FS v2 (kriteria `SUMIFS` Management Report), null bila FS tidak memetakan akun itu; label detail lama (kolom R, "Revenue - LB Main Product" dst.) tidak dipertahankan karena tidak dipakai FS maupun kode. Akun yang muncul di GL September tetapi belum ada di `coa_map` ditambah dengan atribut akun sejenis. `pl_line` hanya dipindah untuk akun non-tetap yang berada di baris K29 (B-CST-1: 6100010, 6200006 perjalanan → Office Transportation expenses sesuai FS; 6400007 selisih stok → Other Income seperti kembarannya 7100006). Beda seksi lain (6300004, 6350001, 7100011) dan label Q yang tidak dipakai Management Report tidak diubah: itu definisi FS yang dicatat di rekonsiliasi, bukan disesuaikan (K62).

**Q-v5.2-10 … 19 (dari B2, `docs/v5.2/b2.md` §6).** Diputuskan agen atas delegasi Dika, 17 Okt 2026. Rincian temuan tetap di `b2.md`.

Q-v5.2-10. **C53 di DB meniru engine** ("BELUM DIISI" = WP belum masuk lewat tenggat; WP yang masuk terlambat tidak menahan). Dipertahankan: DB tidak lebih ketat daripada layar. Prasyarat operasional: `v5_costing` dan `m1_costing` dinyalakan bersama (tanpa `m1_costing`, snapshot tanpa C53 → rilis ditolak, sengaja).

Q-v5.2-11. **C55 dibaca dari snapshot**, tidak dihitung ulang DB. Diterima (K68 tidak menuntut lebih).

Q-v5.2-12. **Penulis `week.update_date` di app** dipersempit ke Admin dan Finance (`roles.ts` area `update_date`), dikerjakan di irisan A1b sebelum bundel B2 aktif di KGR-OS. Upload Admin ke minggu `released`/`closed` yang mengubah `update_date`: buka minggunya dulu (K69).

Q-v5.2-13. **`opening_stock_flag` oleh Inventory Accounting.** Hari ini guard menolaknya *setelah* baris upload stok ditulis (`lib/upload.ts:479` `must(...)`), jadi upload berhenti setengah jalan. Diputuskan: `tg_week_guard` mengizinkan `opening_stock_flag` untuk `inventory_accounting` dan `finance` pada minggu `open` saja (migrasi B5; kolom lain tidak berubah), dengan blok tes RLS.

Q-v5.2-14. **K35**: grid kosong total tetap ditolak walau ada override (K45). Diterima.

Q-v5.2-15. **Sales dan rencana.** Residu `plan_week`/`demand_weekly` terbaca Sales ditutup bertahap: kode `app/komersial/actions-v5.ts` mengambil `plan_week_id` lewat `surplus_for_sales_v52` (A2), lalu policy baca `plan_week`/`demand_weekly` untuk Sales dicabut di B5. Angka "tanpa ukuran" untuk Sales (`input-data.ts`) tidak ditampilkan bagi Sales.

Q-v5.2-16. **Dampak O21(b) pada data**: `sales_assignment` di KGR-OS kosong (dicek 17 Okt 2026, 0 baris), jadi tidak ada assignment berakhiran bentuk yang berubah makna. Assignment dibuat sesudah bundel (B-R87) dengan aturan baru.

Q-v5.2-17. **Price list terkunci yang diarsip permanen**: diterima (A-REL-9). Layar Admin menampilkan peringatan sebelum arsip (A6).

Q-v5.2-18. **Sisa kebocoran biaya ke Sales**: `holding_loss_per_day` dan `downgrade_risk_rp` di dua view Sales ikut dibungkus `sees`, dan `price_floor_rule` tidak terbaca Sales (migrasi B5, kolom view sama). `floor_of` tetap tanpa `execute` untuk klien.

Q-v5.2-19. **Snapshot sebagai bukti**: DB hanya menghitung ulang C53 dan K35. Diterima.

**Q-v5.2-20 … 29 (dari A2, `docs/v5.2/a2.md` §6).** Diputuskan agen atas delegasi Dika, 18 Okt 2026.

Q-v5.2-20…22. **Objek DB untuk A2 (B-R85)**: `plan_check_reason.plan_week_id`, `plan_week_class.detail jsonb`, `batch.lb_price_source` dimasukkan ke migrasi B5 (`docs/v5.2/brief-b5.md`). Sampai bundel B5 ada di KGR-OS, kode memakai pengganti yang tertulis di `a2.md` (alasan C58 terikat versi lewat waktu; pembagian tanggal dari profil demand; provenance di pesan salin). Kode yang memakai kolom itu menyusul sesudah B5 di KGR-OS.

Q-v5.2-23. Forecast mingguan disebar rata 7 hari (meniru `splitHeadsByDay` v4). Diterima; pola lain menunggu data PPIC.

Q-v5.2-24. C58 untuk STD: tanpa supply sama sekali = BELUM DIISI; ada supply tetapi bukan kelasnya, atau kebutuhan STD dengan supply apa pun = PERIKSA; supply tanpa kelas diabaikan (O20). Diterima. Akibatnya, selama `size_class_map` kosong (D8) salin ke batch butuh alasan C58 tertulis.

Q-v5.2-25. Yield matrix berbasis kg LB dibagi (1 − susut) untuk `planBatchRow`; urutan yield kelas → STD → parameter v1, berlabel. Diterima.

Q-v5.2-26. Tanggal potong sebelum tanggal data tanpa keputusan LB tidak ditahan C57; harga jatuh ke supply lalu parameter hari ini (berlabel). Diterima (K25 berlaku untuk keputusan ke depan).

Q-v5.2-27. Upload WP: baris file yang tertahan mempertahankan baris lamanya dan C22 menghitungnya; baris yang tidak ada di file ditarik. Diterima (R58).

Q-v5.2-28. Commit PO upload tetap per baris karena approval C38 per baris. Diterima untuk v5.2.

Q-v5.2-29. Karkas `Frozen` dikeluarkan dari demand kelas (perbandingan bentuk tanpa beda huruf). Diterima (perbaikan bug).
