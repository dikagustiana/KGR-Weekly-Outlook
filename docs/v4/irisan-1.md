# Irisan 1: design system dan halaman Minggu ini

Branch `v4/1-design-system`, bertumpuk di atas `v4/0-foundation` (PR #18). Semua yang baru ada di belakang flag `v4_design`, default mati: dengan flag mati setiap halaman tampil seperti sebelumnya. Migrasi baru `20261017000300_v4_design_flag.sql` (flag, dan trigger yang memasukkan minggu ke antrian rebuild saat run-rate, parameter, harga jual, atau stok awal berubah) menunggu diterapkan manusia ke KGR-OS bersama dua migrasi irisan 0.

## Requirement dan bukti

| Requirement | Bukti |
|---|---|
| §5.2 token | `reference/design/tokens.css`, `apps/web/app/v4.css` (di-scope ke `.v4`). Dua token gagal kontras saat diukur dan diganti (Q21). Pemeriksa kontras 10 pasangan lulus: `docs/v4/bukti/minggu-ini-banding.md` |
| §5.3 komponen | `apps/web/components/v4/`: TileGrid/Tile, Slicer, ModeToggle, Card, Chart (kolom+garis, waterfall, batang berpasangan, batang bertumpuk), Table (sticky header, baris total, keadaan kosong dan terpotong), Note, StatusText, CaraHitung (drawer), ReleaseLine, ActionBar, Stepper. Tes render dan tes keyboard drawer (8 langkah, Chromium sungguhan): `docs/v4/bukti/irisan-1-drawer.txt` |
| §5.4 shell dan navigasi | `lib/v4/nav.ts` (7 item per peran, item modul mati tidak dirender, halaman awal per peran), `components/Shell.tsx` memakai `V4Frame` saat flag aktif, `/` mengarahkan ke halaman awal peran, `/admin` (Q19). Tes `lib/v4/nav.test.ts` |
| §5.5 mockup | `reference/design/{minggu-ini,outlook-bulan,kas-solvabilitas,ppic-rencana}.html`, ditulis oleh `reference/design/src/build-mockups.mjs`; sumber angka per tile di `data-src` (Q22) |
| §3.4 `weekOutlook` | `packages/engine/src/week-outlook.ts`: `weekPlDaily`, `weekOutlook`, `gpBridge`, `weekHeadline`, `weekCash`, `stockOverAge`, `stockAgeBuckets`. `computeWeek` tidak disentuh. Tes `week-outlook.test.ts` (10): Σ baris per akun = P&L mingguan sampai sen; GP P&L −67,5 jt (−4,1%); jembatan −47,6 + 17,8 − 0,8 − 20,6 − 16,4 = −67,5 jt dengan sisa 0; headline §6.1 |
| §6.1 halaman | `app/minggu-ini/[week]/page.tsx`, model murni `lib/v4/minggu-ini.ts`, pembaca `lib/v4/minggu-ini-data.ts`, mart `pl_daily_v4` mingguan dibangun `lib/v4/week-pl.ts`. Tes `minggu-ini.test.tsx` (13): koordinat 19 tile sama dengan tabel PRD, tidak ada tile tumpang tindih, modul mati = tile tidak dirender (bukan "tidak tersedia"), `t-input` dan `t-cogs` selalu ada, K16 (Rp jt, U+2212, tanpa "→" dan "M") |
| K15, K18 | dengan flag aktif, view manajemen `/w/[week]/outlook` dialihkan ke Minggu ini: tidak ada blok 2 (keputusan RPA) dan blok 5 (kas keluar). View preparer, tampilan cetak, dan PDF tetap membawa semua blok v1 (parity) |
| K16, K17 | semua angka Rp jt satu desimal dengan "−" (U+2212); halaman membaca `pl_daily_v4` dan mart modul, tidak menghitung ulang; headline dan jembatan dihitung engine |
| §9.4 pemeriksa | `apps/web/scripts/v4-screens.mjs`: screenshot 1366×768 dan penuh, selisih per tile (posisi grid, ukuran px, judul, nilai, catatan, isi terpotong), above-fold baris 0–3, grep DOM, kontras. Harness tanpa Supabase: `apps/web/scripts/v4-fixture.tsx` |
| Above-fold | baris 0–3 berakhir di 415px dari 768px, scrollY = 0 |
| Grep DOM | `I_`/`O_`/`T_` 0, e-mail 0, "bersumber Ops" 0, "→" 0, " M " 0, hex inline 0, fontSize inline 0 |
| Snapshot | `pnpm snapshot:diff`: EMPTY, byte-identik; parity 17.161/17.161 |
| G1 | engine 197 + 3 todo, parser 20, web 35; typecheck, build lulus. G2: `docs/v4/bukti/irisan-1-test-rls.txt`, 14 blok, 0 hasil (!) |

## Selisih mockup lawan halaman yang disetujui

`docs/v4/bukti/minggu-ini-banding.md` mencatat lima selisih. Semuanya terjelaskan; belum ada persetujuan pemilik, jadi statusnya "diusulkan".

| Tile | Selisih | Sebab |
|---|---|---|
| `headline` | halaman tidak memuat kalimat kas; stok 685,4 jt, bukan 2.782,2 jt | Q18 (syarat 0,25 × rata-rata tidak terpenuhi), Q17 (ledger memakai definisi per lot) |
| `c-outlook` | 1.656,8 jt, bukan 1.639,0 jt | Q16 (basis jurnal untuk hari yang lewat) |
| `c-stok` | 685,4 jt / 38.659,8 kg / 30 SKU, bukan 2.782,2 jt / 116.289,8 kg / 7 | Q17; dengan M2 mati halaman menampilkan 2.782,2 |
| `c-bulan` | tidak dirender | M4 mati; datanya (outlook bulan, budget) dibangun irisan 2 |
| `demand` | tidak dirender | M3 mati; datanya dibangun irisan 3 |

## Cara menjalankan

```
cd apps/web
npx tsx --tsconfig scripts/tsconfig.json scripts/v4-fixture.tsx <dir>     # render halaman dari fixture
node scripts/v4-screens.mjs ../../reference/design/minggu-ini.html <dir>/minggu-ini.html minggu-ini ../../docs/v4/bukti
node scripts/v4-drawer.test.mjs
```

Untuk halaman asli dengan sesi login, simpan HTML halaman (`page.content()`) dan berikan sebagai argumen kedua.

## Yang belum

Perbandingan dengan halaman asli di Vercel preview belum dilakukan: preview butuh login dan flag `v4_design` dinyalakan di database yang dipakai preview, dan keduanya tindakan di luar batas pekerjaan ini. Bukti screenshot di sini berasal dari fixture. Halaman Outlook bulan, Kas & solvabilitas, dan Rencana di navigasi menunjuk ke halaman yang ada sekarang (`/m/[month]`, `/kas`, `/w/[week]/rencana`) sampai irisan 2 dan 3.
