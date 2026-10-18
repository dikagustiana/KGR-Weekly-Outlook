# Changelog

All notable changes to KGR Weekly Outlook. Format: Keep a Changelog; milestones from PRD §11.

## [v5.2-a3] Biaya final hanya dari alokasi, beban tetap per bulan, missing ≠ 0 (docs/PRD-v5.2-A-kode.md irisan A3, R59–R67; docs/v5.2/a3.md)

### Added
- Lint `missing` (`scripts/lint.py missing`, replaces `scripts/lint-missing.sh`): no `?? 0` / `?? "0"` / `|| 0` / `|| "0"` in `apps/web/lib` and `apps/web/app`, no whitelist, a line opts out only with `// missing-ok: <reason>`; fixtures `scripts/lint-fixtures/missing/{bad,good}`, cases in `scripts/test-lint.sh`, a step in the CI job `lint`.
- Costing rows mode (R66, K63): `app_setting` `v5_pl.costing_rows_mode` (`'cogs'` default, `'memo'`): in `memo` "Selisih costing" and "Biaya kapasitas idle" are neither COGS nor opex, the journal columns hold journal lines only and a memo block (with NIBT manajemen) sits below the journal NIBT. Admin → Modul has an input for it and keeps the fields it does not manage.
- Forecast cost (R67): `forecastPlanCost`, `blendClassCosts` (engine), `forecastCostsOf` / `applyForecastCosts` (web): the forecast order lines are costed at the plan cost of their date (the decided LB price), MA with a label as the fallback. Golden `fixtures/pl-v5-lbprice` (LB +Rp 1.000/kg → forecast GP −3.474.990,60).
- 12-month cash on NIBT after fixed costs plus the non-cash costs inside it, with the reconciliation on the tile (R65).
- Tests: engine `pl-v5-memo`, `pl-v5-lbprice`, `pl-v5-noncash`; web `costing-k59`, `ledger-k59`, `ledger-r64`, `pl-memo`, `forecast-cost`, `cash-r65`, `admin-setflag`, `r64-missing`.

### Changed
- A batch cost is final only when its allocation is posted AND every line is priced (K59); a tied invoice alone is `sementara` and the upload names the next step. A price of 0 is no price. Posting is refused naming batch and SKUs; the override is Admin only until B-R85 (Finance: RPC `post_allocation_override`).
- A missing yield, tariff or maklon is "belum diisi" (C54 PERIKSA, C42 BELUM DIISI), never a cost of Rp 0; the LB decision and yield are those of the batch's class (STD fallback labelled).
- Fixed costs: a schedule that ended falls back to the last FINAL, a line that has not started is absent (R59).
- Missing is not 0 across the pages and builders of the PRD list (R64): totals over rows are unknown when one row is blank, accuracy/over-age/last-week/cash plan columns are null with a text, commitments name both kg, run-rate lines without a monthly amount are not written.
- `scorecard.rp_downgrade` and `priceFloor` return null when their input is missing; `calibrationV4` skips the GP bias of a V1 without GP.
- `docs/open-questions.md` M2: the 88,2% (30/34) exception is written and the `todo` test is a regression test (O13).

## [v5.2-a2] Putaran Commercial → PPIC → batch tanpa jalan buntu (docs/PRD-v5.2-A-kode.md irisan A2, R48–R58; docs/v5.2/a2.md)

### Added
- One copy gate (K58): `copyGate` / `copyPlanToBatches` in `lib/v5/copy-plan.ts` — C42/C45/C46/C47, C57 per cut date × class, C58 (only when `v5_ppic_class` is on for the caller, or with a written reason of this plan version), the downgrade approval; both copy actions and both Rencana pages go through it.
- Batches are written from the saved `plan_week_class` of the plan version (kg LB and heads per class, class yield with the STD fallback labelled); engine `splitClassPlan`.
- Tile `t-approval` and `rencanaV5Extras`: Finance / admin approve a plan with a downgrade above the limit on the v5 screen.
- `refreshTasks`: commitments saved or locked, a surplus answered and a WP uploaded queue the due dates of their tasks (`dueDatesFor`) and the queue is processed inline.
- Engine: `weightedOpenKg`, `forecastLinesByDate`, `effectiveForecasts` (K2), `lbDecisionFor`, `c57` per class, `assignmentCovers` / `inAssignmentScope` (O21(b)), `UploadContext.assignments`, `UploadBatch.output`.
- Tests: engine `a2-loop`; web `ppic-loop`, `copy-gate`, `rencana-extras`, `commercial-actions`, `upload-loop`, `lb-decision`; in-memory Supabase client `test-support/mem-sb.ts`; PostgREST 12.2.3 evidence for R55 (`docs/v5.2/bukti/a2-r55-postgrest.*`).

### Changed
- Class demand = open kg (kg − fulfilled − cancelled, never below 0) × status weight, forecasts as STD lines per date, stock netting after the weighting (R49); a Tentative 100 kg line is 70 kg, a Confirmed 100 kg with 60 kg delivered is 40 kg. Golden B.3 unchanged.
- C58 judges STD as a class of its own and says "n kg tanpa kelas" (kg, not rows) (R50).
- Commitments are saved as one request (`upsert … onConflict: "id"`), only the rows that changed; a locked row left alone makes no new version (R55).
- The surplus answer carries the SKU of the surplus row and is checked against the plan's surplus list (R56).
- A Sales PO upload replaces or retires only lines inside one assignment row — customer and key together (R58, O21(b)).
- Steps after a saved upload (update date, queue) no longer leave the upload `staged` when they fail.
- **Golden `fixtures/upload-samples/expected.json` (costing_wp, `wp_sample.xlsx`, batch B260826) changed — C22 is judged on the output that will be saved** (PRD A R58: "C22 dihitung atas output yang akan disimpan (baris lolos + output lama yang dipertahankan)"), per row:
  - X-HATI 401,2 kg and KPL-01 338,0 kg are rows held for an unknown code (level `fail`, unchanged); they were counted in Σ SKU, they are not any more. The other six rows (612,4 · 2.081,0 · 1.108,7 · 1.710,0 · 213,9 · 317,6) count as before.
  - C22 detail: `6.782,8 vs 7.286,6 kg (LB − susut 3%), selisih 6,9% (batas 2%)` → `6.043,6 vs 7.286,6 kg (LB − susut 3%), selisih 17,1% (batas 2%)`
  - fingerprint `v1:1608d6f7fec05514143f37752ffc` → `v1:109f236b1e87d90966ef14a2667f`
  - unchanged: `total` 8, `ok_count` 6, `ok_lines`, all `rows`, `needsReason` `["B260826"]`, the other checks (yield karkas 73,4%), `summary`; po_lines and yield_matrix unchanged.

### Fixed
- A locked commitment above the PO crashed the Rencana v5 page and the class demand builder (a synthetic id went into a UUID query).
- "Salin ke batch rencana" of the v4 screen skipped C57/C58 and the downgrade approval; the batches were cut from the STD plan days, not the saved class plan.
- A downgrade approval could not be given on the v5 screen (the form sat on a tile that did not exist).
- Lock, surplus answer and WP did not refresh their grid cell; the commitment form wrote a new version for every locked SKU, one request at a time.
- Karkas `Frozen` was counted as live-bird need (the form was compared in lower case).
- C22 counted rows that were rejected (70 + 27 = 97 passed while 70 was saved).

