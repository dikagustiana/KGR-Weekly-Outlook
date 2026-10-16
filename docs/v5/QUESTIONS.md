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
