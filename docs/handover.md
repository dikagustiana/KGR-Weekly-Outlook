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

## 2. Deploy ke Vercel

Build sudah divalidasi dengan `vercel build --prod` (output `.vercel/output` lengkap, font PDF dan fixture contoh ikut ter-bundle).

Konektor Vercel di sesi pembuatan tidak punya izin membuat project (HTTP 403), jadi project dibuat sekali dari dashboard:

1. Gabungkan [dikagustiana/KGR-Weekly-Outlook#1](https://github.com/dikagustiana/KGR-Weekly-Outlook/pull/1) ke `main` (production branch Vercel = `main`).
2. vercel.com → **Add New… → Project** → impor `dikagustiana/KGR-Weekly-Outlook`.
3. **Root Directory: `apps/web`** (wajib — monorepo). Framework terdeteksi Next.js; install/build biarkan default (pnpm terdeteksi dari `pnpm-lock.yaml` + `packageManager`).
4. Environment variables: tidak wajib. Default di `apps/web/lib/env.ts` menunjuk ke project Supabase pilot. Isi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` hanya bila pindah project. `NEXT_PUBLIC_AUTH_GOOGLE=1` menampilkan tombol Google setelah provider Google diaktifkan.
5. Deploy. Region fungsi `hnd1` (Tokyo, dekat Supabase `ap-northeast-1`) diatur di `apps/web/vercel.json`.

Setelah itu setiap push ke `main` otomatis deploy ke production; push ke branch lain = preview.

Cek setelah deploy: buka `/login`, masuk, buka `/w/2026-08-24/outlook` dan `/api/w/2026-08-24/pdf`.

## 3. Supabase

- Project ref `uxqbtverhnpiryhzbenr` (region `ap-northeast-1`). Semua migrasi di `supabase/migrations/` sudah diterapkan.
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