## [v5.1-4] Flag per role, C57/C58 PPIC, upload 0.xxx dan O15, UI §5.1/§6.5/K20 (docs/PRD-v5.1.md irisan 4)

### Added
- `k25On` / `k25Enabled` (K54); "modul belum aktif" in the loop status; C58 reason form on Rencana v5; "mulai" (since) of `v5_costing` in Admin → Modul; `lib/v5/cost-status.ts`; tests `flags-matrix`, `ppic-v51`, `ui-v51`; journeys K, M, N, O and the flag matrix on PostgREST (`docs/v5.1/journey-K-M-N-O.md`).

### Changed
- O15 (`parameter.po_unsized_mode`, default `warn`): a karkas PO line without size is saved with `size_kg` null (STD) instead of held. **Golden `fixtures/upload-samples/expected.json` (po_lines) changed**, per line:
  - `ok_count`: 4 → 5; `ok_lines`: [3, 4, 5, 6] → [2, 3, 4, 5, 6]
  - check C50 "Ukuran karkas RPA terisi": level `fail` → `warn`; result "1 baris" → "1 baris → STD" (detail "4 dari 5 baris karkas" unchanged)
  - row KGR26.00341 (Ayam Karkas Mix): level `fail` → `warn`; action "ukuran karkas kosong: isi kolom ukuran (Uk 0.8–1.5)" → "ukuran karkas kosong: isi kolom ukuran atau biarkan STD"
  - summary "4 dari 7 baris bisa disimpan (6.783,6 kg dari 7.764,9 kg)…" → "5 dari 7 baris bisa disimpan (7.594,9 kg dari 7.764,9 kg)…"
  - fingerprint `v1:1228f59d23ef0f1d01b19519db11` → `v1:1711b979cb3b661b9269a7d0d5ef`
  - costing_wp and yield_matrix unchanged. Mode `fail` keeps the v5 result (tested).
- Input status in words (no icons, no colour sentences), also in the upload check list; nav item Input has its own id (Upload v4 stays next to it).
- Outlook bulan: NIBT after fixed costs on the Actual, Forecast and Outlook cards; accuracy rows "NIBT jurnal" / "NIBT + beban tetap" (flag `v5_pl`).
- Production without `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` stops with a message (no silent pilot project).
- The lot revaluation (K22) starts at `v5_costing.value.since` only; no fallback to the date the flag changed.

### Fixed
- K25 (simulation, no recommendation) followed `v5_costing` only and ignored the role on the Outlook page; Komersial and Manajemen read the v5 cost columns for every role once the flag was on globally.
- "Salin ke batch rencana" ignored C57; C58 had no reason form on the v5 page.
- "0.715" was read as 715; karkas sizes 1,25 and 1,30 were merged into one "Uk 1.3"; a WP batch with different kg LB per row was saved.
- PPIC headline counted STD as a weight class; the cash card lost the line without affiliate loans when the cash mart was used; the Minggu ini segment and stock tables and the PPIC batch tile wrote a fixed cost status.
- A month lock could read the ledger run kept from an earlier rebuild; archived price list rows were read.

## [v5.1-3] Missing ≠ 0 di costing dan P&L, kunci komitmen satu transaksi (docs/PRD-v5.1.md irisan 3)

### Added
- Engine: `allocateBatch` option `nullMissing` and `canBeFinal` (K50); fixed-cost nominal per line with `null` for "belum ada", `fixedAllMissing`, `solvencyNibtV5` (K51, K52); `commitmentDemand` counts the highest locked version per key.
- "Harga frozen" column in the commitment form (sent with the lock) and the commitment table; `components/v5/CommitmentForm.tsx`.
- Tests: missing price / nominal / balance per screen, K55 payload, PI to an actual batch, commitment lock action; journey L (`docs/v5.1/journey-L.md`).

### Fixed
- A SKU or batch without a reference / LB price got a cost of 0 (and a batch could turn final); now no cost, C54/C57 name it, the lots stay `sementara`.
- A month without fixed-cost schedule or FINAL month read fixed costs 0; the solvency used NIBT before fixed costs. Now "belum ada" and NIBT after fixed costs (`v5_pl`).
- Outlook bulan showed cash Rp 0 for days without bank balance.
- Turning `v5_costing` off left the old v5 cost values in the marts; the PI upload could attach a cost to a planned (Rencana) batch.
- The lock of next week's commitments wrote row by row (a failure left half a lock) and did not set the frozen price; now one RPC. Commitment inputs followed different disabled rules; Sales saw "Belum ada rencana PPIC" instead of why the tile is empty.

## [v5.1-2] Satu jam data, error tidak ditelan, batas baris (docs/PRD-v5.1.md irisan 2)

### Added
- `lib/clock.ts` (`clock()`: data date, wall date, now; KGR_TEST_NOW under NODE_ENV=test), `lib/loader.ts` (`must`, `LoaderError`, `TileData`, `tileData`, `inChunks`), `lib/v4/tile-errors.ts`, `lib/update-date.ts` (`advance_update_date` after journal, stock card and WP uploads), `queueThrough` (dates through the data date, 62 days).
- Tile state error in `TilePage` (`TileModel.error`).

### Fixed
- Manajemen decided the LB price for the day after the data date (August, opened in October); now tomorrow on the wall clock, and the simulation names both dates.
- Loaders turned PostgREST errors into empty data ("belum diisi", fallback prices, "belum dikunci"); now the tile shows the error, builders and actions fail visibly.
- Rows beyond `.limit(2000/5000)` were cut; long `.in()` id lists could exceed the URL length.
- An upload queued only its own dates and today; days between it and the data date kept old marts.

## [v5.1-1] Rilis K35/C53, akses, base_key, K32 di RLS (docs/PRD-v5.1.md irisan 1)

### Added
- Migrations `20261024000100_v51_release.sql` (`base_key`, `release_week` with K44/K45/K47, `needs_rebuild` on five v5 tables), `20261024000200_v51_security.sql` (base-key guards, view and Sales read policies, `tg_sales_line_scope`, `sales_sees_cost` in the v5 Sales view, `price_list_week.deleted_at`, lower-case assignment e-mail), `20261024000300_v51_params.sql` (`advance_update_date`, `lock_commitments`, `price_list_week.price_frozen_source`, `parameter.po_unsized_mode`); KGR-OS bundle `docs/v5.1/kgr-os-migrasi-v51.sql`.
- RLS block v5.1/1; screen test of the Minggu ini role guard; PO upload scope test.

### Fixed
- The release task no longer counts as a red cell of its own release (K44); a week without completeness grid is not released (K45); C53 holds the release like a v1 control and is overridden by Finance on the Kontrol page (K47).
- C53 compared ISO times as strings (`…Z` vs `…+07:00`); now as instants (R4).
- Minggu ini opened for every role with `v4_design`; now admin, management, operations director and finance only (K48).
- A partial PO file soft-deleted other customers' lines under the same PO number (R7); Sales could write PO lines outside their assignment through the API (K49).

