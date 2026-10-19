# Serah terima — KGR Weekly Outlook (pilot M5)

Untuk: Group Project Finance (pemilik), Admin aplikasi, tim KGR (Sales, PPIC/RPA, Purchasing, Finance, Management).
Repo: `dikagustiana/KGR-Weekly-Outlook`. Spesifikasi: `docs/PRD.md`; Excel acuan: `reference/KGR_Weekly_Outlook.xlsx` (Excel menang bila berbeda — lihat `docs/open-questions.md`).

## 1. Apa yang sudah jadi

| Bagian | Isi | Bukti |
| --- | --- | --- |
| Mesin hitung (`packages/engine`) | O_Stok, blok 1–8 Outlook, Laba Rugi, Neraca, Arus Kas, kontrol 1–20 — decimal.js, tanpa float | 17.161 dari 17.161 sel formula Excel cocok (`docs/parity.md`), angka utama PRD §10, uji aturan per cabang |
| Database (Supabase) | Skema PRD §4, RLS per peran, audit trail, soft delete, minggu ditutup = hanya baca, login allow-list | `supabase/migrations/`, uji peran `supabase/tests/rls_roles.sql` |
| Upload | Accurate (sales, penerimaan, kartu stok, saldo stok, jurnal, neraca saldo), Ops (batch, surat jalan, GRN trading, stock count), CSV order/rencana, workbook Excel lengkap | idempoten: upload ulang file yang sama = 0 baris baru |
| Aplikasi web (`apps/web`) | Outlook, Stok, Batch RPA, Laba Rugi, Neraca, Arus Kas, Kontrol, Rilis, input per tabel, upload wizard, master Item/COA/SKU, Admin (minggu, pengguna, audit), PDF A4 landscape | snapshot dari database identik byte-per-byte dengan snapshot fixture (SHA-256 `947ce203…a83`) |
| Mobile | Hanya baca: Outlook dan laporan; tabel lebar digeser ke samping dengan label baris tetap terlihat | dicek di viewport iPhone 13 |

## 2. Vercel

**Live: https://kgr-weekly-outlook.vercel.app**

| | |
| --- | --- |
| Project | `kgr-weekly-outlook` (`prj_ecSeflSq6gbm3fHMsQleU1MocXyc`) di tim `dikagirawan-4804s-projects` |
| Repo | `dikagustiana/KGR-Weekly-Outlook`, production branch `main`, **Root Directory `apps/web`** |
| Build | Next.js, pnpm (dari `pnpm-lock.yaml` + `packageManager`), Node 22.x |
| Fungsi | region `icn1` (Seoul, satu lokasi dengan KGR-OS `ap-northeast-2`; PRD v6 K84 / R129, sebelumnya `hnd1`), diatur di `apps/web/vercel.json`. Migrasi keduanya ke Singapura = Q-v6-3, keputusan terpisah |
| Env vars | tidak wajib — default di `apps/web/lib/env.ts` menunjuk ke project Supabase pilot. Isi `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` hanya bila pindah project; `NEXT_PUBLIC_AUTH_GOOGLE=1` menampilkan tombol Google |
| Proteksi | domain production publik (aplikasi punya login sendiri); deployment preview memakai Vercel Authentication |

