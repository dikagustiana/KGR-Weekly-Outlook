/**
 * PRD v5.2-A R66 (K63, O24 b): the two v5 costing rows ("Selisih costing", "Biaya kapasitas idle") in mode 'cogs' (the v5
 * behaviour, golden B.2 unchanged) and 'memo' (journal columns = journal lines only; a memo block below the journal NIBT).
 */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { costingPlRows } from "../src/costing";
import { isCogsLine, isMemoLine, isOpexLine } from "../src/monthly";
import { PL_MEMO_ROWS, PL_TABLE_ROWS, cumulativeSeries, fixedEstimateRows, fixedNominals, plTable, plTotalsV5 } from "../src/pl-v5";
import { c49, monthSummaryV4, totalsV4, versionDaysV4 } from "../src/month-v4";
import { finalTotalsV4 } from "../src/close-v4";
import { gpBridge, weekOutlook } from "../src/week-outlook";
import { augustPlan, inp } from "./month-v4-fixture";
import { JULY, SCHEDULE } from "./pl-v5-inputs";

const a = augustPlan();
const nominals = fixedNominals({ month: inp.month, schedule: SCHEDULE, lastFinal: JULY });
const fixed = fixedEstimateRows({ month: inp.month, cutOff: inp.cut_off, nominals, rows: a.plan.rows });
const v5 = costingPlRows({
  cutOff: inp.cut_off, from: "2026-08-01", to: "2026-08-31",
  selisih: [{ date: "2026-08-20", amount: "-5000000" }], idle: [{ date: "2026-08-20", amount: "-1000000" }, { date: "2026-08-29", amount: "-3000000" }],
});
const base = [...a.plan.rows, ...fixed];
const rows = [...base, ...v5];
const jt = (v: { div(n: number): { toFixed(n: number): string } }) => v.div(1e6).toFixed(1);

describe("R66: the classification of the two v5 rows by mode", () => {
  it("cogs (default): cost of sales; memo: neither COGS nor opex", () => {
    for (const l of ["Selisih costing", "Biaya kapasitas idle"]) {
      expect([isCogsLine(l), isMemoLine(l), isOpexLine(l)]).toEqual([true, false, false]);
      expect([isCogsLine(l, "cogs"), isMemoLine(l, "cogs"), isOpexLine(l, "cogs")]).toEqual([true, false, false]);
      expect([isCogsLine(l, "memo"), isMemoLine(l, "memo"), isOpexLine(l, "memo")]).toEqual([false, true, false]);
    }
    // every other line is the same in both modes
    for (const l of ["COGS - Live Bird", "Other COGS - Expedition"]) expect([isCogsLine(l, "memo"), isMemoLine(l, "memo"), isOpexLine(l, "memo")]).toEqual([true, false, false]);
    expect([isCogsLine("Salaries and allowance", "memo"), isOpexLine("Salaries and allowance", "memo")]).toEqual([false, true]);
    expect([isCogsLine("Revenue - Trading", "memo"), isOpexLine("Revenue - Trading", "memo")]).toEqual([false, false]);
  });
});

