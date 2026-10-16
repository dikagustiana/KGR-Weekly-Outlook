# Irisan 5: komersial

Branch `v4/5-commercial`, bertumpuk di atas `v4/4-finance-close`. Migrasi baru `20261020000100_v4_commercial.sql` menunggu diterapkan manusia ke KGR-OS bersama migrasi irisan 0–4. Halaman Komersial v4 ada di belakang `v4_design`. C38 berjalan selama `m7_approval` hidup, dan jalur spot selama `parameter.spot_enabled` hidup; keduanya default mati.

## Requirement dan bukti

| Requirement | Bukti |
|---|---|
| C38 tidak bisa dibypass lewat API | trigger `floor_guard_v4` (AFTER, menggantikan `floor_guard`): setiap baris Order, PO maupun spot, di bawah lantai butuh approval yang disetujui dan belum terpakai. Approval dikaitkan ke baris dalam transaksi yang sama dengan kunci baris (`take_approval`). Order kedua dengan approval yang sama ditolak; menaikkan kg di atas approval ditolak (Q77) |
| Journey B | blok RLS "v4 irisan 5": Sales melihat SKU penugasannya dengan lantai, Sales tanpa penugasan tidak melihat apa pun; order di bawah lantai ditolak; permintaan menunggu; Sales tidak bisa menyetujui sendiri; commercial lead tidak bisa menyetujui di atas batas; Finance menyetujui; order dengan approval masuk dan approval terkait; order kedua ditolak; baris tanpa approval tidak bisa dialokasikan (`allocation_floor`), baris yang disetujui bisa (Q73) |
| Jalur spot (K8, P3.9) | trigger `spot_guard`; engine `spotCheck` (aturan yang sama, untuk halaman); aksi `spotSaleAction`; blok RLS: spot di lantai lolos, di atas stok fresh bebas, dengan PO, untuk besok, bukan jual hari ini, setelah cut-off, dan saat spot mati ditolak; commercial lead bisa mencatat spot (Q75) |
| Scorecard kg spot | engine `scorecard` (`kg_spot`), kolom `sales_scorecard_weekly.kg_spot`, kolom di halaman Scorecard (Q76) |
| §6.7 grammar v4 | `/komersial` dengan flag aktif: model `lib/v4/komersial.ts`, halaman `app/komersial/v4.tsx`. Kartu (SKU jual hari ini, risiko turun ke frozen, SKU dengan stok bebas, approval menunggu), tabel ranking, tile spot, antrian approval dengan aksi Setujui/Tolak/Buat order, kontrol C38–C40. Lantai atau MA kosong tertulis "belum diisi". Tes `lib/v4/komersial.test.tsx` (5) |
| G2 | `docs/v4/bukti/irisan-5-test-rls.txt`: 19 blok, tidak ada hasil (!) |
| Migrasi | keenam migrasi v4 diterapkan dua kali pada salinan latihan KGR-OS tanpa galat |
| Gate | `docs/v4/bukti/irisan-5-gates.txt`: typecheck lulus; tes engine 275 + 1 todo, parser 23, web 64; parity 17.161/17.161; snapshot EMPTY; build lulus |

## Yang berubah di luar flag

Tidak ada. Semua aturan baru berlaku hanya bila `m7_approval` atau `spot_enabled` hidup. Satu pengecualian kecil di upload: faktur atau surat jalan dengan nomor dokumen yang sama dengan baris spot ikut ditandai spot. Ini hanya terjadi bila baris spot sudah ada.

## Yang belum

- Baris Aktual (surat jalan, faktur) tidak dicek C38 (Q74).
- Halaman Komersial v4 hanya untuk hari ini (Q78).
- Tidak ada mockup, jadi tidak ada banding screenshot.