Deploy pertama (14 Okt 2026) dibuat dari branch [dikagustiana/KGR-Weekly-Outlook#1](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/1) ke production. Setelah PR di-merge, setiap push ke `main` otomatis deploy ke production; push ke branch lain = preview.

Diverifikasi di URL live: 29 halaman + PDF/CSV/JSON membalas 200, snapshot minggu contoh SHA-256 `947ce203…a83` (identik dengan fixture), simpan parameter mengubah kontrol 7 seperti di Excel, tanggal mustahil (`/w/2026-02-31`) → 404, tampilan mobile tanpa geser halaman.

## 3. Supabase

- Project ref `uxqbtverhnpiryhzbenr` (region `ap-northeast-1`). Migrasi v1 (`20261014000100`…`000600`) sudah diterapkan; migrasi v3 (`20261016000100`…`001300`) belum — perintahnya di `docs/v3/SUMMARY.md` §2.
- Project baru **KGR-OS** (`pczjhmzpkknzkziipvit`, `ap-northeast-2`): semua 19 migrasi (v1 + v3) dan seed (master + minggu contoh) terpasang dan terverifikasi; semua modul off; belum ada `app_user`. Admin pertama dan env Vercel di `docs/v3/SUMMARY.md` §3.
- Login memakai e-mail + kata sandi. E-mail harus ada di `app_user` (aktif). Pendaftaran mandiri ditolak oleh trigger `kgr_allowlist` (migrasi `…000600_signup_lock`); login dibuat oleh Admin.
- **Admin pertama (sekali saja)** — di Supabase → SQL Editor:

  ```sql
  select public.set_login_password('dika.g.irawan@gmail.com', '<kata sandi kuat, min. 8 karakter>');
  ```

  Fungsi ini tidak bisa dipanggil lewat API (tanpa grant ke `anon`/`authenticated`). Setelah itu Admin membuat login lain di aplikasi: **Admin → Pengguna** (tambah e-mail + peran, lalu "Set kata sandi" sementara).
- Google login (opsional): aktifkan provider Google di Supabase Auth, isi **Site URL** dan **Redirect URLs** dengan domain Vercel (`https://<domain>/auth/callback`), lalu set `NEXT_PUBLIC_AUTH_GOOGLE=1` di Vercel. Hanya e-mail di allow-list yang bisa masuk.
- Disarankan (dashboard Supabase → Auth): aktifkan *leaked password protection* bila paket mendukung.
- Storage: bucket privat `uploads` (file asli upload) dan `releases` (PDF + JSON tiap rilis).

### Bersih-bersih sisa uji (dilakukan / perlu dilakukan)

| Item | Status |
| --- | --- |
| Akun QA `qa.claude@kgr-weekly-outlook.test` (Admin) dipakai untuk uji end-to-end | **dinonaktifkan** (`app_user.active = false`) — tidak bisa masuk lagi |
| Rilis contoh minggu 24–30 Agu 2026 oleh akun QA, baris order uji `QA-ORDER-1` (soft-deleted), entri audit, catatan upload | Dibiarkan sebagai jejak audit minggu contoh. Hapus minggu contoh bila tidak diperlukan |
| Fungsi `public.kgr_seed_exec` (pembantu seed sementara) | Sudah dinetralkan (badan fungsi hanya `raise`, tanpa grant). Hapus permanen di SQL Editor: `drop function public.kgr_seed_exec(text, text);` |

## 4. Ritme mingguan (PRD §2)

| Kapan | Siapa | Langkah di aplikasi |
| --- | --- | --- |
| Senin pagi | Admin | **Admin → Minggu → Rollover**: membuat minggu baru; parameter, harga, run-rate dan neraca saldo dibawa dari minggu lalu; stok awal dari proyeksi akhir minggu lalu (ditandai) sampai upload saldo stok Senin masuk; ringkasan minggu lalu dari rilis terakhir |
| Senin | Inventory Accounting | **Upload**: Accurate *Inventory Valuation (saldo per item)* → stok awal; *Trial Balance* → saldo awal neraca |
| Setiap hari 06:00–10:00 | Inventory Accounting | **Upload**: Accurate *Sales by Item Detail*, *Goods Receipt*, *General Ledger*; lalu ubah **tanggal update** di Parameter |
| Setiap hari | Sales | Order: **Input → Penjualan** (status Order) atau upload CSV; tombol "Terkirim" saat DO terbit; harga jual |
| Setiap hari | PPIC | Rencana dan aktual potong: **Input → Batch**; rencana terima produksi RPA |
| Setiap hari | Purchasing / Ops | Harga live bird hari ini, harga beli trading, rencana terima trading, rencana kas pembelian |
| Setiap hari | Finance | Rencana kas, run-rate, kategori arus kas (klik angka aktual di Arus Kas untuk mengganti kategori) |
| Sebelum dibagikan | Finance / Admin | **Kontrol** → **Rilis** (PDF + JSON tersimpan, tercatat siapa/kapan). Kontrol GAGAL memblokir rilis; PERIKSA / BELUM DIISI boleh dirilis dengan peringatan |
| Akhir minggu | Admin | **Admin → Minggu → status ditutup**: minggu menjadi hanya baca |

Pilot (PRD §11 M5): jalankan dua minggu nyata paralel dengan Excel. Bandingkan blok 1–8 dan laporan tiap hari; catat setiap selisih di `docs/open-questions.md` bagian D (tanggal, angka Excel, angka aplikasi, sel, penyebab, keputusan).

### 4a. Ritme harian v3 (modul M1–M7, `docs/PRD-v3-kgr-platform.md`, flag di Admin → Modul)

Modul baru menyala per peran lewat **Admin → Modul** (default off). Setelah upload, data harian (data mart) dibangun lewat antrian: Admin → Modul → **Proses antrian** (atau otomatis setelah upload v3).

| Kapan | Siapa | Langkah |
| --- | --- | --- |
| Setiap hari, setelah batch potong | Cost Accounting (`cost_accounting`) | **Upload** WP potong per batch (format `Data_COGS_LB`) dan daftar PI pemasok → **Input costing**: periksa tie-out cost pool ke GL (C23) → **Alokasikan** → **Posting** (M1). Biaya per SKU dan per grup tampil di **Costing** |
| Setiap hari 06:00–10:00 | Inventory Accounting | (tambahan) upload *saldo stok per item* Accurate untuk rekon ledger (C26); opname / koreksi lot di **Stok per SKU → SKU** |
| Setiap hari | Sales | **Upload PO lines** (tgl kirim, status demand Confirmed/Tentative/Forecast, sales) dan *forecast per minggu*; order di bawah harga lantai ditolak sampai disetujui (M7 approval) |
| Setiap hari | Commercial Lead (`commercial_lead`) | **Komersial**: SKU *jual hari ini* / *di atas batas umur* dulu (C39); **Approval diskon** ≤ Rp 500/kg (di atasnya Finance); penugasan sales (email login) dan target mingguan; Senin: **Scorecard** minggu lalu |
| Setiap hari | PPIC | **Demand** → **Rencana** (simpan versi; downgrade > Rp 25 jt perlu persetujuan Finance; "Salin ke batch rencana" bila rencana dipakai di blok 2) → **Alokasi hari ini**: "Alokasikan hari ini", lalu **Cut-off pukul 14:00** (sisa fresh di-blast ke frozen) |
| Setiap hari | Purchasing | upload *supply live bird* (tawaran / konfirmasi) |
| Setiap hari kerja | Finance | **Upload template kas harian** (`reference/templates/Template_Kas_Harian.xlsx`: saldo semua rekening + rencana) — C35 Σ rekening = kas neraca, C36 hari tanpa upload; **Kas** / **CCC** |
| Bulanan | Finance | **Biaya** (jadwal biaya tetap: gaji, sewa ABF NMG, bunga; sewa RPA 94,48 jt/bulan mulai Nov 2026); **Bulanan**: budget, kunci V1 (hari kerja ke-20), V2; **Tutup buku**: penyesuaian DI, posting, kunci FINAL (akurasi + kalibrasi bulan berikut); PDF / JSON versi |

Urutan flag yang disarankan dan perintah `supabase db push` per fase: `docs/v3/README.md` dan `docs/v3/SUMMARY.md`.

## 5. Peran (`apps/web/lib/roles.ts`, ditegakkan lagi oleh RLS)

| Peran | Bisa mengubah |
| --- | --- |
| Admin | semua, termasuk pengguna, minggu, master Item/COA/SKU, audit/restore, workbook Excel lengkap |
| Inventory Accounting | upload Accurate (penjualan & penerimaan aktual, stok awal, jurnal, neraca saldo), parameter Accurate |
| Finance | rencana kas, termin, run-rate, kategori arus kas, rilis |
| Sales | order, harga jual |
| PPIC | batch, penerimaan produksi RPA |
| Purchasing / Ops | harga live bird, termin, harga beli, penerimaan trading, rencana kas |
| Management | — hanya baca (Outlook dan laporan, juga di mobile); tidak melihat halaman input |
| Commercial Lead (v3) | semua yang boleh Sales + penugasan / target sales, aturan harga lantai dan urgensi, approval diskon ≤ batas |
| Cost Accounting (v3) | upload WP potong dan PI pemasok, cost pool, tarif overhead, alokasi dan posting costing |

**Tampilan (Management View v2 + v3).** Dengan modul v3, tampilan manajemen mingguan memuat urutan PRD v3 §6: ringkasan (+ outlook bulan vs budget, kas terendah 13 minggu, SKU jual hari ini bila modulnya on) → segmen → keputusan RPA + batch → **Input** → **HPP** (per segmen, per grup SKU dari costing, roll-forward persediaan dari ledger) → trading → stok → kas → demand → akurasi → peringatan. `/sku`, `/komersial` dan `/m/[bulan]` baca-saja di ponsel (form disembunyikan di layar < 760 px). **Management View v2 (`docs/PRD-management-view-v2.md`).** Role Management selalu melihat tampilan manajemen: blok ringkasan di atas (GP proyeksi, keputusan RPA hari ini dalam satu aksi, stok di atas batas umur), tanpa istilah sheet Excel, tanpa menu Input/Admin, dengan baris rilis abu-abu. Role lain melihat tampilan penyusun (istilah dan nomor blok Excel, kolom "Cara hitung", bar kontrol) dan bisa menekan "Pratinjau tampilan manajemen" di topbar untuk melihat yang diterima manajemen. Bukti per tahap: `docs/management-view/README.md`.

Semua peran kecuali Management boleh mengubah tanggal update. Semua perubahan tercatat di Admin → Audit (bisa dipulihkan).

## 6. Untuk pengembang

```bash
pnpm install
pnpm test                       # golden tests + aturan + parser
pnpm typecheck
pnpm outlook --week 2026-08-24 --today 2026-08-27   # blok 1–8 di terminal
pnpm parity                     # tulis ulang docs/parity.md + parity-cells.csv
pnpm dev                        # http://localhost:3000 (butuh apps/web/.env.local atau default env.ts)
pnpm build
```

- Mengubah aturan hitung: ubah di `packages/engine`, tambah/ubah uji di `packages/engine/test`, jalankan `pnpm parity`, catat di `docs/open-questions.md` dan `CHANGELOG.md`. CI menolak perubahan yang menggeser sel golden atau membuat `docs/parity.md` usang.
- Migrasi baru: file baru di `supabase/migrations/` (jangan ubah yang sudah diterapkan), terapkan dengan `supabase db push` atau SQL Editor.
- Snapshot deterministik: `/api/w/<minggu>/snapshot.json` — input sama memberi JSON identik; dipakai untuk membandingkan rilis.

## 7. Masalah umum

| Gejala | Penyebab / tindakan |
| --- | --- |
| "E-mail atau kata sandi salah" | Minta Admin set ulang kata sandi di Admin → Pengguna |
| "E-mail … belum terdaftar" / "Pendaftaran mandiri tidak tersedia" | E-mail belum ada / tidak aktif di Admin → Pengguna |
| Kontrol 1–3 GAGAL (key belum terdaftar / KODE BARU) | Kode item Accurate belum dipetakan: Master → Item / Master → SKU (atau tombol tambah pemetaan di upload) |
| Kontrol 7 PERIKSA (order lewat tanggal) | Order bertanggal sebelum tanggal update belum ditandai Terkirim: tandai Terkirim atau geser tanggal kirim |
| Kontrol 14 GAGAL (akun tanpa mapping) | Tambah akun di Master → COA |
| Kontrol 17 GAGAL (baris kas tanpa kategori) | Isi kategori arus kas di Master → COA, atau ganti kategori voucher di Arus Kas |
| Kontrol 18 GAGAL (pos lawan rencana kas kosong) | Isi pos neraca lawan di Input → Kas |
| Angka berbeda dengan Excel | Bandingkan snapshot JSON; catat di open-questions bagian D; jangan ubah aturan diam-diam |
