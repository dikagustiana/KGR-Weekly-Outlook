# PRD — KGR Weekly Outlook: Management View v2

Status: Draft · Owner: Dika (Group Project Finance) · Tanggal: 14 Okt 2026

## 1. Masalah

Halaman `/w/[week]/outlook` dipakai dua audiens dengan kebutuhan berlawanan: preparer (butuh audit trail, rumus, status kontrol) dan manajemen (butuh keputusan dan angka di bawahnya). Saat ini satu halaman melayani keduanya dengan bobot sama. Akibatnya manajemen menerima halaman yang terbaca sebagai tool internal: kesimpulan di posisi terakhir, nama tabel engine (`I_Parameter`, `O_Stok`, `T_Batch`) terlihat, metadata rilis dan email QA terpampang, dan angka risiko terbesar (stok di atas batas umur Rp 2,78 M) tidak ditandai.

## 2. Tujuan

Pembaca manajemen, tanpa scroll, dalam 5 detik mengetahui: (a) GP proyeksi minggu ini dan arahnya vs minggu lalu, (b) keputusan RPA hari ini dengan satu aksi, (c) nilai stok yang harus bergerak. Semua vocabulary preparer tidak terlihat di view manajemen tanpa dihapus dari sistem.

## 3. Non-goals

- Tidak mengubah logika perhitungan engine (yield, breakeven, GP, kontrol). Angka harus identik sebelum–sesudah.
- Tidak redesign palet, tipografi, atau grid (direction: refine, not redesign).
- Tidak menyentuh tab INPUT dan ADMIN selain menyembunyikannya dari role manajemen.

## 4. Requirement

- **R1 — Role-based view.** Dua render dari data yang sama: `management` dan `preparer`. Ditentukan dari role user yang sudah ada (Admin / Group Project Finance / dst — pakai field role existing). Default untuk role non-admin/non-preparer = `management`. Preparer bisa toggle ke view manajemen untuk preview.
- **R2 — Headline block di atas fold (view manajemen).** Satu blok di bawah H1, sebelum tabel apa pun, berisi tiga angka dengan label plain:
  - GP proyeksi minggu: `Rp −47,6 jt (−2,9%)`, Δ vs minggu lalu `−1.626/kg`
  - Keputusan RPA hari ini: satu kalimat aksi (lihat R4)
  - Stok di atas batas umur: `Rp 2,78 M · 116.290 kg · 7 SKU` → link ke detail per SKU

  Angka-angka ini dibaca dari field yang sama dengan tabel di bawahnya, bukan dihitung ulang.
