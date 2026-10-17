# Journey L (irisan 3) — Commercial ↔ PPIC dengan role sebenarnya

PRD v5.1 Bab 5.5 (irisan 3), R14–R16, R20–R22, T7 (bagian Commercial ↔ PPIC). Dijalankan 17 Okt 2026 04:15 UTC pada
branch `v5.1/3-costing-pl`. Log lengkap: `docs/v5.1/bukti/journey-L.log`. Tangkapan layar:
`docs/v5.1/bukti/journey-L-*.png`. Cek K55: `docs/v5.1/bukti/irisan-3-k55.txt`.

## Lingkungan (bukan KGR-OS, bukan Supabase)

| Bagian | Isi |
|---|---|
| Database | PostgreSQL 16.15 lokal, DB `kgr_os_prod` = salinan lokal fixture minggu 24–30 Agu 2026, semua migrasi v1–v5 + bundel `docs/v5.1/kgr-os-migrasi-v51.sql` |
| API | PostgREST v12.2.3 (Docker), JWT HS256 lokal |
| Auth / storage | mock lokal (password apa saja → JWT untuk email itu) |
| App | `next build` + `next start` dari working tree irisan ini |
| Jam uji | `faketime` pada PostgreSQL dan `next start`: Kamis 27 Agu 2026 10.00 WIB (berjalan); tenggat komitmen Jum 28/08 17.00 |
| Role | `sales@t` (sales, assignment `RPA|Karkas|Fresh` / PT A), `lead@t` (commercial_lead), `ppic@t` (ppic), `finance@t` (finance); user uji dari `docs/v5.1/journey-P.md`. Admin tidak dipakai di langkah journey |
| Flag | semua `m*`, `v4_*`, `v5_*` hidup kecuali `v4_release`; hanya di DB lokal |

SETUP (postgres, DB lokal, bukan langkah role): komitmen dan price list minggu 31 Agu serta jawaban surplus `lead@t`
dari putaran sebelumnya dihapus; antrean rebuild kosong. Rencana PPIC minggu 24 Agu (dibuat `ppic@t` di journey P) ada.

## Langkah dan hasil

| # | Role | Request (status HTTP) | Yang terlihat / DB | Hasil |
|---|---|---|---|---|
| L1 | sales@t | GET `/komersial` (200); POST "Simpan draft" (200) | hanya baris `RPA|Karkas`; fresh/frozen/harga aktif, harga frozen nonaktif; "1 SKU komitmen disimpan sebagai draft"; DB `RPA|Karkas v1 draft 15000/2000 @36705 oleh sales@t`; tanpa tombol kunci ("Dikunci Kepala Sales."); tile Dari PPIC: "Tidak ditampilkan untuk Sales (data perencanaan)." | draft Sales (sesuai), R16 |
| L2 | sales@t | PostgREST `POST /rpc/lock_commitments` dengan token sales@t (403) | `42501 Komitmen dikunci oleh Kepala Sales`; draft tetap | DB menolak Sales |
| L3 | lead@t | GET `/komersial` (200); isi harga frozen Karkas 28.000; POST "Kunci komitmen dan price list" (200) | "1 draft komitmen dikunci bersama price list minggu depan; harga frozen dari form untuk 1 SKU"; DB `v1 locked … kunci lead@t`; `price_list_week RPA|Karkas fresh 36705 frozen 28000 (form) terkunci`; antrean `sales_commitment insert → 31/08`; tile: kolom Harga frozen 28.000 | satu RPC, harga frozen dari form (K46) |
| L4 | lead@t | POST "Simpan draft" tanpa alasan (200); dengan alasan (200); POST kunci (200) | tanpa alasan: "RPA|Karkas: Komitmen sudah dikunci: versi baru wajib alasan", DB tidak berubah; dengan alasan "PO tambahan PT A": `v2 draft 16000`; kunci: `v1 superseded`, `v2 locked`; price list terkunci tidak ditimpa (Q-v5.1-8) | versi 2 dengan alasan |
| L5 | sales@t | GET `/komersial` (200) | Karkas terkunci v2: fresh, frozen, harga, harga frozen semua nonaktif | R15 satu aturan |
| L6 | lead@t, ppic@t | GET `/komersial` (200); POST "Kirim jawaban ke PPIC" (200); ppic@t GET `/w/2026-08-24/rencana` (200) | surplus karkas ± 2.104 kg (turun −10,6 jt); jawaban "sebagian 3.000 kg @ 31.000"; DB `surplus_response partial … oleh lead@t`, antrean `surplus_response insert → 24/08`; Rencana ppic@t: "Jawaban surplus dijawab", komitmen dan price list minggu depan dikunci | surplus → jawaban |
| L7 | finance@t | GET `/m/2026-08` (200); GET `/kas` (200) | DB: 31 hari Agustus `accounts = 0`, `total_closing = 0`; Outlook bulan: "Kas belum diisi" (tanpa filter R21 yang terbaca baris `total_closing` 0,00); bulan ke ekuitas negatif "tidak berlaku (laba)" (basis NIBT setelah beban tetap 55,9 jt, `v5_pl` hidup) | R21, R20 |

Log app: 0 respons 4xx/5xx dari `next start` (L2 403 adalah PostgREST langsung, disengaja).

## K55 (R22) di database yang sama

Langkah pemeliharaan (Admin → Modul → Bangun ulang 26/08, bukan journey role), `docs/v5.1/bukti/irisan-3-k55.txt`:

| Keadaan | commercial_daily 26/08: cost_per_kg / cost_status / cost_check terisi | sku_balance_daily: cost_status terisi / baris | lot: cost_status terisi / baris |
|---|---|---|---|
| `v5_costing` hidup | 34 / 34 / 34 dari 34 | 34 / 34 | 29 / 29 |
| dimatikan, bangun ulang | 0 / 0 / 0 dari 34 | 0 / 34 | 0 / 29 |
| dihidupkan lagi, bangun ulang | 34 / 34 / 34 dari 34 | 34 / 34 | 29 / 29 |

Sebelum K55, payload tanpa kolom v5 meninggalkan nilai lama (baris pertama menentukan daftar kolom `mart_replace`).

## Batasan

- Hanya langkah Commercial ↔ PPIC (irisan 3). Putaran penuh dengan 6 user (T7: keputusan harga LB, WP H+1, status
  putaran) dijalankan di irisan 4 bersama flag per role.
- `commitmentDemand` versi tertinggi per key diuji di unit test engine: indeks unik `sales_commitment_locked` mencegah
  dua versi `locked` per key di DB, jadi kasus "data lama" tidak bisa dibuat lewat layar.
- R20 "belum ada" (tanpa nominal beban tetap) diuji di unit test (`lib/v4/solvency-v51.test.tsx`); DB lokal punya jadwal
  depresiasi Agustus sehingga basisnya angka.
