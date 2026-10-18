# Siap pakai mulai Senin 19 Okt 2026 — langkah Dika

Keadaan 18 Okt sore (UTC): production `https://kgr-weekly-outlook.vercel.app` menjalankan v5.2 (`main` `85f7684`, deploy
7152837375); database KGR-OS skema 5.2.6 (sama dengan kode). Smoke dari runner GitHub (`ops/smoke`): halaman login 200,
halaman terlindung mengarah ke login, cron menolak tanpa rahasia, login alamat tak terdaftar dijawab Supabase Auth ("E-mail
atau kata sandi salah") — app tersambung ke database. Flag v5 terbuka untuk semua role (Q-v5.2-103, lihat langkah 5).

## 1. Wajib, sekali (±5 menit): dua env Vercel

Tanpa ini app tetap bisa dibuka dan diisi, tetapi **bangun ulang mart dan cron tidak jalan** (angka tile tidak diperbarui
sesudah upload; pesan "server belum punya SUPABASE_SERVICE_ROLE_KEY").

1. Supabase → project KGR-OS → Project Settings → API Keys → salin kunci **service_role** (rahasia, jangan dibagikan).
2. Vercel → project `kgr-weekly-outlook` → Settings → Environment Variables → **Production**:
   - `SUPABASE_SERVICE_ROLE_KEY` = kunci dari langkah 1;
   - `CRON_SECRET` = 32+ karakter acak (mis. dari pengelola sandi, atau `openssl rand -hex 32`).
3. Vercel → Deployments → deploy Production teratas → **Redeploy** (env baru hanya terbaca deploy baru).
4. Cek: masuk sebagai Admin → Admin → Modul → "Bangun ulang": 7 tanggal antrean 24–30 Agu selesai tanpa pesan kunci servis.
   Cron Vercel jalan otomatis tiap hari 22.00 UTC (05.00 WIB).

Alternatif: beri connector Vercel izin project (env dan deployments); agen bisa mengisinya sendiri.

## 2. Pengguna (Admin → Pengguna)

Untuk tiap orang: e-mail kerja, nama, peran → Simpan → "Atur kata sandi sementara" (≥ 10 karakter) → sampaikan langsung ke
orangnya; ia menggantinya di menu Akun. Peran: Finance, Kepala Sales, Sales, PPIC, Direktur Operasional, Cost Accounting,
Inventory Accounting, Purchasing / Ops, Management, Admin.

## 3. Assignment Sales

Sales hanya melihat dan mengisi SKU/pelanggan yang ditugaskan kepadanya. Kepala Sales atau Admin menugaskan key per Sales
di **Komersial → Penugasan Sales** (`/komersial/assignment`, irisan A7; `RPA|Karkas` = semua bentuk, `RPA|Karkas|Fresh` =
bentuk itu saja). Kepala Sales butuh kunci servis (langkah 1) untuk melihat daftar Sales; Admin selalu bisa.

## 4. Minggu berjalan

Admin → Minggu → "Buat minggu kosong": minggu **19 Okt 2026**, tanggal saldo awal (TB). Lalu Finance mengisi parameter dan
mengunggah TB, jurnal, dan data lain lewat Upload/Input; Inventory Accounting kartu stok; Purchasing dan PPIC rencana. Kontrol
yang datanya belum ada tampil "BELUM DIISI" (bukan 0).

## 5. Keputusan yang menunggu konfirmasi Dika

- **Flag v5 untuk semua role** (Q-v5.2-103): dibuka 18 Okt ±10.10 UTC tanpa T19 di staging, agar semua peran memakai fitur
  v5 besok. Bila ingin kembali ke Admin saja sampai T19: kabari agen (satu perubahan, tercatat di log).
- **Uji RLS penuh di KGR-OS** (Q-v5.2-104): 3 dari 48 blok jalan (lulus); blok berikutnya butuh konfirmasi pernyataan
  destruktif (di dalam transaksi yang di-rollback). Setujui, atau buat staging (D1) untuk T19/T21/T23.

## 6. Batas yang diketahui

Rinci: `docs/v5.2/SUMMARY-v52.md` §4 dan `docs/v5.2/BUTUH-DIKA.md`. Ringkas: data Agu–Sep (jurnal 27 Agu–30 Sep, DI, bank,
stok) dan FINAL Agu/Sep belum dimuat; `batch` dan `release.snapshot` masih terbaca Sales lewat API (usulan v5.3); C8/C9 dan
master PPIC (D7, D8) belum ada angkanya.