- **R3 — Seksi 2 restruktur.** Urutan: rekomendasi (1 kalimat) → 4 angka penentu (harga LB hari ini, breakeven 100% fresh, margin/kg, perkiraan margin potong rencana) → sisanya di-collapse "Lihat perhitungan". Baris bernilai 0 saat kondisi tidak berlaku (kebutuhan bersih, LB maksimum, porsi fresh) diganti satu kalimat: "Stok fresh 18.768 kg sudah menutup order 12.307 kg — tidak perlu potong tambahan."
- **R4 — Rekomendasi satu aksi.** Format: `[AKSI]: [alasan satu klausa]`. Aksi dari enum `{TUNDA, NEGOSIASI ≤ Rp X, BELI, POTONG N kg}`. Kalau engine menghasilkan TUNDA dan NEGOSIASI bersamaan, aturan: tampilkan NEGOSIASI dengan harga target = breakeven yang berlaku; TUNDA hanya jika tidak ada harga target. Hapus huruf kapital penuh dan titik dua ganda.
- **R5 — Kolom "Cara hitung" pindah.** Di view manajemen: hilang dari tabel, tersedia sebagai tooltip per baris (ikon `?` kecil, bukan ikon di setiap baris secara visual — hover/focus pada label). Di view preparer: tetap tampil. Label sumber (`I_Parameter`, `O_Stok`, `T_Batch`) diganti nama manusia di tooltip (`Parameter harian`, `Stok hari ini`, `Rencana batch`) dengan nama teknis di `title` attribute.
- **R6 — Heading bersih.** Parenthetical metodologi di heading seksi 1 pindah ke footnote bernomor di bawah tabel, digabung dengan footnote yield yang sudah ada. Heading seksi menjadi pernyataan, bukan pertanyaan: "Keputusan RPA hari ini", bukan "potong berapa, beli live bird di harga berapa".
- **R7 — Hierarki tabel ringkasan.** Kolom GP proyeksi, GP % proyeksi, Δ GP/kg = `font-weight: 600`. Kolom pendukung (kg order, revenue order, GP order) tetap tampil, bobot normal, warna teks `--text-secondary`. Tidak ada kolom yang dihapus.
- **R8 — Satu makna per warna.** Merah hanya untuk nilai negatif. Kotak rekomendasi: background netral (`--surface-2`), border kiri 3px warna aksen, tanpa tint merah. Bullet peringatan: teks default dengan label prefix `Peringatan:` bukan warna.
- **R9 — Seksi 4 (stok).** Pill diganti kolom teks biasa `Status` dengan nilai `Kurang / Jual / Di atas batas umur`. Definisi tiap status di footnote. Baris dengan Jumlah SKU = 0 disembunyikan di view manajemen, tampil (abu) di view preparer.
- **R10 — Peringatan dipisah audiens.** Bullet bertipe `data-hygiene` (contoh: "harga acuan kosong … isi di I_Master") hanya tampil di view preparer. Bullet yang sudah terwakili di R2/R4 (LB di atas breakeven) tidak diulang. Engine perlu menandai tipe tiap warning: `{management, preparer}`.
- **R11 — Metadata periode satu kali.** Hapus subtitle "Minggu 24 Agu … Update Kam 27 Agu" di bawah H1; dropdown header sudah membawanya. Format tanggal satu konvensi di seluruh halaman: `24 Agu 2026`.
- **R12 — Bar kontrol & rilis.** Di view manajemen: bar kuning hilang. Yang tersisa satu baris abu kecil di bawah header: `Rilis 27 Agu 2026 · 18/20 kontrol lulus` → link ke tab Kontrol. Email penyusun tidak ditampilkan; nama/role saja. Kata status `PERIKSA` sebagai label keseluruhan diganti `2 belum diisi` (sebut kondisinya, bukan kategori).
- **R13 — Nav per role.** View manajemen: `Outlook · Stok · Batch RPA · Laba Rugi · Neraca · Arus Kas · Rilis`. INPUT dan ADMIN group tidak dirender.
- **R14 — Penomoran seksi.** Hapus angka dari heading seksi. Kalau ada cross-reference, pakai anchor link dengan nama seksi.
- **R15 — Tombol cetak.** Satu tombol `Unduh PDF` (primer-outline). "Tampilan cetak" menjadi text link di sebelahnya atau dihapus kalau PDF sudah mencakup.
- **R16 — Kolom Satuan.** `min-width` cukup agar `Rp/kg LB` tidak patah; atau pindahkan satuan ke dalam sel nilai (`24.600 Rp/kg LB`) dan hapus kolom.

## 5. Acceptance criteria

- Snapshot JSON output engine untuk minggu 24–30 Agu 2026 identik byte-per-byte sebelum–sesudah (kecuali field baru `warning.audience` dan `recommendation.action`).
- Login role manajemen: tidak ada string `I_`, `O_`, `T_`, `@kgr-weekly-outlook`, "bersumber Ops" di DOM.
- Blok headline (R2) tampil di viewport 1366×768 tanpa scroll.
- Rekomendasi mengandung tepat satu aksi dari enum.
- Tidak ada elemen `background` merah/kuning kecuali teks nilai negatif.
- Preparer bisa toggle ke view manajemen dan kembali.
- Tab keyboard menjangkau tooltip R5 dan link "detail per SKU".

## 6. Urutan kerja

1. R1 (role split) — fondasi, tanpa ini sisanya tidak bisa diuji.
2. R2, R4, R9-baris-nol — menyelesaikan "temuan terlihat 5 detik".
3. R3, R5, R10, R12, R13 — menyembunyikan vocabulary preparer.
4. R6, R7, R8, R11, R14, R15, R16 — finishing.
