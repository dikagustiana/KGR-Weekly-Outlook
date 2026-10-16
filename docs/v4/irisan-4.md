# Irisan 4: tutup buku dan rilis server-side

Branch `v4/4-finance-close`, bertumpuk di atas `v4/3-ppic`. Migrasi baru `20261019000100_v4_release.sql` menunggu diterapkan manusia ke KGR-OS bersama migrasi irisan 0–3. Flag baru `v4_release` default mati. Halaman Tutup buku v4 ada di belakang `v4_design`.

Satu hal berubah tanpa flag setelah migrasi diterapkan: rilis mingguan dan kunci versi bulanan tidak lagi bisa ditulis langsung ke tabel. Keduanya lewat `release_week` / `release_month`. Dengan flag mati, aturan mingguan tetap aturan v1 (hanya GAGAL yang menolak). FINAL jalur v3 kini juga ditolak bila ada batch Aktual tanpa output (Q60).

## Requirement dan bukti

| Requirement | Bukti |
|---|---|
| §7.2 rilis di server | `release_week` dan `release_month` (SECURITY DEFINER, `search_path` kosong). Fungsi memeriksa peran, SHA-256 teks snapshot, kontrol di snapshot, STALE dari `rebuild_queue`, urutan versi, FINAL setelah akhir bulan, K9, register P10, dan C48. Alasan penolakan dikembalikan per kontrol. Policy insert langsung ke `release` dan `month_outlook_version` diganti `with check (false)`. `lib/release.ts`, `lib/v4/month.ts`, `lib/v3/monthly.ts` memanggil fungsi itu |
| §7.2 override | tabel `release_override` (kontrol, alasan ≥ 10 karakter, bukti, peran dicap trigger) dan `release_override_policy` (peran per kontrol; C32, C45, C48 tanpa peran; Admin tidak ada di daftar). Form di halaman Kontrol (mingguan, flag hidup), panel Finance di Outlook bulan (V1), dan Tutup buku (FINAL). Komponen `components/v4/OverridePanel.tsx` (Q58, Q59) |
| §6.6 Rilis | tombol rilis di Kontrol dinonaktifkan bila putusan server akan menolak; pesannya menyebut kontrol per kontrol. Putusan memakai `releaseVerdict` engine, aturan yang sama dengan `release_rejections` |
| §6.6 Tutup buku | `/m/[month]/tutup-buku` dengan flag aktif (`app/m/[month]/tutup-buku/v4.tsx`, `lib/v4/close.ts`): penyesuaian DI-xx, pra-cek FINAL (jurnal bulan penuh, penyesuaian diposting, kontrol FINAL), kunci FINAL lewat `release_month`, akurasi V1/V2 sebelum dan sesudah penyesuaian, akurasi per hari, kalibrasi ke register bulan berikut (Q66–Q68) |
| P13 akurasi per hari | builder "accuracy v4" menulis `forecast_accuracy_daily` lewat `mart_replace` (service role) setelah FINAL; dipicu antrean rebuild dari aksi FINAL |
| §3.5 M1 mode RPA sendiri | trigger `batch_cost_mode`: batch bertanggal ≥ 1 Nov 2026 bermode `own`. `overhead_rate.rate_per_head`; `allocateBatch` memakai per ekor bila tarif dan batch punya jumlahnya. Input Rp/ekor di form tarif overhead (Q64). Tes `close-v4.test.ts` |
| C48 | engine `c48`; trigger `allocation_run_c48` menolak posting costing batch tanpa output; `postWeek` menolak lebih dulu dengan pesan; C48 ikut daftar kontrol costing mingguan; `release_month` memeriksa batch bulan itu. Contoh AGRO28–30 (DI-03) di tes |
| §3.5 tanggal biaya vs faktur (DI-01) | `lot_movement.revenue_date` dan `cost_ma_revenue` diisi builder ledger untuk baris faktur yang menggantikan DO Ops; engine `unbilledRevaluation`; Tutup buku menampilkan revaluasi per bulan (Q65) |
| §3.6 rekon terpisah | engine `reconcileSplit` (a–e, kg dan Rp terpisah, tanpa plug); kartu "Rekon persediaan, lima bagian" di `/sku` untuk Admin, Finance, Inventory Accounting (dihitung atas permintaan). Minggu contoh: (e) selisih saldo awal D3 174,4 jt tetap selisih sampai D3 dibukukan atau diputuskan Finance |
| G2 RLS | `docs/v4/bukti/irisan-4-test-rls.txt`: 18 blok, tidak ada hasil (!). Blok 4a dan 4b: sales tidak bisa rilis atau override; SHA berbeda ditolak; insert langsung ditolak; aturan v1 menolak GAGAL walau ada override; aturan §7.2 menolak BELUM DIISI dan STALE; Admin tidak bisa override C8; override Finance mengangkat C8; C45/C48 tidak bisa di-override; V2 sebelum V1, FINAL sebelum akhir bulan, V1 sebelum tanggal K9 ditolak; V1 dengan override C49 terkunci lalu tidak bisa diubah; C48 menolak posting dan FINAL; Cost Accounting boleh override C21 tapi tidak C35; mode RPA sendiri; kolom baru ada. Dua blok lama (v3 F4b, irisan 2) kini mengunci versi lewat `release_month` |
| G3 | golden Pot_ISA/Pot_AGRO dan C21–C24 di `costing.test.ts`; roll-forward 162.687,92 → 156.956,05 kg di `ledger.test.ts`; MA = HPP ≥ 95% masih 88,2% tanpa pengecualian tertulis (Q69) |
| G8 | rilis ditolak di server (blok 4a); snapshot dan versi immutable; rollback satu migrasi diuji pada salinan latihan (`supabase/rollback/20261019000100_v4_release.down.sql`, `docs/v4/bukti/irisan-4-rollback.txt`). Backup/restore belum diverifikasi (Q70) |
| Migrasi | kelima migrasi v4 diterapkan dua kali pada salinan latihan KGR-OS tanpa galat |
| Gate | `docs/v4/bukti/irisan-4-gates.txt`: typecheck lulus; tes engine 270 + 1 todo, parser 23, web 59; parity 17.161/17.161; snapshot EMPTY; build lulus |