## [v5-6.1] Perbaikan setelah uji pada salinan KGR-OS

### Fixed
- `loadPlanning` read `sku_key.replacement_buy_price` (the column is on `sku_price`): PostgREST refused the query, so the PPIC v5 loader, the LB simulation and the demand rebuild failed on a real database. The Finance Input screen counted `assumption_register` by a `month` column that does not exist.
- Month P&L mart: the plan writes a row per PO line; `plRowsByKey` sums them per (date, segment, pl_line, basis) before `mart_replace` (it failed with "ON CONFLICT DO UPDATE command cannot affect row a second time" whenever two PO lines shared a day).
- Pages and the month rebuild read as of the date the data stands on (`dataToday`, Q-v5-54) instead of the clock.
- Cash without bank balances is "belum diisi", not Rp 0 (Q-v5-55). Tiles with an unbuilt mart keep their place (Q-v5-56); grid rows grow with content; no inner scrollbars; v1 `.headline`/`.card` styles no longer leak into the v4 grid.

### Added
- `scripts/check-query-columns.py`, run by `test:rls` against the migrated schema: every table, column and rpc the web app asks PostgREST for must exist.
- `docs/v5/kgr-os-migrasi-v4-v5-sekaligus.sql`: the ten v4 + v5 migrations in one SQL Editor run.

## [v5-6] Manajemen (docs/PRD-v5.md irisan 6)

### Added
- Engine `batchBasisInputs` (batch basis of the LB simulation; the fixture script uses it, fixture unchanged).
- Golden fixture `pl-2026-08` (PRD §9.2, Lampiran B.2): both P&L views and the five cumulative series.
- Web (flag `v5_management`): Minggu ini gets the live-bird simulation for the operations director (two bases, price buttons, COGS/GP/breakeven/margin, COGS per kg per SKU, K25 wording) with the decision form (journey M), "Perlu keputusan minggu ini" with owners and "Status putaran"; K36 source labels on the main numbers of Manajemen, Commercial and PPIC; K37 "Lihat sebagai" in the header per role; the PPIC screen readable by management and the operations director.

## [v5-5] Input (docs/PRD-v5.md irisan 5)

### Added
- Engine `upload-validate.ts` (shared by browser and server, also `@kgr/engine/upload`): header/number/date parsing, TSV and CSV, templates, `validateUpload` for `po_lines`, `costing_wp`, `yield_matrix`, `lb_supply`, `fixed_cost`, `supplier_invoice`, fingerprint; `input-tasks.ts`: due rules, instances, status from the data, completeness cells, K35.
- Migration `20261023000100_v5_input.sql`: `input_completeness_daily.due_at`, `input_reminder`, override code `K35` (Finance) and policy `C53`, task rule `po_lines`, `release_week` with K35 while `v5_input` is on.
- Web (flag `v5_input`): `/input` for every role (tasks, upload and checks with the SheetJS mini build / paste / example / template, partial save re-validated on the server, parameters, history, Finance completeness grid with reminders and release with a reason); Input replaces Upload in the navigation; K35 pre-check in the weekly release; `xlsx@0.18.5` in `apps/web`.
- Fixtures `upload-samples` (Lampiran B.5): three example files, context and expected results.

## [v5-4] Putaran Commercial ↔ PPIC (docs/PRD-v5.md irisan 4)

### Added
- Engine `commercial-v5.ts`: `holdingRate`, `stockSellRows`, `stockSummary`, `filterRows`, `commitmentDemand` (K26), `commitmentDeadline`, `c52`, `spotRows`, `kgByBaseKey`.
- Web (flag `v5_commercial`): Commercial v5 screen (filter, five cards, ranking with cost status, commitments with lock by the commercial lead, PPIC surplus with an answer, spot); price list of next week locked with the commitments (K24); locked commitments as Confirmed demand in PPIC.

## [v5-3] PPIC per kelas (docs/PRD-v5.md irisan 3)

### Added
- Engine `ppic-class.ts`: `sizeKgOf`, `toClassLB` (K28), `classByProducts`, `dailyClassPlan`, `weekClassPlan`, `c50`, `c51`, `c58`, `needByCutDate`, `netShareOf`.
- Fixture `plan-2026-08-24`: `v5` blocks in inputs and golden (Lampiran B.3/B.4, placeholder); the v4 values are unchanged.
- Web (flag `v5_ppic_class`): PPIC · Rencana v5 (demand per size → class → kg LB, weekly plan with need / saved versions, daily plan per class, today, batch actual vs plan); saving writes `plan_week_class`; copy to batch needs C58; builder `demand_class_weekly`; C51 on the LB supply upload.

## [v5-2] Laba rugi (docs/PRD-v5.md irisan 2)

### Added
- Engine `pl-v5.ts`: `fixedNominals`, `fixedEstimateRows` (K29, basis `fixed_estimate`), `c55`, `plWeeks`, `plTable('rr' | 'wk')` (K30), `cumulativeSeries` for five measures (K31), `plTotalsV5`, `plBudgetOf`, `lineTotals`.
- Month builder (flag `v5_pl`): fixed-cost estimate rows into `pl_daily_v4`, C55 in the controls and the V1 pre-flight, nominal sources with the lock note and the version snapshot.
- Outlook bulan and Minggu ini (flag `v5_pl`): P&L tile with two views, cumulative chart with five measures, cards and headline with NIBT according to the journal and after fixed costs.

### Changed
- `totalsV4` and `plRowsFromMart` leave the `fixed_estimate` rows out, so every v4 number stays on the journal.

## [v5-1] Costing (docs/PRD-v5.md irisan 1)

### Added
- Engine: cost status (rencana / estimasi / sementara / final), `planCost`, `simulateLivebird` (K25), `revalueLots` + `finalLots` (K22), `idleCostDaily` and `costingPlRows` (Q63), C53, C54, C57; `priceFloorV5`. Fixture `costing-sim-2026-08-24` (Lampiran B.1).
- Migration `20261022000100_v5_costing.sql`: cost per kg, status and C54 on `commercial_daily`, view `commercial_daily_sales_v5`, `lot_revaluation.sold_by_date`, trigger `wp_received`.
- Web (flag `v5_costing`): ledger lots of unposted RPA batches carry the costing cost and status; Commercial reads cost + status from the mart; P&L rows "Selisih costing" and "Biaya kapasitas idle"; costing page status per batch with C53/C54/C57.

### Changed
- With `v5_costing` on, no live-bird recommendation on any screen or PDF (K25); flag off unchanged.

## [v5-0] Foundation (docs/PRD-v5.md irisan 0)

### Added
- `docs/PRD-v5.md` (replaces PRD v4 as product authority), mockup v5 in `reference/design/v5/`.
- Migration `20261021000100_v5_foundation.sql`: §5 columns and tables (empty), weight classes K/S/B without numbers, role `operations_director`, RLS per Bab 8, task registry seeded from §3.1, flags `v5_*` (off).
- App: role "Direktur Operasional" (reads like management), v5 write areas, v5 flags.

