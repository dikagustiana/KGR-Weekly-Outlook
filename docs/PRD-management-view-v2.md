# PRD — Management View v2 (outlook page)

Oct 14, 2026 · @Dika · Status: draft · Extends `docs/PRD.md` (v1); does not replace it.

## 1. Masalah

Halaman `/w/[week]/outlook` dipakai dua audiens dengan kebutuhan berlawanan: preparer (butuh audit trail, rumus, status kontrol) dan manajemen (butuh keputusan dan angka di bawahnya). Saat ini satu halaman melayani keduanya dengan bobot sama. Akibatnya manajemen menerima halaman yang terbaca sebagai tool internal: kesimpulan di posisi terakhir, nama tabel engine (`I_Parameter`, `O_Stok`, `T_Batch`) terlihat, metadata rilis dan email QA terpampang, dan angka risiko terbesar (stok di atas batas umur Rp 2,78 M pada minggu 24–30 Agu 2026) tidak ditandai.

Audit asal (16 temuan) ada di §8.

## 2. Tujuan

Pembaca manajemen, tanpa scroll, dalam 5 detik mengetahui: (a) GP proyeksi minggu ini dan arahnya vs minggu lalu, (b) keputusan RPA hari ini dengan satu aksi, (c) nilai stok yang harus bergerak. Semua vocabulary preparer tidak terlihat di view manajemen tanpa dihapus dari sistem.

## 3. Non-goals

- Tidak mengubah logika perhitungan engine (yield, breakeven, GP, kontrol). Angka harus identik sebelum–sesudah (golden tests v1 §10 tetap hijau).
- Tidak redesign palet, tipografi, atau grid. Existing system is refined, not redesigned.
- Tidak menyentuh tab INPUT dan ADMIN selain menyembunyikannya dari role manajemen.

## 4. Requirement

**R1 — Role-based view.** Dua render dari data yang sama: `management` dan `preparer`. Ditentukan dari role user yang sudah ada. Default untuk role non-admin/non-preparer = `management`. Preparer bisa toggle ke view manajemen untuk preview.

**R2 — Headline block di atas fold (view manajemen).** Satu blok di bawah H1, sebelum tabel apa pun, berisi tiga angka dengan label plain:

- GP proyeksi minggu: `Rp −47,6 jt (−2,9%)`, Δ vs minggu lalu `−1.626/kg`
- Keputusan RPA hari ini: satu kalimat aksi (R4)
- Stok di atas batas umur: `Rp 2,78 M · 116.290 kg · 7 SKU` → link ke detail per SKU

Angka-angka ini dibaca dari field yang sama dengan tabel di bawahnya, bukan dihitung ulang.

**R3 — Seksi RPA restruktur.** Urutan: rekomendasi (1 kalimat) → 4 angka penentu (harga LB hari ini, breakeven 100% fresh, margin/kg, perkiraan margin potong rencana) → sisanya di-collapse "Lihat perhitungan". Baris bernilai 0 saat kondisi tidak berlaku (kebutuhan bersih, LB maksimum, porsi fresh) diganti satu kalimat: "Stok fresh 18.768 kg sudah menutup order 12.307 kg — tidak perlu potong tambahan."

**R4 — Rekomendasi satu aksi.** Format: `[Aksi]: [alasan satu klausa]`. Aksi dari enum `{TUNDA, NEGOSIASI ≤ Rp X, BELI, POTONG N kg}`. Kalau engine menghasilkan TUNDA dan NEGOSIASI bersamaan: tampilkan NEGOSIASI dengan harga target = breakeven yang berlaku; TUNDA hanya jika tidak ada harga target. Tanpa huruf kapital penuh, tanpa titik dua ganda. *(Aturan prioritas ini keputusan bisnis — konfirmasi sebelum implementasi.)*

**R5 — Kolom "Cara hitung" pindah.** View manajemen: hilang dari tabel, tersedia sebagai tooltip pada label baris (satu ikon `?` kecil, muncul on hover/focus). View preparer: tetap tampil. Label sumber (`I_Parameter`, `O_Stok`, `T_Batch`) diganti nama manusia di tooltip (`Parameter harian`, `Stok hari ini`, `Rencana batch`) dengan nama teknis di `title` attribute.

**R6 — Heading bersih.** Parenthetical metodologi di heading ringkasan ("HPP dari Accurate; order dinilai di …; cost of sales others tidak termasuk") pindah ke footnote bernomor di bawah tabel, digabung dengan footnote yield yang sudah ada. Heading seksi menjadi pernyataan: "Keputusan RPA hari ini", bukan "potong berapa, beli live bird di harga berapa".

**R7 — Hierarki tabel ringkasan.** Kolom GP proyeksi, GP % proyeksi, Δ GP/kg = `font-weight: 600`. Kolom pendukung (kg order, revenue order, GP order) tetap tampil, bobot normal, warna `--text-secondary`. Tidak ada kolom yang dihapus.

**R8 — Satu makna per warna.** Merah hanya untuk nilai negatif. Kotak rekomendasi: background netral (`--surface-2`), border kiri 3px warna aksen, tanpa tint merah. Bullet peringatan: teks default dengan prefix `Peringatan:` bukan warna.