## Yang berubah di luar flag

- `tg_week_guard` tidak lagi menganggap `week_end` (kolom generated) berubah. Sebelumnya rilis oleh Finance tidak pernah menandai minggu `released` (Q62).
- `computeMonthV4` mengurutkan minggu dari yang terlama, sehingga parameter (toleransi, `v1_lock_week`, jendela run-rate) dan tabel run-rate diambil dari minggu terakhir bulan itu, sama dengan yang dibaca `release_month`. Sebelumnya `listWeeks` (terbaru dulu) membuat minggu pertama bulan yang dipakai.
- Register yang dihitung engine kini memuat baris manual dan kalibrasi, sehingga pra-cek V1 di halaman sama dengan pemeriksaan server (Q67).

## Screenshot banding

Tidak ada mockup untuk Kontrol, Tutup buku, atau kartu rekon di `reference/design/`, jadi tidak ada banding §9.4 untuk irisan ini. Halaman Tutup buku memakai grammar panel Finance yang sama dengan Biaya tetap & driver.

## Yang belum

- PDF bulanan A4 dua halaman dari snapshot v4 (Q71).
- Biaya kapasitas idle belum masuk `pl_daily_v4` (Q63).
- Mutasi keluar ledger tetap di tanggal faktur (Q65).
- Backup/restore production (Q70) dan pengecualian tertulis MA = HPP (Q69) adalah langkah manusia.
- Builder belum dijalankan terhadap Supabase; fungsi dan kebijakan diuji pada PostgreSQL lokal, engine lewat fixture.
