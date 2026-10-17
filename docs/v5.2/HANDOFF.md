# v5.2-A (kode) — status pengerjaan

Dokumen handoff untuk review Opus. Semua cabang ter-push bersih; gate hijau di tiap commit.

## Selesai per irisan

| Irisan | Progress | Cabang | PR |
|---|---|---|---|
| A0 (docs) | 100% | `v5.2/a0-docs` | #37 |
| A1 (fail-closed) | 100% — R41–R47 (gagal-tertutup, builder+cron, K42, lint K41/K42=0) | `v5.2/a1-fail-closed` | #38 |
| A2 (loop) | 10/11 — R48, R49 (kg berbobot + forecast), R50, R51, R52, R53, R54, R56, R57 | `v5.2/a2-loop` | — |
| A3 (costing-pl) | 9/9 — R59, R60, R61, R62, R63, R64(lint=0), R65, R66(utuh), R67(utuh) | `v5.2/a3-costing-pl` | — |
| A4 (fs-recon) | 1/2 — R68 `fsRecon` + C59 (pure engine) | `v5.2/a4-fs-recon` | — |
| A5 (e2e) | 0 — butuh Docker + PostgreSQL 16 | — | — |
| A6 (UI) | 100% — R75, R76, R77, R78, R79 | `v5.2/a6-ui` | — |
| Backtest L1 | + BT-1 (bug parser `Nilai Debit/Kredit` diperbaiki) | `v5.2/bt-sep` | — |

## Sisa & penghalang

- **Kode (butuh konteks segar):**
  - R64 sweep `?? "0"` → null — **SELESAI**: `scripts/lint-missing.sh` = 0 (whitelist bernama + `accuracyV4` null + `affiliate` "belum ada").
  - R67 web-adapter — **SELESAI**: `forecastPlanCost` (engine) + `forecastCostsOf` (loader) + override hpp di `month.ts`.
  - A2 R58-web — filter `existing` sales by `base_key` (butuh skema key-assignment).
- **Opus (DB/migrasi/RPC):** R55 (lock-commitments atomik, partial index), R69 (B-R86), `batch.weight_class` (R63).
- **PostgreSQL/Docker:** A5 (e2e), backtest Langkah 2–4.

## Gate (setiap commit)

parity 17161/17161 · snapshot byte-identik · engine 367|1 todo · web 265 · typecheck ✓ · lint K41/K42 = 0 (di A1).