**R9 — Seksi stok.** Pill diganti kolom teks `Status` dengan nilai `Kurang / Jual / Di atas batas umur`. Definisi tiap status di footnote. Baris dengan Jumlah SKU = 0 disembunyikan di view manajemen, tampil (abu) di view preparer.

**R10 — Peringatan dipisah audiens.** Engine menandai tiap warning `audience: 'management' | 'preparer'`. Bullet data-hygiene ("harga acuan kosong … isi di I_Master") = preparer. Bullet yang sudah terwakili di R2/R4 (LB di atas breakeven) tidak diulang di management.

**R11 — Metadata periode satu kali.** Hapus subtitle "Minggu 24 Agu … Update Kam 27 Agu" di bawah H1; dropdown header sudah membawanya. Format tanggal satu konvensi: `24 Agu 2026`.

**R12 — Bar kontrol & rilis.** View manajemen: bar kuning hilang. Sisa satu baris abu kecil di bawah header: `Rilis 27 Agu 2026 · 18/20 kontrol lulus` → link ke tab Kontrol. Email penyusun tidak ditampilkan; nama/role saja. Label status `PERIKSA` diganti kondisinya: `2 belum diisi`.

**R13 — Nav per role.** View manajemen: `Outlook · Stok · Batch RPA · Laba Rugi · Neraca · Arus Kas · Rilis`. Group INPUT dan ADMIN tidak dirender.

**R14 — Penomoran seksi.** Hapus angka dari heading seksi. Cross-reference pakai anchor link dengan nama seksi.

**R15 — Tombol cetak.** Satu tombol `Unduh PDF`. "Tampilan cetak" menjadi text link atau dihapus kalau PDF sudah mencakup.

**R16 — Kolom Satuan.** `min-width` cukup agar `Rp/kg LB` tidak patah; atau satuan masuk ke sel nilai dan kolom dihapus.

## 5. Acceptance criteria

- [ ] Snapshot JSON output engine untuk minggu 24–30 Agu 2026 identik sebelum–sesudah, kecuali field baru `warning.audience` dan `recommendation.action`.
- [ ] Login role manajemen: tidak ada string `I_`, `O_`, `T_`, `@kgr-weekly-outlook`, "bersumber Ops" di DOM.
- [ ] Blok headline (R2) tampil di viewport 1366×768 tanpa scroll.
- [ ] Rekomendasi mengandung tepat satu aksi dari enum.
- [ ] Tidak ada elemen dengan background merah/kuning; merah hanya pada teks nilai negatif.
- [ ] Preparer bisa toggle ke view manajemen dan kembali.
- [ ] Tab keyboard menjangkau tooltip R5 dan link "detail per SKU".
- [ ] Golden tests v1 (§10 PRD v1) tetap lulus.

## 6. Urutan kerja — satu PR per tahap

1. R1 (role split) — fondasi.
2. R2, R4, R9-baris-nol — temuan terlihat 5 detik.
3. R3, R5, R10, R12, R13 — sembunyikan vocabulary preparer.
4. R6, R7, R8, R11, R14, R15, R16 — finishing.

## 7. Keputusan terbuka

- R4: aturan prioritas NEGOSIASI > TUNDA — konfirmasi Dika.
- R2: angka "stok di atas batas umur Rp 2,78 M" — kalau mayoritas frozen dengan umur normal, headline menyesatkan; alternatif: `kelebihan umur × hari` atau nilai yang melewati batas saja.

## 8. Audit asal (slop-filter AFTER mode, 14 Okt 2026)

Hard gate U-01–U-10: PASS. Liveliness: FAIL — tiga temuan minggu (GP −47,6 jt; potong rencana −105 jt; stok tua 2,78 M) tidak terlihat dalam 5 detik.

| # | Temuan | Rule | → R |
|---|---|---|---|
| 1 | Kesimpulan di posisi terakhir (14 baris sebelum rekomendasi) | direction: finding-first | R3 |
| 2 | Dua aksi "TUNDA / NEGOSIASI", titik dua ganda | one primary action | R4 |
| 3 | `I_Parameter`, `O_Stok`, rumus Σ di kolom Cara hitung | audience | R5 |
| 4 | Metodologi 20 kata di heading | U-18 / proporsi | R6 |
| 5 | 14 kolom bobot seragam | proporsi | R7 |
| 6 | Tiga baris bernilai 0 | U-23 | R3 |
| 7 | Merah = negatif + rekomendasi + peringatan | legibility of status | R8 |
| 8 | Pill berisi definisi, di setiap baris | "badge that is a column" | R9 |
| 9 | Rp 2,78 M stok tua tanpa penekanan | hierarki | R2 |
| 10 | Peringatan mencampur audiens, duplikat R4 | audience | R10 |
| 11 | Periode diulang 3× dengan 2 format tanggal | Tier 3 | R11 |
| 12 | Nomor seksi 1, 2, 4, 7 | konsistensi | R14 |
| 13 | Bar kontrol kuning, email QA, "PERIKSA" dengan 0 PERIKSA | audience / status | R12 |
| 14 | 23 tab termasuk INPUT/ADMIN | proporsi | R13 |
| 15 | Dua tombol cetak bobot sama | one label per intent | R15 |
| 16 | `Rp/kg LB` patah di kolom Satuan | U-17 | R16 |