describe("R66: totals in both modes", () => {
  it("mode cogs is the v5 behaviour: the rows are inside COGS and the journal NIBT; no memo", () => {
    const j = plTotalsV5(a.plan.rows), c = plTotalsV5(rows);
    expect(c.cogs.toFixed(2)).toBe(j.cogs.minus(9e6).toFixed(2));
    expect(c.nibt.toFixed(2)).toBe(j.nibt.minus(9e6).toFixed(2));
    expect([c.memoSelisih.toFixed(0), c.memoIdle.toFixed(0)]).toEqual(["0", "0"]);
    expect(c.nibtMgmt.toFixed(2)).toBe(c.nibt.toFixed(2));
    // the explicit default is the same call
    expect(plTotalsV5(rows, undefined, "cogs")).toEqual(c);
  });
  it("mode memo: COGS, GP and the journal NIBT are the journal lines only; the memo rows apart; NIBT manajemen = the cogs-mode NIBT", () => {
    const j = plTotalsV5(a.plan.rows), m = plTotalsV5(rows, undefined, "memo"), c = plTotalsV5(rows, undefined, "cogs");
    expect(m.cogs.toFixed(2)).toBe(j.cogs.toFixed(2));
    expect(m.gp.toFixed(2)).toBe(j.gp.toFixed(2));
    expect(m.opex.toFixed(2)).toBe(j.opex.toFixed(2));
    expect(m.nibt.toFixed(2)).toBe(j.nibt.toFixed(2));
    expect([jt(m.memoSelisih), jt(m.memoIdle)]).toEqual(["-5.0", "-4.0"]);
    expect(m.nibtMgmt.toFixed(2)).toBe(c.nibt.toFixed(2));
    // the fixed-cost estimate is unaffected and the NIBT after it is on the journal basis
    expect(m.fixed.toFixed(2)).toBe(c.fixed.toFixed(2));
    expect(m.nibtAfter.toFixed(2)).toBe(m.nibt.plus(m.fixed).toFixed(2));
  });
  it("v4 totals: totalsV4 / monthSummaryV4 / versionDaysV4 / finalTotalsV4 follow the mode, default cogs", () => {
    const j = totalsV4(a.plan.rows, "actual");
    expect(totalsV4(rows, "actual").cogs.toFixed(2)).toBe(j.cogs.minus(6e6).toFixed(2)); // 5 + 1 before the cut-off
    expect(totalsV4(rows, "actual", undefined, "memo").cogs.toFixed(2)).toBe(j.cogs.toFixed(2));
    expect(totalsV4(rows, "actual", undefined, "memo").nibt.toFixed(2)).toBe(j.nibt.toFixed(2));
    const sm = monthSummaryV4(rows, inp.month, "0.10"), smm = monthSummaryV4(rows, inp.month, "0.10", undefined, "memo");
    expect(smm.outlook.gp.toFixed(2)).toBe(a.summary.outlook.gp.toFixed(2));
    expect(sm.outlook.gp.toFixed(2)).toBe(a.summary.outlook.gp.minus(9e6).toFixed(2));
    const d20 = (m?: "memo") => versionDaysV4(rows, inp.month, inp.cut_off, m).find((d) => d.date === "2026-08-20")!;
    expect(D(d20().cogs).minus(D(d20("memo").cogs)).toFixed(0)).toBe("-6000000");
    expect(d20("memo").opex).toBe(d20().opex);
    const f = finalTotalsV4({ rows, adjustments: [] }), fm = finalTotalsV4({ rows, adjustments: [], mode: "memo" });
    expect(fm.after.nibt.toFixed(2)).toBe(f.after.nibt.plus(6e6).toFixed(2));
  });
  it("C49 compares the journal basis whatever the mode: the v5 rows (basis event / fixed) are never in it", () => {
    const pnl = { revenue: totalsV4(a.plan.rows, "actual", (b) => b === "journal").revenue, cogs: totalsV4(a.plan.rows, "actual", (b) => b === "journal").cogs, gp: totalsV4(a.plan.rows, "actual", (b) => b === "journal").gp };
    expect(c49({ rows: a.plan.rows, pnlMtd: pnl }).status).toBe("LULUS");
    expect(c49({ rows, pnlMtd: pnl }).status).toBe("LULUS");
    expect(c49({ rows, pnlMtd: pnl }).difference!.toFixed(2)).toBe(c49({ rows: a.plan.rows, pnlMtd: pnl }).difference!.toFixed(2));
  });
  it("the weekly view and the GP bridge follow the mode; the bridge still closes", () => {
    const week = { weekStart: "2026-08-24", today: "2026-08-27" };
    const wRows = [...a.plan.rows, ...costingPlRows({ cutOff: "2026-08-26", from: "2026-08-24", to: "2026-08-30", selisih: [{ date: "2026-08-25", amount: "-2000000" }], idle: [{ date: "2026-08-28", amount: "-1000000" }] })];
    const c = weekOutlook(wRows, week), m = weekOutlook(wRows, week, null, "memo"), j = weekOutlook(a.plan.rows, week);
    expect(m.projection.gp.toFixed(2)).toBe(j.projection.gp.toFixed(2));
    expect(c.projection.gp.toFixed(2)).toBe(j.projection.gp.minus(3e6).toFixed(2));
    // the bridge explains GP P&L from GP produk: the same residual in both modes (the v5 rows are in "lain-lain" or in neither)
    const gb = (mode?: "memo") => gpBridge({ revenueProduk: "100000000", gpProduk: "10000000", rows: wRows, week, mode });
    expect(gb().reconciled).toBe(gb("memo").reconciled);
    expect(gb().residual.toFixed(2)).toBe(gb("memo").residual.toFixed(2));
  });
});

