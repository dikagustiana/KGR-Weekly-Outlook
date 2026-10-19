# PRD v6 R173 — inventaris kode (draf untuk ditinjau Dika sebelum R174)

Dibangkitkan dari impor statis `apps/web` (tanpa tes) pada cabang v6. Kolom "dipakai oleh" untuk halaman = flag yang disebut
halaman itu; untuk komponen dan lib = jumlah file yang mengimpornya. **Kunjungan 30 hari dari `audit_log` belum diisi**: butuh
query ke KGR-OS (PRD L, risiko "penghapusan menghapus halaman yang dipakai"); belum dijalankan dari sesi ini.

Tidak ada yang dihapus di irisan 1–5. Irisan 6 dimulai sesudah `v6_pages` hidup untuk semua role ≥ 1 minggu dan M1–M7 terukur
(PRD K); daftar flag permanen K99 dikonfirmasi dari `app_setting` production dulu (Q-v6-2; default PRD: `v4_design`, `m1`–`m4`,
`m6`, `m7_commercial`).

| Jenis | File | Versi | Flag / dipakai oleh | Nasib (usulan) |
| --- | --- | --- | --- | --- |
| page | `app/admin/audit/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/admin/minggu/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/admin/modul/page.tsx` | v5 | v5_costing, v5_pl | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/admin/page.tsx` | v4 | — | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/admin/pengguna/page.tsx` | v5 | — | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/akun/page.tsx` | v1 | — | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/api/cron/rebuild/route.ts` | v5 | — | tetap |
| page | `app/api/m/[month]/pdf/route.ts` | v1 | m4_monthly | tetap |
| page | `app/api/m/[month]/snapshot.json/route.ts` | v1 | m4_monthly | tetap |
| page | `app/api/release/[id]/[file]/route.ts` | v1 | — | tetap |
| page | `app/api/w/[week]/pdf/route.ts` | v1 | — | tetap |
| page | `app/api/w/[week]/snapshot.json/route.ts` | v1 | — | tetap |
| page | `app/api/w/[week]/stok.csv/route.ts` | v1 | — | tetap |
| page | `app/auth/callback/route.ts` | v1 | — | tetap |
| page | `app/auth/signout/route.ts` | v1 | — | tetap |
| page | `app/hari/[date]/alokasi/page.tsx` | v4 | m2_ledger, m3_planning | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/input/page.tsx` | v5 | v5_input | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/kas/ccc/page.tsx` | v1 | m4_monthly, m6_cash | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/kas/page.tsx` | v4 | m4_monthly, m6_cash | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/komersial/[key]/page.tsx` | v1 | m7_commercial | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/komersial/approval/page.tsx` | v1 | m7_approval | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/komersial/assignment/page.tsx` | v5 | m7_commercial | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/komersial/page.tsx` | v5 | m7_commercial, v5_commercial, v5_costing | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/komersial/scorecard/page.tsx` | v1 | m7_approval | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/kosong/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/login/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/m/[month]/biaya/page.tsx` | v4 | m5_drivers | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/m/[month]/page.tsx` | v4 | m4_monthly | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/m/[month]/rekonsiliasi/page.tsx` | v5 | m4_monthly | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/m/[month]/tutup-buku/page.tsx` | v4 | m4_monthly | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/master/coa/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/master/item/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/master/sku/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/minggu-ini/[week]/page.tsx` | v5 | — | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/route.ts` | v4 | — | tetap |
| page | `app/sku/[key]/page.tsx` | v1 | m2_ledger | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/sku/page.tsx` | v1 | m2_ledger | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/w/[week]/arus-kas/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/w/[week]/batch/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/w/[week]/costing/page.tsx` | v5 | m1_costing, v5_costing | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/w/[week]/demand/page.tsx` | v1 | m3_planning | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/w/[week]/input/batch/page.tsx` | v1 | — | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/w/[week]/input/costing/page.tsx` | v1 | m1_costing | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/w/[week]/input/harga/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/w/[week]/input/kas/page.tsx` | v1 | — | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/w/[week]/input/parameter/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/w/[week]/input/penerimaan/page.tsx` | v1 | — | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/w/[week]/input/penjualan/page.tsx` | v1 | m3_planning | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/w/[week]/input/runrate/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/w/[week]/input/stok-awal/page.tsx` | v1 | — | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/w/[week]/kontrol/page.tsx` | v4 | — | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/w/[week]/laba-rugi/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/w/[week]/neraca/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/w/[week]/outlook/page.tsx` | v4 | — | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/w/[week]/print/page.tsx` | v1 | — | tetap |
| page | `app/w/[week]/rencana/page.tsx` | v5 | m3_planning, v5_management, v5_ppic_class | tetap (v6 di belakang v6_shell/v6_pages) |
| page | `app/w/[week]/rilis/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/w/[week]/stok/page.tsx` | v1 | m2_ledger | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| page | `app/w/[week]/upload/page.tsx` | v1 | — | ganti v6 (K101: tulis ulang ke Table6/Tile) |
| component | `components/ActionForm.tsx` | v1 | 29 | tetap sampai padanan v6 dipakai semua role |
| component | `components/BarChart.tsx` | v1 | 1 | tetap sampai padanan v6 dipakai semua role |
| component | `components/GlTable.tsx` | v1 | 2 | tetap sampai padanan v6 dipakai semua role |
| component | `components/InputTable.tsx` | v1 | 5 | tetap sampai padanan v6 dipakai semua role |
| component | `components/OutlookBody.tsx` | v1 | 3 | tetap sampai padanan v6 dipakai semua role |
| component | `components/PrintButton.tsx` | v1 | 1 | tetap sampai padanan v6 dipakai semua role |
| component | `components/Shell.tsx` | v1 | 35 | tetap sampai padanan v6 dipakai semua role |
| component | `components/ViewToggle.tsx` | v1 | 2 | tetap sampai padanan v6 dipakai semua role |
| component | `components/WeekSelect.tsx` | v1 | 1 | tetap sampai padanan v6 dipakai semua role |
| component | `components/WeekShell.tsx` | v1 | 21 | tetap sampai padanan v6 dipakai semua role |
| component | `components/outlook/Headline.tsx` | outlook | 1 | tetap sampai padanan v6 dipakai semua role |
| component | `components/outlook/RpaDecisionManagement.tsx` | outlook | 1 | tetap sampai padanan v6 dipakai semua role |
| component | `components/ui.tsx` | v1 | 48 | tetap sampai padanan v6 dipakai semua role |
| component | `components/v3/ControlsV3Table.tsx` | v3 | 13 | tetap sampai padanan v6 dipakai semua role |
| component | `components/v3/DailyChart.tsx` | v3 | 1 | tetap sampai padanan v6 dipakai semua role |
| component | `components/v3/ManagementV3.tsx` | v3 | 1 | tetap sampai padanan v6 dipakai semua role |
| component | `components/v4/CaraHitung.tsx` | v4 | 4 | ganti v6 (Card6, Drawer, Shell6) |
| component | `components/v4/Card.tsx` | v4 | 3 | ganti v6 (Card6, Drawer, Shell6) |
| component | `components/v4/Chart.tsx` | v4 | 6 | tetap sampai padanan v6 dipakai semua role |
| component | `components/v4/Controls.tsx` | v4 | 4 | tetap sampai padanan v6 dipakai semua role |
| component | `components/v4/Frame.tsx` | v4 | 1 | ganti v6 (Card6, Drawer, Shell6) |
| component | `components/v4/OverridePanel.tsx` | v4 | 3 | tetap sampai padanan v6 dipakai semua role |
| component | `components/v4/Table.tsx` | v4 | 15 | tetap sampai padanan v6 dipakai semua role |
| component | `components/v4/Tile.tsx` | v4 | 11 | tetap sampai padanan v6 dipakai semua role |
| component | `components/v4/TilePage.tsx` | v4 | 8 | tetap sampai padanan v6 dipakai semua role |
| component | `components/v5/AssignmentForm.tsx` | v5 | 1 | tetap |
| component | `components/v5/AssignmentLink.tsx` | v5 | 4 | tetap |
| component | `components/v5/CommitmentForm.tsx` | v5 | 1 | tetap |
| component | `components/v5/CommitmentRows.tsx` | v5 | 1 | tetap |
| component | `components/v5/CostingV5.tsx` | v5 | 1 | tetap |
| component | `components/v5/RekonsiliasiView.tsx` | v5 | 1 | tetap |
| component | `components/v5/UploadPanel.tsx` | v5 | 1 | tetap |
| component | `components/v6/Card.tsx` | v6 | 1 | tetap |
| component | `components/v6/CompletenessGrid.tsx` | v6 | 2 | tetap |
| component | `components/v6/DecisionDialog.tsx` | v6 | 1 | tetap |
| component | `components/v6/Drawer.tsx` | v6 | 2 | tetap |
| component | `components/v6/GuardedForm.tsx` | v6 | 1 | tetap |
| component | `components/v6/Headline.tsx` | v6 | 3 | tetap |
| component | `components/v6/LoadingPage.tsx` | v6 | 8 | tetap |
| component | `components/v6/MobileMenu.tsx` | v6 | 1 | tetap |
| component | `components/v6/NavProgress.tsx` | v6 | 1 | tetap |
| component | `components/v6/NumberInput.tsx` | v6 | 5 | tetap |
| component | `components/v6/Reload.tsx` | v6 | 1 | tetap |
| component | `components/v6/ScrollFocus.tsx` | v6 | 1 | tetap |
| component | `components/v6/Shell.tsx` | v6 | 1 | tetap |
| component | `components/v6/Status.tsx` | v6 | 6 | tetap |
| component | `components/v6/Stepper.tsx` | v6 | 1 | tetap |
| component | `components/v6/Table.tsx` | v6 | 1 | tetap |
| component | `components/v6/TaskList.tsx` | v6 | 2 | tetap |
| component | `components/v6/TileSkeleton.tsx` | v6 | 1 | tetap |
| component | `components/v6/TileState.tsx` | v6 | 1 | tetap |
| component | `components/v6/WeekPicker.tsx` | v6 | 1 | tetap |
| component | `components/v6/focus-trap.ts` | v6 | 2 | tetap |
| lib | `lib/v3/allocation.ts` | v3 | 4 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/cash.ts` | v3 | 4 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/commercial-view.ts` | v3 | 5 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/commercial.ts` | v3 | 5 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/costing.ts` | v3 | 6 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/delivery.ts` | v3 | 2 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/discount.ts` | v3 | 7 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/drivers.ts` | v3 | 12 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/ledger.ts` | v3 | 7 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/management.ts` | v3 | 2 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/monthly-pdf.ts` | v3 | 1 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/monthly.ts` | v3 | 10 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/planning.ts` | v3 | 10 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/stale.ts` | v3 | 10 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/uploads.ts` | v3 | 26 | tetap (dipakai builder / halaman) |
| lib | `lib/v3/week.ts` | v3 | 6 | tetap (dipakai builder / halaman) |
| lib | `lib/v4/close.ts` | v4 | 3 | tetap (dipakai builder / halaman) |
| lib | `lib/v4/delivery-ledger.ts` | v4 | 1 | tetap (dipakai builder / halaman) |
| lib | `lib/v4/kas-data.ts` | v4 | 1 | tetap (dipakai builder / halaman) |
| lib | `lib/v4/kas.ts` | v4 | 3 | tetap (dipakai builder / halaman) |
| lib | `lib/v4/komersial.ts` | v4 | 1 | hapus bersama cabang v4 halaman (R174, K99) bila v5 hidup untuk semua role |
| lib | `lib/v4/minggu-ini-data.ts` | v4 | 1 | tetap (dipakai builder / halaman) |
| lib | `lib/v4/minggu-ini.ts` | v4 | 16 | tetap (dipakai builder / halaman) |
| lib | `lib/v4/month.ts` | v4 | 2 | tetap (builder bulan; halaman Outlook bulan v4) |
| lib | `lib/v4/nav.ts` | v4 | 15 | tetap (dipakai builder / halaman) |
| lib | `lib/v4/outlook-bulan-data.ts` | v4 | 1 | tetap (dipakai builder / halaman) |
| lib | `lib/v4/outlook-bulan.ts` | v4 | 6 | tetap (dipakai builder / halaman) |
| lib | `lib/v4/release-override.ts` | v4 | 3 | tetap (dipakai builder / halaman) |
| lib | `lib/v4/rencana.ts` | v4 | 1 | hapus bersama cabang v4 halaman (R174, K99) bila v5 hidup untuk semua role |
| lib | `lib/v4/tile-errors.ts` | v4 | 10 | tetap (dipakai builder / halaman) |
| lib | `lib/v4/uploads-month.ts` | v4 | 1 (side-effect import di `lib/rebuild.ts`) | tetap (builder) |
| lib | `lib/v4/uploads-ppic.ts` | v4 | 1 (side-effect import di `lib/rebuild.ts`) | tetap (builder) |
| lib | `lib/v4/week-pl.ts` | v4 | 1 | tetap (dipakai builder / halaman) |
| lib | `lib/v5/assignment-data.ts` | v5 | 2 | tetap |
| lib | `lib/v5/assignment.ts` | v5 | 5 | tetap |
| lib | `lib/v5/commitment-form.ts` | v5 | 1 | tetap |
| lib | `lib/v5/copy-plan.ts` | v5 | 3 | tetap |
| lib | `lib/v5/cost-status.ts` | v5 | 2 | tetap |
| lib | `lib/v5/costing-pl.ts` | v5 | 3 | tetap |
| lib | `lib/v5/costing.ts` | v5 | 13 | tetap |
| lib | `lib/v5/forecast-cost-core.ts` | v5 | 2 | tetap |
| lib | `lib/v5/forecast-cost.ts` | v5 | 1 | tetap |
| lib | `lib/v5/free-stock-data.ts` | v5 | 2 | tetap |
| lib | `lib/v5/free-stock.ts` | v5 | 3 | tetap |
| lib | `lib/v5/fs-recon-data.ts` | v5 | 2 | tetap |
| lib | `lib/v5/fs-recon.ts` | v5 | 6 | tetap |
| lib | `lib/v5/input-check.ts` | v5 | 2 | tetap |
| lib | `lib/v5/input-data.ts` | v5 | 4 | tetap |
| lib | `lib/v5/input-save.ts` | v5 | 1 | tetap |
| lib | `lib/v5/input.ts` | v5 | 6 | tetap |
| lib | `lib/v5/k25.ts` | v5 | 5 | tetap |
| lib | `lib/v5/komersial-data.ts` | v5 | 1 | tetap |
| lib | `lib/v5/komersial.ts` | v5 | 4 | tetap |
| lib | `lib/v5/lb-decision.ts` | v5 | 2 | tetap |
| lib | `lib/v5/management-data.ts` | v5 | 3 | tetap |
| lib | `lib/v5/management.ts` | v5 | 4 | tetap |
| lib | `lib/v5/pl-tiles.ts` | v5 | 5 | tetap |
| lib | `lib/v5/pl.ts` | v5 | 4 | tetap |
| lib | `lib/v5/po-lines.ts` | v5 | 1 | tetap |
| lib | `lib/v5/ppic-data.ts` | v5 | 5 | tetap |
| lib | `lib/v5/ppic.ts` | v5 | 3 | tetap |
| lib | `lib/v5/surplus-view.ts` | v5 | 3 | tetap |
| lib | `lib/v5/surplus.ts` | v5 | 2 | tetap |
| lib | `lib/v5/task-queue.ts` | v5 | 2 | tetap |
| lib | `lib/v5/upload-grid.ts` | v5 | 1 | tetap |
| lib | `lib/v5/upload-samples.ts` | v5 | 1 | tetap |
| lib | `lib/v5/view-as.ts` | v5 | 2 | tetap |