### Changed
- The v4 planner skips weight classes without an average (K/S/B until PPIC fills them).

## [v4-5] Komersial (docs/PRD-v4.md irisan 5)

### Added
- Migration `20261020000100_v4_commercial.sql`: `floor_guard_v4` (C38 after the row is written, approval used up under a row lock), `allocation_floor` (no allocation of an unapproved line under the floor), `spot_guard` (K8), helpers `sales_key`, `floor_of`, `take_approval`, `sales_scorecard_weekly.kg_spot`.
- Engine: `spotCheck`; `scorecard` counts kg spot.
- Web: Komersial v4 behind `v4_design` (cards, ranking, spot, approval queue, C38–C40); actions to record a spot sale and to create the order of an approved discount; kg spot on the scorecard.

### Changed
- The old before-insert C38 trigger `floor_guard` is replaced; one approval covers one order line, also through the API.
- `consumeApprovals` no longer unlinks an approval; an invoice or DO with the document number of a spot line keeps the spot channel.

## [v4-4] Tutup buku dan rilis server-side (docs/PRD-v4.md irisan 4)

### Added
- Migration `20261019000100_v4_release.sql`: `release_week` / `release_month` (§7.2), `release_override` and `release_override_policy`, flag `v4_release` (off), `overhead_rate.rate_per_head`, trigger `batch_cost_mode` (own RPA from 1 Nov 2026), trigger `allocation_run_c48`, `lot_movement.revenue_date / cost_ma_revenue` (DI-01). Rollback script in `supabase/rollback/`.
- Engine `close-v4.ts`: `releaseVerdict`, `monthMandatory`, `v1Codes`, `c48`, `reconcileSplit`, `finalTotalsV4`, `worstByCode`, `calibrationV4`, `unbilledRevaluation`; overhead per head in `allocateBatch`.
- Web: override forms on Kontrol (weekly), the Outlook bulan Finance panel (V1) and Tutup buku (FINAL); Tutup buku v4 behind `v4_design` (FINAL, accuracy, calibration, DI-01); builder "accuracy v4" for `forecast_accuracy_daily`; five-part stock reconciliation on `/sku`; Rp/ekor on the overhead rate form; C48 in the weekly costing controls.

### Changed
- A weekly release and a monthly version are written only through the database functions; direct inserts are refused. With `v4_release` off the weekly rule is unchanged (only GAGAL rejects).
- A FINAL (v3 and v4) is refused while an Aktual batch of the month has no SKU output (C48).
- The week guard skips the generated `week_end`, so a release by Finance now marks the week released.
- `computeMonthV4` reads the parameters and run-rate table of the month's last week; the engine's register includes manual and calibration rows.

## [v4-3] PPIC: demand, rencana, alokasi (docs/PRD-v4.md irisan 3)

### Added
- Engine: K1 in `headsByPattern` / `weekDemand` (`isMain`; by-product output and shortfall), K2 forecast source in `weeklyDemand`, `ppic-v4.ts` (`statForecastWeek`, `shortfallRows`, `ppicControls` C41/C42/C44/C46/C47, `ppicBlockers`, `stepGates`, `planVarianceDaily`, `firstDelivery`, `daysAheadOf`).
- Fixture `plan-2026-08-24` (Lampiran B.3, placeholder) with tests.
- Migration `20261018000100_v4_ppic.sql`: `demand_weekly.unit / product_class / source_forecast`, `plan_week.yield_provisional / controls`, table `plan_check_reason`, unique DO per PO line on `delivery`, empty capacity rows for 19 Oct–29 Nov 2026.
- Web: M3 builder writes `demand_shortfall` and `plan_variance_daily`; pages Rencana (§6.4) and Alokasi hari ini (§6.5) behind `v4_design`; upload `delivery` (CSV); reason action for PERIKSA steps.

### Changed
- Netting judges stock eligibility on the first delivery date of the week instead of the lead time.
- Save / approve / copy of a weekly plan follow C45 / C46 / C42–C47; a plan on placeholder yields is labelled.
- The M2 ledger reads deliveries on open PO lines (K7); an allocation is used once across a line's deliveries.
- Cut-off is refused before the day's cut-off time (K8).

### Verified
- Weekly snapshot byte-identical; parity 17.161/17.161; tests engine 256, parsers 23, web 59; RLS 16 blocks without (!); screenshot comparison `ppic-rencana`.

## [v4-2] Outlook bulanan dan kas (docs/PRD-v4.md irisan 2)

### Added
- Engine `month-v4.ts` (P1–P14): rows per day × segment × line × basis for `pl_daily_v4`, run-rate per segment, forecast with PO, run-rate and M5 drivers, summary and range, vs budget, register of assumptions, run-rate test, lock blockers, V1 → V2 bridge for revenue / GP / NIBT, accuracy against FINAL, C49 and C32.
- Engine `monthly.ts`: K3 `runrateRevenue` (7 calendar days), `gpPctMtd`, `v1LockDate`; `drivers.ts`: template 8.3 fields, `dailyFixed` on working days, `carryForwardFixed`, C43; `cash.ts`: `cashProjectionSplit`, `cashProjection12mOrNull`, `cashWeeksFromDays`.
- Migration `20261017000400_v4_cash_split.sql`: split and scenario columns plus `horizon` on `cash_position_daily`.
- Web: builder "monthly v4" (`lib/v4/month.ts`), lock V1/V2 with snapshot SHA-256, pages Outlook bulan (`/m/[month]`), Kas & solvabilitas (`/kas`) and Biaya tetap & driver (`/m/[month]/biaya`) behind `v4_design`; Finance actions for budget, cut-off, register, lock, template 8.3 rows and one-off costs.
- Uploads `fixed_cost` (template 8.3) and `budget`; parsers accept a month written as `2026-08`.
- Fixtures `month-2026-08/golden-v4.json` (proposed, K4) and `accuracy-2026-08`.

### Changed
- Run-rate of the v3 monthly path follows K3; the week builder of irisan 1 is skipped while `m4_monthly` is on.
- "Bangun ulang" on the monthly page queues the month and runs it with the service role (S1 had made the old button fail).
- The month card of Minggu ini reads `pl_daily_v4` and `budget`, as Outlook bulan does.

### Fixed
- Run-rate days no longer subtract expedition and blasting again on top of the GP P&L margin (P6).
- Transfers between own bank accounts are no longer counted as operating flows or deficit drivers.

### Verified
- Weekly snapshot byte-identical; parity 17.161/17.161; tests engine 242, parsers 22, web 48; RLS 15 blocks without (!); migrations re-runnable on the KGR-OS rehearsal copy; screenshot comparison in `docs/v4/bukti/`.

## [v4-1] Design system dan Minggu ini (docs/PRD-v4.md irisan 1)

