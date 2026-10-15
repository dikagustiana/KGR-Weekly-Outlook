# Koreksi data Fase 0 (D1–D9)

Skrip di sini **tidak** dijalankan otomatis. Urutan: (1) terapkan migrasi ke database uji (Supabase branch / `supabase start`),
(2) jalankan skrip di database uji dan periksa hasilnya, (3) Admin menjalankan skrip yang sama di SQL Editor production.
Semua skrip idempoten (aman diulang), mencatat perubahan lewat trigger audit (`audit_log.actor = f0-fix@kgr-weekly-outlook`)
dan menulis baris penjelas di `data_fix`. Minggu contoh 24–30 Agu 2026 tidak diubah (baseline snapshot `947ce203…a83`).

| Skrip | Item | Mengubah data input? |
| --- | --- | --- |
| `F0-D3.sql` | Stok awal (kartu stok Accurate) vs persediaan neraca | Tidak — selisih dicatat per minggu sebagai baris penyesuaian beralasan di `data_fix`; ledger M2 (C27) memakainya sebagai pos rekonsiliasi |
| `F0-D4.sql` | Utang dagang bersaldo debit | Tidak — dicatat; kontrol C37 (Fase 5) menandai di proyeksi |
| `F0-D7-D9-runrate.sql` | Run-rate D&A dan gaji | Ya — `runrate.monthly_amount` minggu ≥ 2026-09-01 |
| `F0-D8.sql` | Neraca saldo awal tidak nol (≤ Rp 1) | Ya — satu baris pembulatan `7100008 Rounding - KGR` per minggu ≥ 2026-09-01 |

D1, D2, D5, D6 tidak punya skrip: keputusan dan kontrolnya di `docs/open-questions.md` §E.
