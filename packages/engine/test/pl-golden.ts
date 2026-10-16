/**
 * Golden of PRD v5 §9.2 `pl-2026-08` (Lampiran B.2): the P&L table of August in both views (actual vs run-rate, per
 * week) and the cumulative series of the five measures, from fixtures/month-2026-08 with the seeded fixed-cost
 * schedule and July FINAL. Written by scripts/pl-golden.ts, compared by tests/pl-v5.test.ts. Node only.
 */
import type { Decimal } from "../src/decimal";
import { cumulativeSeries, fixedEstimateRows, fixedNominals, plTable, type CumulativeMetric } from "../src/pl-v5";
import { augustPlan, inp } from "./month-v4-fixture";
import { JULY, SCHEDULE } from "./pl-v5-inputs";

const m2 = (v: Decimal | null) => (v === null ? null : v.toFixed(2));
const p6 = (v: Decimal | null) => (v === null ? null : v.toFixed(6));

export function plGolden() {
  const a = augustPlan();
  const nominals = fixedNominals({ month: inp.month, schedule: SCHEDULE, lastFinal: JULY });
  const rows = [...a.plan.rows, ...fixedEstimateRows({ month: inp.month, cutOff: inp.cut_off, nominals, rows: a.plan.rows })];
  const table = (v: "rr" | "wk") => {
    const t = plTable(v, inp.month, { rows, cutOff: inp.cut_off });
    return {
      columns: t.columns.map((c) => ({ id: c.id, from: c.from, to: c.to, kind: c.kind, forecastBasis: c.forecastBasis })),
      rows: t.rows.map((r) => ({ key: r.key, label: r.label, pct: r.pct, values: r.values.map(r.pct ? p6 : m2) })),
    };
  };
  const metrics: CumulativeMetric[] = ["revenue", "cogs", "gp", "nibt", "nibt_after"];
  return {
    source: "fixtures/month-2026-08 (plan rows) + template 8.3 seed + July FINAL (fs-2026-09); engine plTable / cumulativeSeries",
    month: inp.month, cut_off: inp.cut_off,
    fixed_nominals: nominals.map((n) => ({ pl_line: n.pl_line, source: n.source, nominal: m2(n.nominal) })),
    rr: table("rr"), wk: table("wk"),
    cumulative: Object.fromEntries(metrics.map((m) => {
      const c = cumulativeSeries(m, inp.month, rows, inp.cut_off, "0.10");
      return [m, { total: m2(c.total), mtd: m2(c.mtd), band: [m2(c.bandLow), m2(c.bandHigh)], cut_index: c.cutIndex, daily: c.daily.map(m2) }];
    })),
  };
}
