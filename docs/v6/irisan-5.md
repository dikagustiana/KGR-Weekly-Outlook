# PRD v6 irisan 5 — konten dan layar

Isi: R149–R163, K95–K98, glosarium, lint R156. Flag `v6_pages` (butuh `v6_shell`; Admin dulu, dibuka per role sesudah T37–T40
role itu). Tanpa flag teks dan angka utama layar tidak berubah, kecuali R149 (lihat bawah).

| R / K | Isi | File |
| --- | --- | --- |
| R149 / K97 | Headline Outlook bulan: NIBT kedua hanya bila beda sesudah pembulatan 0,1; "(C55)" hilang. **Berlaku untuk semua** (perbaikan angka ganda). | `lib/v5/pl-tiles.ts` |
| R150 / R157 / K89 | Minggu ini: kartu "GP minggu" (GP angka utama; revenue, Δ GP pembanding), "Kas terendah tanpa afiliasi" (kekurangan tanpa afiliasi angka utama + "butuh afiliasi Rp … jt sebelum …"), Solvabilitas = ekuitas ÷ modal disetor % (+ utang berelasi ÷ ekuitas ×), Outlook bulan = GP, kartu baru "Keputusan menunggu"; Δ dari angka tampil | `lib/v4/minggu-ini.ts` (`v6`), tes `lib/v6/minggu-ini-v6.test.tsx` |
| R157 / K98 | Laba rugi: toggle segmen KGR / RPA / Trading (`?plseg=`); akrual yang nol di periode jadi memo di tampilan manajemen | `lib/v5/pl-tiles.ts` (`accrualAsMemo`), `app/minggu-ini/[week]/page.tsx` |
| R151 | `releaseReadiness` satu sumber "Siap rilis" (kartu = headline), `Status` di kartu | `lib/v6/readiness.ts` |
| R152 | Daftar tugas satu baris per tugas (nama · tenggat · Status), terlambat dulu, dampak sekali di atas, `<details>` | `components/v6/TaskList.tsx` |
| R153 / R162 | Kartu Input hanya angka atau Status; "wizard v4", "tidak ditampilkan" dihapus; headline satu kalimat + note jam/cut-off; kelengkapan data harian sebagai tabel Status; catatan O8 "belum dibangun" hilang | `lib/v6/input-v6.ts`, `components/v6/CompletenessGrid.tsx`, `app/input/page.tsx` |
| R154 / R155 / K95 | Glosarium satu sumber; `plain()` menghapus kode/istilah internal dari teks tile (drawer tetap memuat kode) | `lib/v6/glossary.ts`, `lib/v6/plain-model.ts`, `docs/v6/glosarium.md` |
| R156 | `scripts/lint.py v6`: (a) kode di teks, (b) `window.confirm/alert` (0), (c) placeholder tanpa label, (d) nama role di luar glosarium; (a)(c)(d) ratchet `scripts/lint-fixtures/v6/baseline.txt`; fixture bad/good; langkah CI | `scripts/lint.py`, `scripts/test-lint.sh`, `.github/workflows/ci.yml` |
| R158 | Outlook bulan: GP angka utama di kartu actual/forecast/outlook; "vs Budget" hilang tanpa budget; nilai di setiap batang | `lib/v6/outlook-bulan-v6.ts` |
| R159 | Kas: kosong satu baris + "isi di Sheet kas"; bunga per tahun utang berelasi; "jatuh tempo belum diisi" (Q-v6-5 default); grafik 13 minggu mulai 2 titik; form termin `NumberInput` | `lib/v4/kas.ts`, `components/v4/TilePage.tsx` |
| R160 | Komersial: konteks cut-off jadi note headline; paragraf stok bebas ke drawer; kosong satu baris; kolom teks wrap; "(C54 …)" hilang | `lib/v5/komersial.ts` |
| R161 | Rencana: kebutuhan per kelas tiga baris; batch di atas kebutuhan nada `warn` (+ tetap); catatan panjang ke drawer; stepper `Status` | `lib/v5/ppic.ts` |
| R163 | Upload: riwayat waktu · jenis · file · baris · Status, SHA-256 dan kode di drawer "Detail teknis"; wizard memakai kelas v6. Harga: tabel v6, `NumberInput` per sel "Harga jual <SKU>", aturan koma dicetak sekali, submit ditahan bila ada sel tak terbaca, server menyebut sel. `InputTable`: setiap input punya nama kolom + baris, kolom angka `NumberInput`. `error.tsx` / `not-found.tsx` di frame v6 dengan "Muat ulang" / "Kembali". | `app/w/[week]/upload/*`, `app/w/[week]/input/harga/*`, `components/InputTable.tsx`, `app/error.tsx`, `app/not-found.tsx` |
| K88 | Di belakang `v6_pages`, `WeekShell` tidak lagi mencetak bar kontrol di atas halaman (rilis + kontrol ada di baris konteks shell) | `components/WeekShell.tsx` |

Untuk semua (tanpa flag, perbaikan aksesibilitas tanpa perubahan tampilan): `Msg` mengumumkan hasil (`role=status` / `alert`);
setiap input `InputTable` punya `aria-label`; galat harga menyebut SKU dan kolom.

## Angka

- M7 (lint, teks sumber): **78** kemunculan kode di string tampilan (ratchet; tidak boleh naik). Di layar v6 kode dihapus saat
  render (`plain`), diuji: teks Minggu ini v6 (fixture) **0** kode di luar drawer (`lib/v6/minggu-ini-v6.test.tsx`). Menghapus kode
  dari string sumber mengubah teks UI lama juga, jadi dilakukan di irisan 6 bersama penghapusan cabang v4/v5 lama.
- M4 (harness, fixture): angka pertama y = 68 pada 390 px; 1366 px y = 97.
- axe-core (harness Minggu ini v6, 1366/1280/390): 0 serius/kritis.

Screenshot: `docs/v6/bukti/irisan-5/shot-1366.png`, `shot-390.png` (fixture 2026-08-24, shell + pages v6).

## Belum dikerjakan / sengaja ditunda

- Halaman v1 (Neraca, Laba Rugi, Arus Kas, Stok, Kontrol, Rilis, Batch RPA, Parameter, Run-rate, Stok awal, Penjualan,
  Penerimaan) belum ditulis ulang ke `Table6`/`Tile` (K101). Di dalam shell v6 mereka memakai lapisan CSS v6 (`app/v6.css`
  "v1 pages inside the v6 shell": token kontras AA, border input 3:1, tanpa tooltip hover). Penulisan ulang markup dijadwalkan
  di irisan 6 bersama penghapusan `globals.css` (M6).
- Wizard upload v4 belum dibangun ulang dengan `UploadPanel` v5 (R163 baris pertama): jalurnya (stage/commit, `lib/upload.ts`)
  berbeda dari validasi v5; dibungkus grammar v6 dulu.
- T37–T40 (penerimaan manual dengan user sungguhan) dan T35 (journey keyboard) belum dijalankan.
