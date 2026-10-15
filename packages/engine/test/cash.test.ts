/**
 * M6 golden (PRD v3 §8 M6) from FS September 2026: equity 702,6 jt, paid-in capital 5.000 jt, affiliate payables 9.845,9 jt;
 * closing notes DI-01 48,35 · DI-02 48,08 · DI-03 12 · DI-04 62,45 + 69,66 (seeded by the M4 migration). Cash / CCC rules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { loadV3Fixture, repoRoot } from "../src/fixtures";
import { balancesOn, cashControls, cashProjection, cashProjection12m, scheduledPayments, solvency } from "../src/cash";
import { ccc, simulateCcc } from "../src/ccc";
import type { FixedCostRow } from "../src/drivers";

type Line = { row: number; line: string; values: Record<string, string> };
type In = { pl: Line[]; bs: Line[]; closing_notes: { code: string; amount: string; cell: string }[] };
const fs = loadV3Fixture<In>("fs-2026-09", "inputs.json");
const g = loadV3Fixture<Record<string, string | null>>("fs-2026-09", "golden.json");
const SEP = "2026-09-30";
const bs = (line: string) => D(fs.bs.find((l) => l.line === line)!.values[SEP] ?? "0");
const pl = (line: string, m: string) => D(fs.pl.find((l) => l.line === line)!.values[m] ?? "0");
const jt = (v: { div(n: number): { toFixed(n: number): string } }) => v.div(1e6).toFixed(1);

describe("FS golden — solvency September 2026", () => {
  const s = solvency({
    equity: bs("TOTAL EQUITY"), paidInCapital: bs("Shareholder Equity"),
    affiliatePayable: bs("Other Payable - Related Parties").plus(bs("Trade Payables - Affiliates")).plus(bs("Accrued Expenses - Related Parties")),
    affiliateReceivable: bs("Trade Receivables - Related Parties").plus(bs("Other Receivable - Affiliated Party")),
    nibtMonth: pl("INCOME (LOSS) BEFORE TAX", SEP),
  });
  it("equity 702,6 jt of 5.000 jt paid-in; affiliate payables 9.845,9 jt (BS - Management Report L77 / L68 / L51)", () => {
    const row = (line: string) => fs.bs.find((l) => l.line === line)!.row;
    expect(s.equity.toString()).toBe(D(g[`BS - Management Report!L${row("TOTAL EQUITY")}`]!).toString());
    expect(jt(s.equity)).toBe("702.6");
    expect(jt(s.paid_in_capital)).toBe("5000.0");
    expect(jt(s.affiliate_payable)).toBe("9845.9");
    expect(s.equity_to_capital.toFixed(4)).toBe(s.equity.div(s.paid_in_capital).toFixed(4));
  });
  it("months to negative equity at the September NIBT (−910,1 jt): 0,8 months", () => {
    expect(s.months_to_negative_equity!.toFixed(2)).toBe(s.equity.div(pl("INCOME (LOSS) BEFORE TAX", SEP).neg()).toFixed(2));
    expect(s.months_to_negative_equity!.toFixed(1)).toBe("0.8");
    expect(solvency({ equity: "1", paidInCapital: "1", affiliatePayable: "0", affiliateReceivable: "0", nibtMonth: "5" }).months_to_negative_equity).toBeNull();
  });
  it("closing notes DI-01 48,35 · DI-02 48,08 · DI-03 12 · DI-04 62,45 + 69,66 jt; the M4 migration seeds the same amounts", () => {
    const amt = (code: string) => fs.closing_notes.filter((n) => n.code === code).map((n) => D(n.amount).div(1e6).toFixed(2));
    expect(amt("DI-01")).toEqual(["48.35"]);
    expect(amt("DI-02")).toEqual(["48.08"]);
    expect(amt("DI-03")).toEqual(["12.00"]);
    expect(amt("DI-04")).toEqual(["62.45", "69.66"]);
    for (const n of fs.closing_notes) expect(n.amount).toBe(g[n.cell]);
    const sql = readFileSync(join(repoRoot(), "supabase/migrations/20261016001000_m4_monthly.sql"), "utf8");
    for (const n of fs.closing_notes) expect(sql).toContain(`${D(n.amount).toFixed(2)}`);
  });
  it("CCC from the September balance sheet and the 90-day P&L (Jul–Sep)", () => {
    const months = ["2026-07-31", "2026-08-31", SEP];
    const r = ccc({
      inventory: bs("Inventory - Product").plus(bs("Inventory - Trading")), ar: bs("Trade Receivables - Third Parties").plus(bs("Trade Receivables - Related Parties")),
      ap: bs("Trade Payables - Third Parties").plus(bs("Trade Payables - Affiliates")),
      cogs: months.reduce((a, m) => a.plus(pl("Cost of Sales", m)), D(0)), revenue: months.reduce((a, m) => a.plus(pl("Revenue", m)), D(0)), windowDays: 92,
    });
    expect(r.dio.toFixed(1)).toBe("37.5");
    expect(r.dso.toFixed(1)).toBe("4.5");
    expect(r.dpo.toFixed(1)).toBe("0.8");
    expect(r.ccc.toFixed(1)).toBe(r.dio.plus(r.dso).minus(r.dpo).toFixed(1));
    const sim = simulateCcc(r, { termsLbDays: 7, termsTradingDays: 14, shareLb: "0.5", targetStockDays: 20 });
    expect(sim.dpo.toFixed(1)).toBe("10.5");
    expect(sim.ccc.toFixed(1)).toBe(D(20).plus(r.dso).minus("10.5").toFixed(1));
    expect(sim.deltaWorkingCapital.lt(0)).toBe(true);
  });
});

describe("cash rules", () => {
  const balances = [
    { date: "2026-10-12", account_no: "BCA-1", opening: "0", closing: "100000000" },
    { date: "2026-10-13", account_no: "BCA-1", opening: "100000000", closing: "90000000" },
    { date: "2026-10-12", account_no: "MDR-1", opening: "0", closing: "50000000" },
  ];
  it("position: latest closing per account (carried when no row that day)", () => {
    const b = balancesOn(balances, "2026-10-13");
    expect(b.map((x) => [x.account_no, x.closing.toFixed(0), x.carried])).toEqual([["BCA-1", "90000000", false], ["MDR-1", "50000000", true]]);
  });
  it("13 weeks: plans after the start day, lowest closing; cancelled plans ignored; fixed schedule payments not planned yet", () => {
    const sched: FixedCostRow[] = [{ id: "gaji", pl_line: "Salaries and allowance", description: "Gaji", amount_per_month: "80000000", start_date: "2026-01-01", end_date: null, amortize: false, prepaid_total: null, active: true }];
    const plans = [
      { date: "2026-10-14", amount: "-30000000", status: "plan" }, { date: "2026-10-15", amount: "20000000", status: "plan" },
      { date: "2026-10-16", amount: "-999", status: "cancelled" }, { date: "2026-11-25", amount: "-80000000", status: "plan", fixed_cost_schedule_id: "gaji" },
    ];
    const pay = scheduledPayments(sched, plans, { gaji: 25 }, "2026-10-13", "2027-01-10");
    expect(pay.map((p) => [p.date, D(p.amount).toFixed(0)])).toEqual([["2026-10-25", "-80000000"], ["2026-12-25", "-80000000"]]);
    const p = cashProjection({ start: "2026-10-13", balances, plans: [...plans, ...pay] });
    expect(p.startClosing.toFixed(0)).toBe("140000000");
    expect(p.weeks.length).toBe(13);
    expect(p.weeks[0].closing.toFixed(0)).toBe("130000000");
    expect(p.lowest.toFixed(0)).toBe("-110000000");
    expect(p.lowestDate).toBe("2026-12-25");
  });
  it("12 months: outlook NIBT + non-cash D&A held flat", () => {
    const m = cashProjection12m({ month: "2026-10-01", startClosing: "100", nibtOutlook: "-30", depreciation: "-10" });
    expect(m.length).toBe(12);
    expect(m[0].closing.toFixed(0)).toBe("80");
    expect(m[11].closing.toFixed(0)).toBe("-140");
    expect(m[1].month).toBe("2026-11-01");
  });
  it("C35 Σ accounts vs BS cash, C36 working days without upload, C37 payables with a debit balance (D4)", () => {
    const c = cashControls({ date: "2026-10-13", balances, bsCash: "140000000", from: "2026-10-12", isWorkingDay: (d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0, payables: [{ line: "Trade Payables - Third Parties", value: "-420300000" }] });
    expect(c.map((x) => [x.code, x.status])).toEqual([["C35", "LULUS"], ["C36", "LULUS"], ["C37", "PERIKSA"]]);
    const c2 = cashControls({ date: "2026-10-14", balances, bsCash: "141000000", from: "2026-10-12", isWorkingDay: () => true, payables: [] });
    expect(c2.map((x) => x.status)).toEqual(["GAGAL", "BELUM DIISI", "LULUS"]);
    expect(c2[1].detail).toEqual(["2026-10-14"]);
  });
});

describe("PRD v4 §3.7: operations and affiliate funding apart (G6)", async () => {
  const { cashProjectionSplit, cashProjection12mOrNull, AFFILIATE_CATEGORY } = await import("../src/cash");
  const bal = [{ date: "2026-08-26", account_no: "BCA", opening: null, closing: "1289251345.68" }];
  const plans = [
    { date: "2026-08-27", amount: "59620700", cf_category: "Penerimaan dari pelanggan", description: "Penerimaan" },
    { date: "2026-08-28", amount: "-1229000000", cf_category: "Bayar jasa", description: "Bayar jasa maklon dan cold storage" },
    { date: "2026-08-28", amount: "-30200000", cf_category: "Bayar pemasok", description: "Pemasok trading" },
    { date: "2026-08-28", amount: "200000000", cf_category: AFFILIATE_CATEGORY, description: "Pinjaman afiliasi tambahan" },
    { date: "2026-08-29", amount: "528526120", cf_category: "Penerimaan dari pelanggan", description: "Penerimaan" },
  ];
  const sp = cashProjectionSplit({ start: "2026-08-26", balances: bal, plans, weeks: 2, affiliateReceived: "1200000000" });
  const jt1 = (v: { div(n: number): { toFixed(n: number): string } }) => v.div(1e6).toFixed(1);
  it("lowest with the facility: Fri 28 Aug 289,7 jt; without it (planned 200 and received 1.200 taken out): −1.110,3 jt", () => {
    expect([sp.lowest.date, jt1(sp.lowest.balance)]).toEqual(["2026-08-28", "289.7"]);
    expect([sp.lowestWithout.date, jt1(sp.lowestWithout.balance)]).toEqual(["2026-08-28", "-1110.3"]);
  });
  it("affiliate funding is its own column in the weeks; operations keep in and out", () => {
    const w = sp.weeks[0];
    expect(jt1(w.affiliateNet)).toBe("200.0");
    expect(jt1(w.operatingOut)).toBe("-1259.2");
    expect(jt1(w.operatingIn)).toBe("588.1");
  });
  it("what drives the deficit on the lowest day: the biggest outflows first, affiliate flows excluded", () => {
    expect(sp.drivers.map((d) => jt1(d.amount))).toEqual(["-1229.0", "-30.2"]);
    expect(sp.assumption).toContain("1200.0");
  });
  it("no plans = no drivers and without = with minus what was received; 12 months without an outlook = null, not zeros", () => {
    const e = cashProjectionSplit({ start: "2026-08-26", balances: bal, plans: [], weeks: 1 });
    expect(e.lowestWithout.balance.toFixed(2)).toBe(e.lowest.balance.toFixed(2));
    expect(e.drivers).toEqual([]);
    expect(cashProjection12mOrNull({ month: "2026-09-01", startClosing: "100", nibtOutlook: null, depreciation: null })).toBeNull();
    expect(cashProjection12mOrNull({ month: "2026-09-01", startClosing: "100", nibtOutlook: "-50", depreciation: "10" })![0].closing.toFixed(0)).toBe("60");
  });
});
