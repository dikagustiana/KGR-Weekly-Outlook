# PRD v6 irisan 4 — komponen, shell, aksesibilitas

Isi: R130–R148, R164–R172, token E, `app/v6.css` di samping `v4.css` (scope `.v6`). Flag `v6_shell` (Admin dulu). Tanpa flag
tampilan tidak berubah, kecuali perbaikan aksesibilitas yang tidak mengubah tampilan dan berlaku untuk semua (lihat "Untuk semua").

## Komponen (`apps/web/components/v6/`)

| R | Komponen | Catatan |
| --- | --- | --- |
| R134–R136 | `Shell.tsx` (`Shell6`) | baris konteks (KGR · WeekPicker · rilis/kontrol/PDF · nama, role, menu akun) + baris tab (≤ 6, sisanya "Lainnya"); HP satu baris 56 px + menu `<dialog>`; skip link "Lewati ke isi"; `<main id="isi">`; "Lihat sebagai" di menu akun |
| R137 | `WeekPicker.tsx` | `button[aria-haspopup=listbox]` + `ul[role=listbox]`, panah/Home/End/Enter/Esc; ganti segmen minggu di path |
| R133 | `NavProgress.tsx` | bar 2 px dari klik link internal sampai rute baru (capture listener, tanpa mengubah link) |
| R136 | `MobileMenu.tsx` | `<dialog>` native: tab, rilis+PDF, Lihat sebagai, akun, keluar |
| R139 / K89 / K91 | `Card.tsx` (`Card6`) | empat baris; link hanya nilai + chevron, nama "Buka …"; ⓘ = `Drawer` "Sumber dan cara hitung …" |
| R140 / K90 | `Status.tsx`, `lib/v6/status-map.ts` | ikon + kata + warna; kosakata DB dipetakan ke lolos/catatan/terlambat/belum |
| R141 | `Table.tsx` (`Table6`) | caption tersembunyi, `scope`, kolom angka nowrap, teks wrap, HP: kolom pertama sticky, ≤ 4 kolom jadi kartu |
| R132 / R142 / K94 | `TileState.tsx`, `Reload.tsx` | kosong satu baris (+ tautan), gagal `role=alert` + "Muat ulang" (`router.refresh`) |
| R130 | `TileSkeleton.tsx`, `LoadingPage.tsx`, `loading.tsx` di 8 segmen | shell + kerangka tile tanpa animasi, `data-tile-skeleton` |
| R143 / K93 | `DecisionDialog.tsx` | `<dialog>` + `showModal()`; ringkasan ikut sebagai `payload` → disimpan di catatan keputusan (audit, T40) |
| R144 / K92 | `NumberInput.tsx` | `inputMode=decimal`, "dibaca: …"/"tidak terbaca: …" saat blur, `aria-invalid` + `aria-describedby` |
| R145 / R169 | `Drawer.tsx`, `focus-trap.ts` | focus trap, `inert` di luar panel, kunci scroll, Esc, fokus kembali |
| R147 | `Stepper.tsx` | `<li>` tiga baris, status = `Status` |
| R148 | `Headline.tsx` | `<h1>` terlihat + baris `note` |
| R172 | `ScrollFocus.tsx` | tile/tabel yang benar-benar meluap ke samping dapat difokus dan diberi nama (axe `scrollable-region-focusable`) |

`TilePage` (v4) menerima `v6`: kartu → `Card6`, headline → `<h1>` (halaman tidak lagi mencetak `h1.sr-only`), tile kosong → satu
baris 76 px, tile gagal → `TileError`, stepper → `Stepper6`; chip minggu dan baris rilis/PDF tidak dicetak di badan halaman
(sudah di shell, K86/K88), headline pertama di DOM (R138). Dipakai di Minggu ini, Kas, Rencana v4/v5, Outlook bulan v4, Input.

## Untuk semua (tanpa flag; perbaikan tanpa perubahan tampilan)

- `ActionForm` (R146): `role="status"` untuk hasil, `role="alert"` untuk galat (menyebut `field` bila server mengirimnya),
  `aria-disabled` saat proses; `confirm` tidak lagi memakai `window.confirm` — pertanyaan muncul di form ("Ya, lanjutkan" /
  "Batal"); sel angka yang tidak terbaca menahan submit.
- Keputusan harga LB di Minggu ini: `DecisionDialog` (harga, volume rencana, GP rencana minggu, selisih vs harga hari ini, pemutus, jam).
- `CaraHitung` (v4): focus trap + `inert` + nama tombol unik "Cara hitung <judul>" (R170).
- Grafik dengan batang ber-link: `role="group"` (dulu `role="img"` berisi link: axe `nested-interactive`).
- `parseNumber` (K92): "0.725", "1.500" (titik + tepat tiga digit, bacaan desimal < 10) ditolak dengan kalimat cara menulisnya.
  Berlaku juga untuk upload; "24.600" tetap 24600.
- `loadMingguIni`: tujuh blok baca berurutan jadi satu putaran paralel (bagian R131; angka sama, tes v4/v5 hijau).
- `loading.tsx` di 8 segmen: kerangka tampil saat navigasi (dulu layar diam).

## Bukti (stack lokal, data fixture minggu 2026-08-24; bukan production)

Harness `apps/web/scripts/v6-harness.test.tsx` (`npx vitest run -c scripts/vitest.harness.config.ts`) merender Minggu ini di shell
v6 ke HTML statis; `docs/v6/bukti/irisan-4/shot.cjs` membuka di Chromium dan menjalankan axe-core 4.10.3.

| Ukuran | 1366 | 1280 | 390 |
| --- | --- | --- | --- |
| `html.scrollWidth ≤ clientWidth` (T33/T36 sebagian) | ya | ya | ya |
| tab terpotong | tidak | tidak | — (menu) |
| `data-tile-value` pertama (M4) | y = 185 | y = 185 | y = 68 (dulu ≈ 690) |
| tinggi header | 81 | 81 | 56 |
| axe serius/kritis (T32 sebagian) | 0 | 0 | 0 |

Screenshot: `docs/v6/bukti/irisan-4/shot-1366.png`, `shot-390.png`.

Kontras (`lib/v6/contrast.test.ts`): semua pasangan teks ≥ 4,5:1. **Simpangan dari PRD:** `--line-input` `#9aa3b2` yang disebut PRD
terukur 2,54:1 (bukan 3,1:1), jadi dipakai `#858d9c` (3,34:1 di putih, 3,06:1 di `--bg`).

Bundel (`next build`): rute terbesar `/w/[week]/upload` 181 kB First Load JS (sebelum v6: 179 kB; T34 ≤ +10 kB). File
`"use client"` v6: 9 (R178 ≤ 15); total app 21 — angka T34 "≤ 15" baru tercapai sesudah irisan 6 menghapus komponen klien v1/v4.

Belum diuji di sini: T35 (journey keyboard per role), T31 (Lighthouse di staging), T32 penuh (22 screenshot A6 per role) — butuh stack
e2e (PostgreSQL + PostgREST + mock + `next start`) atau staging.
