# Ringkasan e2e

Lingkungan: **PG16 lokal + PostgREST 12 + mock auth** (bukan Supabase). Dijalankan 2026-10-18T10:56:12.764Z (jam dinding mesin).

| Journey | Cek lulus | Gagal | XFAIL | XPASS | Respons app | Tak terduga | SETUP | Detik |
|---|---|---|---|---|---|---|---|---|
| prepare | 3 | 0 | 0 | 0 | 5 | 0 | 1 | 13 |
| matrix | 120 | 0 | 0 | 0 | 831 | 0 | 16 | 97 |
| O | 15 | 0 | 0 | 0 | 10 | 0 | 1 | 12 |
| T7 | 58 | 0 | 0 | 0 | 83 | 0 | 5 | 124 |
| A6 | 82 | 0 | 0 | 0 | 45 | 0 | 2 | 48 |
| L | 34 | 0 | 0 | 0 | 22 | 0 | 0 | 25 |
| P | 16 | 0 | 0 | 0 | 6 | 0 | 3 | 5 |
| R69 | 65 | 0 | 0 | 0 | 65 | 0 | 5 | 43 |
| F19 | 16 | 0 | 0 | 0 | 5 | 0 | 3 | 16 |
| volume | 13 | 0 | 0 | 0 | 7 | 0 | 1 | 13 |

## Diharapkan gagal (XFAIL)

Tidak ada.