### Added
- Migration `20261017000300_v4_design_flag.sql`: flag `v4_design` (default off); a change of `runrate`, `parameter`, `sku_price`, or `opening_stock` queues the Monday of its week.
- Engine `week-outlook.ts`: `weekPlDaily`, `weekOutlook`, `gpBridge` (GP produk → GP P&L), `weekHeadline`, `weekCash`, `stockOverAge`, `stockAgeBuckets`, K16 formatters. `computeWeek` unchanged.
- Web: `app/v4.css` (tokens §5.2, scoped to `.v4`), `components/v4/*` (§5.3), v4 shell and navigation per role (`lib/v4/nav.ts`), page `/minggu-ini/[week]` (§6.1), `/admin`, rebuild builder `lib/v4/week-pl.ts` for `pl_daily_v4`.
- `reference/design/`: four mockups, `grammar.css`, generator.
- Tools: `apps/web/scripts/v4-screens.mjs` (§9.4 comparison), `v4-fixture.tsx` (fixture harness), `v4-drawer.test.mjs` (keyboard).

### Changed
- With `v4_design` on, the management view of `/w/[week]/outlook` redirects to Minggu ini (blocks 2 and 5 are not rendered, K15, K18); preparer view, print view, and PDF keep every v1 block.
- Tokens `--chart-2` and `--muted` replaced after measuring contrast (QUESTIONS Q21).

### Verified
- Weekly snapshot byte-identical; parity 17.161/17.161; RLS 14 blocks without (!); above-the-fold, DOM grep, contrast, drawer keyboard in `docs/v4/bukti/`.

## [v4-0] Foundation (docs/PRD-v4.md irisan 0)