describe("R66: plTable adds the memo block below the journal NIBT only in mode memo", () => {
  const opts = { rows, cutOff: inp.cut_off, nominals };
  it("cogs mode: the rows of v5 — identical to the call without a mode, no memo rows", () => {
    for (const view of ["rr", "wk"] as const) {
      const t = plTable(view, inp.month, opts), c = plTable(view, inp.month, { ...opts, mode: "cogs" });
      expect(c).toEqual(t);
      expect(t.rows.map((r) => r.key)).toEqual(PL_TABLE_ROWS.map((r) => r.key));
    }
  });
  it("memo mode: selisih, idle and NIBT manajemen right after NIBT menurut jurnal; the journal rows without them", () => {
    const t = plTable("rr", inp.month, { ...opts, mode: "memo" });
    const keys = t.rows.map((r) => r.key);
    expect(keys).toEqual(["revenue", "cogs", "gp", "gp_pct", "opex", "nibt", ...PL_MEMO_ROWS.map((r) => r.key), "fixed", "nibt_after", "nibt_pct"]);
    const col = t.columns.findIndex((c) => c.kind === "total");
    const v = (k: string) => t.rows.find((r) => r.key === k)!.values[col]!;
    const j = plTotalsV5(a.plan.rows);
    expect(v("cogs").toFixed(2)).toBe(j.cogs.toFixed(2));
    expect(v("nibt").toFixed(2)).toBe(j.nibt.toFixed(2));
    expect([jt(v("memo_selisih")), jt(v("memo_idle")), jt(v("nibt_mgmt"))]).toEqual(["-5.0", "-4.0", jt(j.nibt.minus(9e6))]);
    // the cogs-mode table has the same NIBT in its journal row as NIBT manajemen here
    const c = plTable("rr", inp.month, { ...opts, mode: "cogs" });
    expect(c.rows.find((r) => r.key === "nibt")!.values[col]!.toFixed(2)).toBe(v("nibt_mgmt").toFixed(2));
    // the budget column has no memo values, the share column does
    const bud = t.columns.findIndex((x) => x.kind === "budget"), sh = t.columns.findIndex((x) => x.kind === "share");
    expect(t.rows.find((r) => r.key === "memo_selisih")!.values[bud]).toBeNull();
    expect(t.rows.find((r) => r.key === "memo_selisih")!.values[sh]).not.toBeNull();
  });
  it("memo mode, per week: the weeks add up to the month on every row, memo rows included", () => {
    const t = plTable("wk", inp.month, { ...opts, mode: "memo" });
    const month = t.columns.findIndex((c) => c.kind === "total");
    for (const key of ["cogs", "nibt", "memo_selisih", "memo_idle", "nibt_mgmt"] as const) {
      const r = t.rows.find((x) => x.key === key)!;
      const sum = r.values.filter((_, i) => i !== month).reduce((acc: ReturnType<typeof D>, x) => acc.plus(x!), D(0));
      expect(sum.minus(r.values[month]!).abs().lte("0.01"), key).toBe(true);
    }
  });
  it("solvencyNibtV5 is the management basis in both modes (the setting does not move the solvency)", async () => {
    const { solvencyNibtV5 } = await import("../src/pl-v5");
    expect(solvencyNibtV5(rows, false)!.toFixed(2)).toBe(plTotalsV5(rows, undefined, "cogs").nibtAfter.toFixed(2));
    // memo-mode NIBT after fixed costs is journal-basis; the memo rows (−5,0 and −4,0 jt) bring it to the management basis
    expect(solvencyNibtV5(rows, false)!.toFixed(2)).toBe(plTotalsV5(rows, undefined, "memo").nibtAfter.plus(D(-9e6)).toFixed(2));
    expect(solvencyNibtV5(rows, true)).toBeNull();
  });
});

describe("R64 (K51): the cumulative NIBT after fixed costs draws no point when every fixed nominal is missing", () => {
  it("fixedMissing → no series values (not the journal NIBT); the other measures are unaffected", () => {
    const s = cumulativeSeries("nibt_after", inp.month, a.plan.rows, inp.cut_off, "0.10", { fixedMissing: true });
    expect(s.unknown).toBe(true);
    expect([...s.actual, ...s.outlook, ...s.low, ...s.high].every((v) => v === null)).toBe(true);
    expect(s.mtd).toBeNull();
    const ok = cumulativeSeries("nibt_after", inp.month, base, inp.cut_off, "0.10", { fixedMissing: false });
    expect(ok.unknown).toBeUndefined();
    expect(ok.actual.some((v) => v !== null)).toBe(true);
    const j = cumulativeSeries("nibt", inp.month, a.plan.rows, inp.cut_off, "0.10", { fixedMissing: true });
    expect(j.unknown).toBeUndefined();
    expect(j.actual.some((v) => v !== null)).toBe(true);
  });
  it("the memo mode moves the journal measures of the series", () => {
    const c = cumulativeSeries("nibt", inp.month, rows, inp.cut_off, "0.10"), m = cumulativeSeries("nibt", inp.month, rows, inp.cut_off, "0.10", { mode: "memo" });
    expect(c.total.minus(m.total).toFixed(0)).toBe("-9000000");
  });
});
