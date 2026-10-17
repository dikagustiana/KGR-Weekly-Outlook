# Irisan v5.1/4: flag per role (K53–K54), C57/C58 PPIC, upload 0.xxx dan O15, UI §5.1/§6.5/K20

Branch `v5.1/4-flags-ui` di atas `v5.1/3-costing-pl` (PR #35). PRD: `docs/PRD-v5.1.md` R28–R40. Tidak ada migrasi baru
(`parameter.po_unsized_mode` sudah ada di `20261024000300_v51_params.sql`; jalur soft-delete Admin di `…0200`, irisan 1).
Keputusan pelaksanaan: `docs/v5/QUESTIONS.md` Q-v5.1-23 … Q-v5.1-33.

## Isi

- **R28 (K53, K54):**
  - `k25On(settings, role)` / `k25Enabled(viewer)` menjadi satu sumber K25 untuk Outlook, Rencana v4, print, "Unduh PDF" dan PDF rilis.
  - `commercialMart(…, v5)` membaca kolom v5 hanya untuk role `v5_costing`; dipakai di Komersial v4/v5 dan Manajemen.
  - Status putaran: modul mati → "modul belum aktif".
- **R29 / R30 / R31:**
  - `copyBlockersOf`: aturan v4, C57 tanpa pengecualian, C58 dengan alasan. Aturan yang sama dipakai di layar dan di `copyClassPlanAction`; form alasan C58 di Rencana v5; `reasonAction` menolak C57.
  - Headline "dalam kelas STD (kelas berat belum diisi PPIC)"; label Manajemen tidak menghitung STD sebagai kelas.
  - Ukuran dikumpulkan per dua desimal.
- **R32 / R33 / R34:**
  - `upNum("0.715")` = 0,715.
  - O15 `po_unsized_mode` (default warn): karkas tanpa ukuran tersimpan `size_kg` null (STD). Golden `upload-samples` PO 4 → 5 lolos.
  - WP: batch tanpa kg LB/ekor, atau dengan kg LB berbeda antar baris, menahan semua baris batch itu.
- **R35 / R36 / R37:**
  - Item nav `input` punya id sendiri; Upload v4 tetap untuk role yang punya jenis upload v4. Panel Inventory Accounting menautkan wizard v4.
  - Status teks tanpa ikon, termasuk daftar cek upload.
  - Kartu kas: "tanpa pinjaman afiliasi" dari `closing_without_affiliate` terendah.
- **R38 / R39:**
  - NIBT setelah beban tetap di kartu Actual, Forecast, Outlook (`maxCompare` 4); akurasi menampilkan "NIBT jurnal" dan "NIBT + beban tetap".
  - Status biaya K20: per segmen (`statusMode`, "campur"), per SKU di tabel stok umur, dan di t-batch PPIC.
- **R40:**
  - Env fail-fast di production.
  - Grafik mengisi tinggi tile, minimal tileBox 76 px.
  - `since` v5 costing wajib (Admin → Modul "mulai"; tanpa itu tidak ada revaluasi, halaman Costing menyebutnya).
  - Cache `run` ledger direset di `lockVersionV4`.
  - Semua pembaca `price_list_week` menyaring `deleted_at is null`.

## Persyaratan → bukti

| R | Bukti (lingkungan, role) |
|---|---|
| R28 / K53 / K54 | `lib/v5/flags-matrix.test.tsx` (58 tes: 8 kombinasi × admin/sales/management untuk K25, mart Commercial, Status putaran). PostgREST: matriks 192 halaman, 0 error, 0 rekomendasi LB saat K25, 0 biaya v5 untuk Sales tanpa `v5_costing` (`journey-K-M-N-O.md`). K' mgmt@t "modul belum aktif" |
| R29 | `lib/v5/ppic-v51.test.tsx` (C57 tidak bisa dialasankan; C58 + alasan → terbuka; tile menyebut penahan). PostgREST M0/M2 ppic@t: tombol Salin nonaktif "C57 BELUM DIISI … tanpa pengecualian" |
| R30 | `ppic-v51.test.tsx` (headline STD) |
| R31 | engine `ppic-class.test.ts` (1,25 dan 1,30 dua ukuran, dua kelas); golden B.3 tetap |
| R32 | engine `upload-validate.test.ts` (0.715, 0.500, −0.25, 1.234, 12.345,6) |
| R33 / O15 | `upload-validate.test.ts` (warn 7 → 5, fail 7 → 4); `upload-samples.test.ts` + golden baru; PostgREST N sales@t: Karkas Mix `size_kg` null, PPIC "Tanpa ukuran" 811 → 1.211 |
| R34 | `upload-validate.test.ts` (batch kosong dan tidak konsisten → semua baris ditahan); PostgREST O costacc@t: "kg LB tidak konsisten (12.211,6 / 12.300,0)", 0 baris lolos |
| R35 | `lib/v4/nav.test.ts` (id `input` dan `upload` berdampingan; Finance tetap 7 item, Q-v5.1-25) |
| R36 | `lib/v5/input-screens.test.tsx` (tanpa ✓ ✕ !); PostgREST N/O: cek upload "ditahan:" / "catatan:" |
| R37 | `lib/v4/ui-v51.test.tsx` (mart: −260,0 jt terendah; kolom kosong → "belum ada"); PostgREST K: kartu "tanpa pinjaman afiliasi −910,3 jt" |
| R38 | `ui-v51.test.tsx` (92,3 / −100,1 / −7,8 = B.2; akurasi "NIBT jurnal 79,2 −5,0 84,2" dan "NIBT + beban tetap −7,8 −5,0 2,8"; tanpa estimasi → "belum ada") |
| R39 | `ui-v51.test.tsx` (segmen "campur" / "final", SKU dengan status); PostgREST M1' costacc@t: Costing batch 129 sumber "keputusan" |
| R40 | `ui-v51.test.tsx` (`chart-fit`, `sinceOf`); `next start` lokal dengan env (journey); `price_list_week` 4 pembaca dengan `deleted_at` |
| T11 | di atas |
| T12 | parity 17161/17161, snapshot:diff EMPTY, golden v1 dan B.1–B.5 di tes engine (golden yang berubah hanya `upload-samples` PO, O15) |

## Bukti gate

`docs/v5.1/bukti/irisan-4-gates.txt`: test (engine, parsers, web), typecheck, parity, snapshot:diff, test:rls, lint
K38/K41/K42.

## Perlu tindakan manusia sebelum / sesudah merge

- Vercel Production: `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` harus terisi (R40 fail-fast).
- Admin → Modul → `v5_costing` → isi "mulai" (tanggal pertama v5 costing berjalan). Tanpa itu revaluasi lot K22 berhenti.
- Navigasi Finance 8 item vs batas 7 (Q-v5.1-25).
