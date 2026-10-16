# Irisan v5/0 — rancangan

Isi menurut PRD v5 Bab 10: model data §5 (kolom dan tabel kosong), role `operations_director` dan area §5.3, RLS Bab 8 untuk tabel baru, seed `input_task_rule` dari §3.1, flag v5 (semua mati).

## Migrasi `20261021000100_v5_foundation.sql`

Hanya menambah. Satu-satunya `drop` adalah `drop constraint if exists` yang langsung diikuti check yang lebih lebar (pola v3/v4), dan `drop not null` pada `weight_class.avg_kg`, supaya K/S/B bisa di-seed tanpa nilai (PRD §5.1: "null + deskripsi").

| Tabel | Perubahan |
|---|---|
| `app_user` | role `operations_director` di check |
| `item_map` | `size_kg numeric(4,2)` (diisi parser "Uk x.x" di irisan 3) |
| `sales_line` | `size_kg numeric(4,2)`, `commitment_id uuid` → `sales_commitment` |
| `weight_class` | `avg_kg` boleh null; seed K, S, B tanpa angka, dengan deskripsi; `sort_order` 2–4 supaya STD tetap kelas bawaan v4 |
| `lot`, `sku_balance_daily` | `cost_status` ∈ rencana / estimasi / sementara / final |
| `batch` | `wp_due_at`, `wp_received_at`, `invoice_status` ∈ pending / received / tied |
| `pl_daily_v4` | `basis` + `fixed_estimate` |
| `upload` | `checks jsonb`, `ok_count`, `preview_fingerprint` |
| `parameter` | `commitment_lock_dow` 5, `commitment_lock_time` 17:00, `wp_due_hours` 24, `wp_due_time` 12:00, `revaluation_sold_mode` cogs_line, `cost_anomaly_ratio` 3, `yield_karkas_min` 0,68, `yield_karkas_max` 0,76 |
| baru | `size_class_map`, `lb_price_decision`, `sales_commitment`, `price_list_week`, `plan_week_class`, `surplus_response`, `lot_revaluation` (mart), `demand_class_weekly` (mart), `input_task_rule`, `input_task` (mart), `input_completeness_daily` (mart), flag `v5_*` |

Tidak ditambah karena kolomnya sudah ada: `lb_supply.price` (`price_per_kg` sudah ada sejak m3) dan `parameter.shrink_target` (`target_shrink` sudah ada sejak v1). Lihat Q-v5-1.

## Akses (Bab 8)

- `operations_director`: baca semua yang dibaca management (tabel kas m6 diberi policy baca tambahan); tulis `lb_price_decision` saja. Di app diperlakukan seperti management (view manajemen, tanpa toggle).
- `sales_commitment`: Sales hanya key penugasannya (S2), status `draft`; kunci (draft → locked) hanya Kepala Sales atau Admin; baris terkunci tidak berubah; versi baru setelah kunci wajib alasan dan menggeser versi lama ke `superseded`.
- `price_list_week`: Kepala Sales / Admin; setelah `locked_at` terisi tidak bisa diubah.
- `surplus_response`: Sales (key penugasan), Kepala Sales, Admin.
- `size_class_map`: PPIC / Admin. `input_task_rule`: Admin.
- Mart (`lot_revaluation`, `demand_class_weekly`, `input_task`, `input_completeness_daily`): tanpa tulis klien; ditulis `mart_replace` (service role). `lot_revaluation` tidak terbaca Sales (biaya).
- Area baru di `roles.ts`: `lb_decision`, `commitment`, `commitment_lock`, `price_list_lock`, `surplus_response`, `size_class_map`.

## Engine, layar, kontrol

Tidak ada fungsi engine baru dan tidak ada layar baru di irisan ini. Flag `v5_costing`, `v5_pl`, `v5_ppic_class`, `v5_commercial`, `v5_input`, `v5_management` masuk `app_setting` dan `MODULE_KEYS` dengan nilai mati.

## Fixture dan tes

Blok RLS "v5/0" di `supabase/tests/rls_roles.sql`: role baru, keputusan harga LB, komitmen dan kuncinya, price list terkunci, jawaban surplus, mart tanpa tulis klien, seed K/S/B null, seed tugas, default parameter, basis `fixed_estimate`.

## Snapshot v1

Tidak ada yang dibaca `computeWeek` yang berubah: kolom baru nullable atau berdefault, dan K/S/B tidak dipakai rencana v4 selama `avg_kg` null (loader melewati kelas tanpa rata-rata). Gate: `pnpm snapshot:diff` EMPTY, parity 17.161/17.161.
