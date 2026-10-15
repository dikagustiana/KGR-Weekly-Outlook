#!/usr/bin/env tsx
/**
 * Writes fixtures/month-2026-08/golden-v4.json: the August 2026 outlook as the v4 engine computes it with K3 (run-rate
 * 7 calendar days), K5 (GP P&L, margin of the month to date for run-rate days) and K11 (journal + DO unbilled) on the
 * example week. PRD v4 K4: the engine computes it, the product owner reviews it, then it is locked; until then
 * "status" stays "diusulkan" and the test compares against these numbers so that a change is deliberate.
 *   pnpm --filter @kgr/engine exec tsx scripts/month-golden.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/fixtures";
import { augustPlan } from "../test/month-v4-fixture";

const jt = (v: { div(n: number): { toFixed(n: number): string } }) => v.div(1e6).toFixed(1);
const { plan, summary } = augustPlan();
const t = (x: Record<"revenue" | "cogs" | "gp" | "opex" | "nibt", { div(n: number): { toFixed(n: number): string } }>) => Object.fromEntries((["revenue", "cogs", "gp", "opex", "nibt"] as const).map((k) => [k, jt(x[k])]));
const golden = {
  status: "diusulkan, menunggu review pemilik produk (K4); dihitung engine, bukan angka mockup",
  rules: "K3 run-rate = rata-rata hari kerja dalam 7 hari kalender terakhir tanpa hari anomali; K5 GP P&L, margin acuan = GP% bulan berjalan; K11 jurnal + DO belum difaktur; biaya run-rate = rata-rata harian actual bulan berjalan (K6)",
  cut_off: "2026-08-26",
  unit: "jt Rp, 1 desimal",
  actual: t(summary.actual),
  forecast: t(summary.forecast),
  outlook: t(summary.outlook),
  range: { revenue: [jt(summary.range.revenueLow), jt(summary.range.revenueHigh)], gp: [jt(summary.range.gpLow), jt(summary.range.gpHigh)] },
  po: { revenue: jt(plan.poRevenue), kg: summary.poKg.toFixed(0) },
  runrate: { revenue_per_day: jt(plan.runrate.revenue), days: plan.runrate.days, anomalies: plan.runrate.anomalies, mean_actual_window: jt(plan.runrate.meanActualWindow), off_day_factor: plan.runrate.offDayFactor.toFixed(6), margin_ref_pct: plan.margin.times(100).toFixed(2) },
  daily_revenue: Object.fromEntries(plan.days.map((d) => [d.date, jt(d.revenue)])),
  share_po: summary.poShare!.toFixed(3),
  by_segment: summary.bySegment.map((s) => ({ segment: s.segment, revenue: jt(s.revenue), gp: jt(s.gp) })),
};
writeFileSync(join(repoRoot(), "fixtures/month-2026-08/golden-v4.json"), JSON.stringify(golden, null, 1) + "\n");
console.log(JSON.stringify(golden, null, 1));