Ringkasan: component ganti v6 (Card6, Drawer, Shell6): 3; component tetap: 28; component tetap sampai padanan v6 dipakai semua role: 22; lib hapus bersama cabang v4 halaman (R174, K99): 3; lib tetap: 34; lib tetap (dipakai builder / halaman): 28; page ganti v6 (K101: tulis ulang ke Table6/Tile): 25; page tetap: 11; page tetap (v6 di belakang v6_shell/v6_pages): 23

## Cabang v4 halaman yang punya v5 (R174)

`app/w/[week]/rencana/v4.tsx`, `app/komersial/v4.tsx`, `app/m/[month]/v4.tsx`, `app/m/[month]/biaya/v4.tsx`,
`app/m/[month]/tutup-buku/v4.tsx`, `app/hari/[date]/alokasi/v4.tsx`: dihapus bila flag v5 pasangannya hidup untuk semua role
(Q-v6-2). Catatan: `m/[month]/v4.tsx` adalah Outlook bulan v4 yang juga dipakai saat `v5_pl` hidup (pl-tiles menambahkan tile v5
ke model v4), jadi bukan cabang mati; ditinjau satu per satu sebelum dihapus.

## Stylesheet (R177, K100, M6)

`app/globals.css` (v1) dan `app/v4.css` dimuat di semua halaman; `app/v6.css` (irisan 4) di-scope `.v6`. Penggabungan menjadi
satu `v6.css` tanpa scope + penghapusan `globals.css` menunggu halaman v1 (25 baris "ganti v6" di atas) ditulis ulang. Sekarang
`grep -rE 'className="card\b|table className="t\b|\.topbar'` di `app/` dan `components/` masih > 0 (M6 belum tercapai).