### Added
- `docs/PRD-v4.md` (otoritas produk), `reference/design/tokens.css`, `docs/v4/QUESTIONS.md`, `docs/v4/irisan-0.md`.
- Migration `20261017000100_v4_schema.sql`: §4.1 columns (`sku_key.product_class`, `sales_line.channel` / `cancelled_kg`, `forecast_line.forecast_source` / `scenario`, template 8.3 fields on `fixed_cost_schedule`, `coa_map.segment` + driver `event`, `parameter.runrate_window_days` / `v1_lock_week` / `spot_enabled`, provenance on `month_outlook_version`); §4.2 tables `delivery`, `cost_event`, `budget`, `assumption_register`, marts `pl_daily_v4`, `demand_shortfall`, `plan_variance_daily`, `forecast_accuracy_daily`; §4.3 `data_status`, `status_map`; K7 triggers (Σ delivery ≤ kg − cancelled, `fulfilled_kg` derived).
- Migration `20261017000200_v4_security.sql`: S1 (`mart_replace` service role only, restrictive no-client-write policies on the v3 marts, `data_status` written per scope), S2 (commercial view and discount requests default deny for sales), S4 (cost audit rows hidden from sales), S5 (C29 `allocation_cap`, C38 `floor_guard`, locked version not deleted, approved plan not edited, no self-approval), S6 (definer hygiene check).
- Engine: `delivery.ts` (`outstandingKg`, `deliveryCheck`), `cancelled_kg` in allocation / demand / plan / C28, `ControlV3Status` with `STALE` and `N/A`, `staleControl` (C45), `blocking`.
- Web: `lib/supabase-service.ts` (rebuild with the server's service role when `SUPABASE_SERVICE_ROLE_KEY` is set), `lib/v3/delivery.ts` (Terkirim with kg and DO number), `lib/v3/stale.ts` (C45 on Rencana and Alokasi; save and allocate refused when STALE), `assignedKeysFor`.
- Fixture `fixtures/delivery-partial`.

### Changed
- `processRebuildQueue(settings)` no longer takes the user's client; without the server key it leaves the queue and says why.
- `scripts/test-rls.sh` re-runs the v3/v4 migrations after the seed and fails when a test block does not report.
- `rls_roles.sql`: the v3 expectations that signed-in roles write marts through `mart_replace` now expect a refusal; new blocks for the 9-role matrix, K7, S5, §4.2.

### Verified
- Snapshot of week 2026-08-24 byte-identical; parity 17.161/17.161; RLS 13 blocks without (!). Evidence `docs/v4/bukti/`.

## [v3-F7] Rilis bulanan, PDF, mobile, management view v3 (docs/PLAN-v3.md Fase 7)

### Added
- Engine `management.ts` (`inputSummary`, `cogsBySegment`, `rollForward`, `urgentStock`, `demandTotals`).
- Web: monthly PDF `/api/m/[month]/pdf` and snapshot `/api/m/[month]/snapshot.json` (per locked version); weekly management view in PRD v3 §6 order with Input and COGS always present and the module sections / headline tiles when on (`lib/v3/management.ts`, `components/v3/ManagementV3.tsx`, `OutlookBody` split into parts); mobile read-only write forms on `/sku/[key]`, `/m/[month]`; `apps/web/vitest.config.ts` (alias + JSX) and `components/OutlookBody.test.tsx`.
- Docs: `docs/handover.md` §4a (v3 daily rhythm, new roles), `docs/v3/SUMMARY.md`.

### Fixed
- `processRebuildQueue` does nothing when no module is on (`anyModuleOn`): a v1 upload no longer reads `rebuild_queue`, so the merged code runs on a database that does not have the v3 migrations yet (production before `db push`).

### Verified
- Preparer / management / print HTML without v3 slots identical to before the refactor; weekly snapshot unchanged.

## [v3-F6b] M7 Approval diskon + scorecard (docs/PLAN-v3.md Fase 6, PR 6b)

### Added
- Migration `20261016001300_m7_approval.sql`: `discount_limit()`, decision guard on `discount_approval` (pending only on insert; commercial_lead ≤ limit, finance above; decisions final), `needs_rebuild` on `sales_target`.
- Engine: `guardOrders` (order guard under the price floor) in `commercial.ts`.
- Web: `lib/v3/discount.ts` (floor guard on Input → Penjualan save / paste and `po_lines`, approvals, C38, scorecard builder), `/komersial/approval`, `/komersial/scorecard`, C38 on Kontrol.

### Verified
- Order under the floor refused without approval; lead / finance limits enforced in the database; snapshot unchanged.

## [v3-F6a] M7 Commercial view (docs/PLAN-v3.md Fase 6, PR 6a)

### Added
- Migration `20261016001200_m7_commercial.sql`: `sales_assignment`, `sales_target`, `urgency_rule` (seed Q18), `price_floor_rule`, `discount_approval`, data marts `commercial_daily`, `sales_scorecard_weekly`, view `commercial_daily_sales` (no SI cost), parameters `sales_sees_cost`, `discount_limit_rp_per_kg`.
- Engine `commercial.ts` (urgency, price floor, commercial rows + ranking, realised price, below-floor approver, C38–C40, scorecard).
- Web: `lib/v3/commercial.ts` (builder), `lib/v3/commercial-view.ts` (role view model, tested), `/komersial`, `/komersial/[key]`, C39/C40 and snapshot key `commercial`.

### Verified
- Sales view without SI / cost pool / batch reference; ranking changes with age; snapshot unchanged.

## [v3-F5] M6 Kas, CCC, solvabilitas (docs/PLAN-v3.md Fase 5)

### Added
- Migration `20261016001100_m6_cash.sql`: `bank_account`, `cash_daily`, `cash_daily_plan`, data marts `cash_position_daily`, `ccc_daily`, `solvency_monthly`.
- Engine `cash.ts` (position, scheduled payments, 13 weeks, 12 months, solvency, C35–C37) and `ccc.ts` (DIO/DSO/DPO/CCC, working capital, simulation).
- Parsers `cash_balance` / `cash_plan_daily`; template `reference/templates/Template_Kas_Harian.xlsx` (`scripts/make_cash_template.py`).
- Web: `lib/v3/cash.ts` (upload kind `cash_daily`, builder), `/kas`, `/kas/ccc`, C35–C37 and snapshot keys `cash`, `ccc`, `solvency`.

### Verified
- FS Sep 2026: equity 702,6 jt, paid-in 5.000 jt, affiliates 9.845,9 jt; DI-01…DI-04 amounts; snapshot unchanged.

## [v3-F4b] M4 Outlook bulanan (docs/PLAN-v3.md Fase 4, PR 4b)

### Added
- Migration `20261016001000_m4_monthly.sql`: `month_outlook`, `month_outlook_version` (immutable, SHA-256), `outlook_assumption`, `closing_adjustment` (seed DI-01…DI-05 Sep 2026), data mart `pl_daily`, `outlook_accuracy`, `week.month_outlook_id`, parameters `v1_lock_day` / `forecast_tolerance_pct`, `needs_rebuild` on `gl_line`.
- Engine `monthly.ts` (actual per day incl. unbilled DO, run-rate without anomalies, forecast per day, opex from drivers, outlook + range + budget, V1 lock day, bridge, accuracy, calibration, C32); fixture `fixtures/month-2026-08` (extractor `month`).
- Web: `lib/v3/monthly.ts` (pl_daily builder, versions, FINAL + accuracy + calibration), `/m/[month]`, `/m/[month]/tutup-buku`, SVG daily chart, C32 and snapshot key `monthly`.

### Verified
- Actual 1–26 Aug = O_PnL MTD (6.385,9 / 347,4 jt); PO days 27–29 Aug; run-rate 31 Aug (258,7) not reproduced — todo, docs/open-questions.md §E.4.

## [v3-F4a] M5 Biaya dengan driver (docs/PLAN-v3.md Fase 4, PR 4a)

### Added
- Migration `20261016000900_m5_drivers.sql`: `coa_map` driver columns (+ Finance guard), `cash_plan` link columns, `fixed_cost_schedule` (seed from FS September 2026), default drivers.
- Engine `drivers.ts` (`monthlyAmount`, `dailyFixed`, `monthFixedOutlook`, `variableCost`, `workingDays`, `runrateDaily`, `costActualByLine`, `driverControls` C33–C34); fixture `fixtures/fs-2026-09` (extractor `fs`).
- Web: `/m/[month]/biaya` (schedule, drivers per account, fixed outlook), C33/C34 and snapshot key `drivers` when `m5_drivers` is on.

### Verified
- Sewa RPA 94,48 jt/month from 2026-11-01 (prepaid 1.133,79 jt / 12); fixed outlook never counts a line twice; snapshot unchanged.

## [v3-F3b] M3 Alokasi FEFO + cut-off (docs/PLAN-v3.md Fase 3, PR 3b)

### Added
- Migration `20261016000800_m3_allocation.sql` (allocation write for ppic / commercial_lead, `needs_rebuild` on `allocation`, indexes).
- Engine `allocation.ts` (`allocateFEFO`, `cutoffBlasts`, `lotsForAllocation`, `sellableOn`, `stockAllocationRecon` = B_Alokasi_Stok); C29 sums allocations per line; ledger explicit allocations never take more than the line sells.
- Web: `/hari/[date]/alokasi` ("Alokasikan hari ini", "Cut-off", "Terkirim"), M3 allocations as ledger input (follow a superseded line to its Accurate posting), v1 Terkirim also sets `fulfilled_kg` when `m3_planning` is on, PO columns on Input → Penjualan, C29/C31 and snapshot key `allocation`.

### Verified
- B_Alokasi_Stok: 2.000 kg allocated of 100.000 kg on hand, per SKU and per customer; example-week end-to-end (allocation → Terkirim → cut-off → ledger); snapshot unchanged.

## [v3-F3a] M3 Demand → rencana mingguan / harian (docs/PLAN-v3.md Fase 3, PR 3a)

### Added
- Migrations `20261016000600_m3_planning.sql` (`sales_line` PO columns `delivery_date`, `demand_status`, `sales_rep`, `po_ref`, `po_date`, `fulfilled_kg`, `price_floor_at_sale`, `discount_approval_id`; parameters `tentative_weight`, `forecast_weight`, `downgrade_approval_threshold`, `lead_time_days`; `weight_class`, `yield_matrix`, `substitution`, `forecast_line`, `capacity`, `lb_supply`, `plan_week`, `plan_day`, `allocation`, data mart `demand_weekly`; approval guard; week-scoped `needs_rebuild`) and `20261016000700_m3_backfill.sql` (existing Order rows → Confirmed + delivery date; placeholder weight class STD and yield matrix `karkas` / `boneless`).
- Engine `demand.ts` (`demandRate`, `forecastDaily`, `weeklyDemand`, `eligibleFree`, `netDemand`, `toHeads`, `headsByPattern`, `weekDemand`), `plan.ts` (`jointEconomics`, `weeklyPlan`, `dailyPlan`, `mixParts`, `splitHeadsByDay`, `demandByDay`, `proposeWeekPlan`, `planBatchRow`) and C28–C31 in `controls-v3.ts`; fixture `fixtures/demand-2026-09` from `KGR_Demand_Forecast.xlsx`.
- Parsers: v3 kinds `po_lines`, `forecast_sales`, `yield_matrix`, `lb_supply` (+ `normDemandStatus`, `normSupplyStatus`, `yieldFraction`).
- Web: `lib/v3/planning.ts` (loader, `demand_weekly` builder, plan save / approve / "Salin ke batch rencana", upload kinds), `/w/[week]/demand`, `/w/[week]/rencana`; C28/C30 and snapshot keys `demand`, `plan` when `m3_planning` is on.

### Verified
- 7.051 heads, BLD binding, profit Base 70.817.907 reproduced (`O_Optimizer`), forecast D7:K30 cell by cell; example-week snapshot unchanged.

## [v3-F2] M2 Lot ledger + stok per SKU (docs/PLAN-v3.md Fase 2)

### Added
- Migrations `20261016000400_m2_ledger.sql` (`lot`, `lot_movement`, `lot_balance_daily`, `sku_balance_daily`, `stock_card_snapshot`, `blast_event`, SKU/parameter ledger columns, `mart_replace` keeps input rows, `needs_rebuild` triggers) and `20261016000500_m2_backfill.sql` (queues every date for the engine to build).
- Engine `ledger.ts` (`computeLedger`, `balanceAt`, `reconcile`, `ledgerInputsFromWeek`, `keyResolver`) and C25–C27 in `controls-v3.ts`.
- Web: ledger builder for `rebuildDay` (`lib/v3/ledger.ts`), upload kind `stock_card`, `/sku`, `/sku/[key]` (lots → movements, opname, blast), "Ledger lot" card on Stok, ledger controls and snapshot key `ledger`.

### Verified
- Roll-forward of the example week 162.687,92 → 156.956,05 kg; every day × key equals O_Stok ± 0,01 kg. MA vs Accurate HPP on 30/34 lines (target 95% not reproduced — `docs/open-questions.md` §E.4).

## [v3-F1] M1 Costing per batch → SKU (docs/PLAN-v3.md Fase 1)

### Added
- Migrations `20261016000200_m1_costing.sql` (batch costing columns, `sku_key.group_code/cut_component`, costing parameters, `cost_pool`, `cost_pool_line`, `batch_output_sku`, `overhead_rate`, `allocation_run`, `allocation_line`, RLS: cost detail not readable by sales) and `20261016000300_m1_backfill.sql` (default groups / cut components; SKU rows from v1 `out_*`, marked assumed).
- Engine `costing.ts` (`allocateBatch` relative sales value with secondary "Biaya BL" pool, NRV option and NRV test, own-mode overhead, `computeCostPool`, `groupCostPerKg`, `idleCapacity`) and `controls-v3.ts` (C21–C24); snapshot keys v3 (`toSnapshotV3`, `snapshotJsonV3`).
- Parsers `costing-wp.ts` (WP batch sheets) and `v3-tables.ts` (`cost_pool_pi`); fixture `fixtures/costing-2026-09` from `202609_Data_COGS_LB.xlsx`.
- Web: v3 upload kinds in the existing wizard (`lib/v3/uploads.ts`, WP + PI), `/w/[week]/input/costing`, `/w/[week]/costing`, v3 controls on Kontrol, v3 keys in release / snapshot.json when the module is on.

### Verified
- Column L of every Pot_ISA / Pot_AGRO sheet reproduced ± Rp 1 (637 SKU rows); snapshot of the example week unchanged.

## [v3-F0] Data fixes, fondasi, backup (docs/PLAN-v3.md Fase 0)

### Added
- `docs/PRD-v3-kgr-platform.md`, `docs/PLAN-v3.md`; source workbooks `reference/202609_Data_COGS_LB.xlsx`, `reference/KGR_Demand_Forecast.xlsx`, `reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx` (as received).
- Migration `20261016000100_v3_foundation.sql`: roles `commercial_lead` and `cost_accounting`; `app_setting` with module flags `m1_costing … m7_commercial, m7_approval` (off); `module_enabled()`; `rebuild_queue` and `tg_needs_rebuild()`; `data_fix` log; data mart registry `mart_table` and writer RPC `mart_replace()`; policies for the new roles on existing tables; private bucket `backups`.
- `apps/web/lib/modules.ts` (`moduleEnabled`, `requireModulePage` → 404, `requireModuleAction` → `WriteError`), `lib/rebuild.ts` (rebuild registry and queue), `/admin/modul` (flags per module and role, rebuild queue, "Bangun ulang"), "Modul" group in the navigation (only modules that are on for the role).
- Data fixes `supabase/fixes/F0-D3.sql`, `F0-D4.sql`, `F0-D7-D9-runrate.sql`, `F0-D8.sql` (run by a person after testing); `docs/open-questions.md` §E (D1–D9, Q1–Q20 defaults, v3 implementation choices).
- `.github/workflows/backup.yml` (daily `pg_dump`, manual dispatch before `db push`); CI: `pnpm snapshot:diff`, job `rls` (PostgreSQL 16 + `supabase/tests/supabase_shim.sql`, migrations twice, seed, `rls_roles.sql`); `pnpm test:rls`.
- `scripts/extract_fixtures.py v3|costing|demand|fs|month` and fixture skeletons `fixtures/costing-2026-09`, `demand-2026-09`, `fs-2026-09`, `month-2026-08`.

### Unchanged
- Engine v1, golden tests, parity (17.161/17.161), snapshot of the example week (SHA-256 `947ce203…a83`).

## [M1] Engine and golden tests

### Added
- Monorepo (pnpm workspaces) with `packages/engine`; reference Excel files in `reference/`.
- `scripts/extract_fixtures.py` — reads `reference/KGR_Weekly_Outlook.xlsx` with openpyxl; writes the example week's inputs to `fixtures/week-2026-08-24/*.json` and the cached value of every formula cell to `golden.json`.
- `@kgr/engine` — pure TypeScript, decimal.js arithmetic (no floating-point money):
  - `prepare` — derived columns of the input sheets (keys, counted flags, values, batch KPIs, GL classification, cash-line counter accounts).
  - §5.1 stock projection (O_Stok), HPP per sales line.
  - §5.2 week summary (block 1), §5.3 RPA decision (block 2), §5.4 Trading decision (block 3), stock actions (block 4), cash out (block 5), batch KPI (block 6), alerts (block 7).
  - Deterministic snapshot (`snapshotJson`) — identical inputs give byte-identical JSON.
- Golden tests: every formula cell of O_Outlook, O_Stok, O_PnL, O_BS, O_CF, Z_Kontrol, I_Parameter and the derived T_*/I_* columns (17.161 cells) within Rp 1 / 0,01 kg; PRD §10 headline numbers; rule unit tests for every branch of §5.
- CLI: `pnpm outlook --week 2026-08-24 --today 2026-08-27` prints blocks 1–8 as text.
- `pnpm parity` writes `docs/parity.md` and `docs/parity-cells.csv`.
- `docs/open-questions.md` — Excel ↔ PRD differences with cell references.

## [M4-engine] Statements and controls (engine part, delivered with M1)

### Added
- §5.6 weekly P&L (O_PnL), §5.7 balance sheet with planned-flow roll-forward (O_BS), §5.8 direct cash flow with counter-account classification, tie-outs and daily cash (O_CF).
- Controls 1–19 (Z_Kontrol) and control 20 (Ops vs Accurate), block 8 statement summary.

## [M2] Data layer and uploads

### Added
- Supabase schema for PRD §4 (`supabase/migrations/`): weeks, parameters, SKU keys and prices, item/COA maps, opening stock, sales, receipts, batches, GL lines, opening TB, run-rate, cash plan, uploads, releases, audit log. Money `numeric(18,2)`, kg `numeric(12,2)`; provenance on every input row (source Accurate/Ops/Manual, document ref, line key, upload id); soft delete.
- Row Level Security per role (Admin, Inventory Accounting, Finance, Sales, PPIC, Purchasing/Ops, Management) with column guards on parameters, prices and weeks; closed weeks are read-only; every change written to `audit_log` by trigger; `apply_changes` RPC applies an upload atomically under the caller's RLS.
- Login allow-list on `auth.users` (only active `app_user` e-mails); Admin creates logins and resets passwords in the app; first Admin via `set_login_password` in the SQL editor.
- `@kgr/parsers` (SheetJS): Accurate sales, goods receipts, inventory ledger and balance, journal, trial balance; Ops batch costing, delivery notes, trading GRN, stock count; CSV orders and plans; the full KGR_Weekly_Outlook workbook. Indonesian and English number/date notation; header detection by alias.
- Upload wizard: file to private Storage, server-side parse, preview with new/updated/unchanged/superseded counts, item-mapping shortcuts, commit. Re-uploading the same file is idempotent (line keys; legacy rows matched by content).
- Week rollover (Monday): parameters, prices, run-rate and TB carried; opening stock from last week's projected closing until the Monday inventory valuation lands; last-week summary from the latest release.

## [M3] Outlook, input pages, controls 1–11 + 20, PDF

### Added
- Next.js App Router app (`apps/web`), Bahasa Indonesia UI with the Excel labels, house number format (`id-ID`), cream inputs, green source links, red warnings, a "Cara hitung" tooltip on every computed figure.
- Pages: Outlook (blocks 1–8), Stok (O_Stok with status codes and CSV export), Batch RPA, input pages per table (Penjualan with "Terkirim", Penerimaan, Batch, Kas, Stok awal, Parameter, Harga, Run-rate) with keyboard entry and CSV paste, master Item/COA/SKU, Admin Minggu/Pengguna/Audit (restore).
- Week banner: control status, last release, rows still sourced from Ops, opening-stock flag, closed week.
- PDF export (pdfmake, A4 landscape, 3 pages) and a print view with the same layout; deterministic snapshot JSON per week.

## [M4] Statements, controls 12–19, block 8, release

### Added
- Laba Rugi, Neraca and Arus Kas pages (statement lines in English as in the P&L deck), drill-down from actual figures to journal lines, cash-flow category override per voucher.
- Kontrol page (controls 1–20, LULUS / PERIKSA / BELUM DIISI / GAGAL) and Rilis: a release stores the snapshot JSON and the PDF in Storage with who/when; any GAGAL blocks the release.

## [M5] Pilot support

### Added
- Mobile read-only layout: input navigation hidden below 760 px, wide tables scroll inside their card with the line label pinned.
- `docs/handover.md` (deploy, first Admin, weekly routine, roles, troubleshooting); pilot log section D in `docs/open-questions.md`.
- `apps/web/vercel.json` (functions in `hnd1`, next to the Supabase region); Supabase URL and publishable key default to the pilot project so a fresh Vercel import builds without configuration.
- CI also typechecks and builds the web app.
- Deployed to Vercel: https://kgr-weekly-outlook.vercel.app (project `kgr-weekly-outlook`, root `apps/web`, functions in `hnd1`), verified end to end on the live URL.

### Fixed
- Week dates must be real calendar days: `2026-02-31` is rejected by the engine and gives 404 on `/w/…` and `/api/w/…` instead of a database error.
- Control 20 states how many sales/receipt rows are still Ops-sourced (status unchanged; the rows are stored with each release).
- Logged A18 in `docs/open-questions.md`: the cash-line counter account is matched on the amount rounded to Rp, as in `T_GL!P6:Q6`.

### Security
- Self sign-up through the Auth API is refused: before, an allow-listed e-mail without a login could be claimed by anyone who called the sign-up endpoint (the trigger auto-confirms). Logins now come only from `set_login_password` / Admin, or Google OAuth for allow-listed e-mails (`20261014000600_signup_lock.sql`).
- Trigger functions are no longer exposed under `/rest/v1/rpc`.

## [Management View v2] Role-based Outlook (`docs/PRD-management-view-v2.md`)

Evidence per stage (checklist PRD §5, screenshots 1366×768): `docs/management-view/README.md`. Engine numbers are guarded by `tests/snapshots/outlook-2026-08-24.before.json` (`pnpm snapshot:diff`, `snapshot-baseline.test.ts`).

### Stage 1 — R1 role split
- `viewMode` (`management` | `preparer`) from the existing role: `management` always gets the management view; every other role is a preparer and can preview the management view from the topbar (cookie `kgr_view`). Presentation only; access rules are unchanged.
- Root `pnpm test` also runs the web unit tests.

### Stage 2 — R2, R4, R9 (zero rows)
- Engine: `block2.action` — the RPA recommendation as one action from {TUNDA, NEGOSIASI ≤ Rp X, BELI, POTONG N kg} with the text `[AKSI]: [alasan]`. Mapped from the existing Excel code and figures (NEGOSIASI target = breakeven of today's plan, B21); no formula changed. Example week: "NEGOSIASI ≤ Rp 20.726: harga live bird hari ini Rp 24.600 di atas breakeven rencana potong".
- Management view: headline block under the title (GP projection and Δ vs last week, today's RPA action, stock above the age limit with a link to the SKU detail), read from the same fields as the tables; section 2 shows the action; stock rows with 0 SKU are hidden (grey in the preparer view).

### Stage 3 — R3, R5, R10, R12, R13
- Engine: every warning (`block7[]`) carries `audience` (`management` | `preparer`); data-hygiene warnings (past orders, new item codes, empty reference prices) go to the preparer.
- Management view, section 2: the action, the four deciding figures (LB price, breakeven 100% fresh, margin/kg, expected margin of the plan), the "stock already covers the orders" sentence instead of zero rows, the rest under "Lihat perhitungan".
- "Cara hitung" becomes a tooltip on the label (keyboard focusable, one `?` hint in the header); sheet names are shown in plain words (`lib/sources.ts`), and no technical name reaches the management DOM.
- Management view: only management warnings, without the ones already in the headline; the yellow control bar becomes one grey line "Rilis 27 Agu 2026 · 18/20 kontrol lulus · 2 belum diisi" linking to Kontrol, with no e-mail; nav shows the seven report pages only; the release page drops e-mail and audit columns.

### Stage 4 — R6, R7, R8, R9 (status text), R11, R14, R15, R16 (management view; the preparer view keeps the Excel block numbers and vocabulary)
- Section headings are statements without numbers; the methodology parentheticals, the yield note, the stock status definitions, the spread minimum and the payment terms are numbered notes ("Catatan") linked by anchors.
- Summary table: GP projection, GP % and Δ GP/kg at weight 600; order columns secondary.
- One meaning per colour: red only for negative values; the recommendation box is neutral (`--surface-2`, 3px accent border); warnings are default text with a "Peringatan:" prefix; stock status and trading recommendations are plain text, not coloured pills.
- One date format ("24 Agu 2026") in the header, week selector and tables; the subtitle under the title is gone.
- One "Unduh PDF" button with "Tampilan cetak" as a text link; the unit column does not wrap.

### Fixes after review (Codex findings on #3 and #4)
- R4: `LANJUT` with no plan, or a plan smaller than the fresh orders need, reads `POTONG {LB maksimum} kg LB: rencana … kg belum menutup order fresh` instead of keeping the undersized plan.
- R12: when the live control counts differ from those frozen in the latest release, the release line says "data berubah sejak rilis" before the current counts.
- R12: the management header never falls back to the e-mail when an account has no name.
