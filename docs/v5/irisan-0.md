# Irisan v5/0: foundation

Branch `v5/0-foundation` dari `main` (`ebe4ad8`). Rancangan: `docs/v5/irisan-0-design.md`.

## Isi

- `docs/PRD-v5.md`, `reference/design/v5/` (mockup apa adanya), baris "digantikan" di `docs/PRD-v4.md`.
- Migrasi `20261021000100_v5_foundation.sql`: kolom §5.1, tabel §5.2 (kosong), seed kelas K/S/B tanpa angka, role `operations_director`, RLS Bab 8, seed `input_task_rule` (13 aturan dari §3.1), flag `v5_*` mati.
- App: role dan label "Direktur Operasional", area `lb_decision`, `commitment`, `commitment_lock`, `price_list_lock`, `surplus_response`, `size_class_map`; Direktur Operasional membaca seperti management (view manajemen, nav manajemen, halaman baca); flag v5 di Admin → Modul.
- Rencana v4 melewati kelas tanpa rata-rata (K/S/B belum diisi).

## Bukti

Gate (`docs/v5/bukti/irisan-0-gates.txt`):
```
apps/web typecheck: Done
== test
packages/engine test:  Test Files  19 passed (19)
packages/engine test:       Tests  275 passed | 1 todo (276)
packages/parsers test:  Test Files  3 passed (3)
packages/parsers test:       Tests  23 passed (23)
apps/web test:  Test Files  11 passed (11)
apps/web test:       Tests  65 passed (65)
== parity
parity: 17161/17161 cells match → docs/parity.md, docs/parity-cells.csv
docs/parity.md, docs/parity-cells.csv: tidak berubah
== snapshot
diff vs baseline (without block2.action, block7[].audience, controls_v3 (v3), costing (v3), ledger (v3), demand (v3), plan (v3), allocation (v3), monthly (v3), drivers (v3), cash (v3), ccc (v3), solvency (v3), commercial (v3)): EMPTY — byte-identical
== build
 ✓ Compiled successfully in 24.2s
```

RLS: `docs/v5/bukti/irisan-0-test-rls.txt`, 20 blok, tidak ada hasil (!). Blok baru "v5/0":
```
RLS-RESULTS v5/0 (rolled back): opsdir decides LB price: OK;
  decider stamped=t30-od@x.test;
  edit decision rows=0;
  opsdir reads cash=1;
  opsdir writes commitment: denied;
  t30-sales decides LB price: denied;
  t30-mgmt decides LB price: denied;
  t30-ppic decides LB price: denied;
  sales reads LB decisions=0;
  sales drafts assigned key: OK;
  sales drafts unassigned key: rejected;
  sales inserts locked: rejected;
  sales locks: rejected;
  lead locks: OK;
  change locked commitment: rejected;
  lead drafts any key: OK;
  locked_by=t30-lead@x.test;
  new version without reason: rejected;
  new version with reason: OK;
  sales sees unassigned commitments=0;
  lead locks version 2: OK;
  versions=1:superseded,2:locked;
  lead writes price list: OK;
  lead locks price list: OK;
  change locked price list: rejected;
  sales writes price list: denied;
  sales answers surplus: OK;
  sales answers unassigned key: rejected;
  sales maps size: denied;
  sales reads lot_revaluation=0;
  ppic maps size: OK;
  ppic writes demand_class_weekly: denied;
  ppic writes plan_week_class: OK;
  finance reads lot_revaluation=1;
  finance writes completeness: denied;
  finance ticks a task: denied;
  K/S/B seeded empty=3;
  task rules=13;
  v5 flags off=6;
  parameter defaults on existing weeks=yes;
  basis fixed_estimate: OK;
  v5 columns=11;
```

Migrasi v4 + v5 diterapkan dua kali pada salinan latihan KGR-OS (`kgr_os_rehearsal` → `kgr_os_v5`):
```
round 1 done
round 2 done
```

## Perintah untuk manusia (KGR-OS)

Setelah irisan ini diterima, di SQL Editor atau psql (`PGCLIENTENCODING=UTF8`), sesudah migrasi v4:
```
supabase/migrations/20261021000100_v5_foundation.sql
```
Cek: `select key, value from public.app_setting where key like 'v5_%';` → enam baris `{"enabled": false}`; `select count(*) from public.input_task_rule;` → 13.

User role baru (Direktur Operasional) dibuat Admin di app (Admin → Pengguna) setelah migrasi; tidak dibuat di sini.

## Snapshot dan parity

Tidak berubah (lihat gate). Kolom baru nullable atau berdefault dan tidak dibaca `computeWeek`.
