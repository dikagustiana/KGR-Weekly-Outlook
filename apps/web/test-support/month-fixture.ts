/**
 * Inputs of the pages "Outlook bulan" (§6.2) and "Kas & solvabilitas" (§6.3) built from the golden fixtures, without
 * Supabase. Node only: used by the fixture harness (scripts/v4-fixture.tsx) and the page-model tests.
 *
 * Outlook bulan: August 2026 at cut-off 26 Aug (fixtures/month-2026-08 through the v4 engine, exactly what the month
 * rebuild writes into pl_daily_v4), register as the engine proposes it, no budget, no locked version; accuracy of the
 * V1 7.712,4 / 293,4 against FINAL from fixtures/accuracy-2026-08; solvency of August from fixtures/fs-2026-09.
 * Kas: 30 Sep 2026 from the FS only (no template kas harian: no projection), and 26 Aug with the example week's cash
 * plans (the projection the cash rebuild would write, through the same engine functions and kasHorizon).
 */
import { D, accuracyV4, cashControls, cashProjection12mOrNull, cashProjectionSplit, balancesOn, ccc, solvency, type Decimal } from "@kgr/engine";
import { loadFixtureWeek, loadV3Fixture } from "../../../packages/engine/src/fixtures";
import { augustPlan } from "../../../packages/engine/test/month-v4-fixture";
import type { OutlookBulanInput } from "../lib/v4/outlook-bulan";
import { kasHorizon, type KasInput } from "../lib/v4/kas";

type Line = { row: number; line: string; values: Record<string, string> };
const fs = loadV3Fixture<{ pl: Line[]; bs: Line[] }>("fs-2026-09", "inputs.json");
const AUG = "2026-08-31", SEP = "2026-09-30";
const bs = (l: string, d: string) => D(fs.bs.find((x) => x.line === l)!.values[d] ?? "0");
const pl = (l: string, d: string) => D(fs.pl.find((x) => x.line === l)?.values[d] ?? "0");

function solvencyOf(d: string) {
  return solvency({
    equity: bs("TOTAL EQUITY", d), paidInCapital: bs("Shareholder Equity", d),
    affiliatePayable: bs("Other Payable - Related Parties", d).plus(bs("Trade Payables - Affiliates", d)).plus(bs("Accrued Expenses - Related Parties", d)),
    affiliateReceivable: bs("Trade Receivables - Related Parties", d).plus(bs("Other Receivable - Affiliated Party", d)),
    nibtMonth: pl("INCOME (LOSS) BEFORE TAX", d),
  });
}

export function outlookBulanFixture(): OutlookBulanInput {
  const a = augustPlan();
  const acc = loadV3Fixture<{ final: Record<"revenue" | "gp" | "nibt", string>; v1: { revenue_jt: string; gp_jt: string }; adjustments: Record<"revenue" | "gp" | "nibt", string> }>("accuracy-2026-08", "inputs.json");
  const lines = accuracyV4({
    final: acc.final, adjustments: acc.adjustments,
    versions: [{ version: "V1", revenue: D(acc.v1.revenue_jt).times(1e6).toFixed(2), gp: D(acc.v1.gp_jt).times(1e6).toFixed(2), nibt: "0" }],
  }).filter((l) => l.metric !== "nibt"); // the V1 of the PRD example carries no NIBT
  const sv = solvencyOf(AUG);
  return {
    first: "2026-08-01", today: "2026-08-27", cutOff: "2026-08-26", tolerance: "0.10", windowDays: 7, rows: a.plan.rows, base: "/m/2026-08",
    months: [{ first: "2026-08-01", href: "/m/2026-08" }, { first: "2026-09-01", href: "/m/2026-09" }],
    budget: [], register: a.register, versions: [], selected: null,
    accuracy: { month: "2026-08-01", version: "V1", lines, poDays: null, runrateDays: null },
    solvency: { label: "Agustus 2026", equity: sv.equity.toFixed(2), paidIn: sv.paid_in_capital.toFixed(2), affiliate: sv.affiliate_payable.toFixed(2), months: sv.months_to_negative_equity === null ? null : sv.months_to_negative_equity.toFixed(2), cash: bs("Cash and cash equivalents", AUG).toFixed(2) },
    on: { m6: true }, pdfHref: "/api/m/2026-08/pdf",
  };
}

const sim = { lb: "7", tr: "14", share: "0.5", stock: "" };

/** 30 Sep 2026: the FS is all there is (no bank template uploaded yet), as the mockup kas-solvabilitas.html. */
export function kasFixtureFs(): KasInput {
  const sv = solvencyOf(SEP), prev = solvencyOf(AUG);
  const cash = bs("Cash and cash equivalents", SEP);
  // CCC on the September balance sheet and the September P&L (30 days; production uses the journal of up to 90 days)
  const c = ccc({
    inventory: bs("Inventory - Product", SEP).plus(bs("Inventory - Trading", SEP)), ar: bs("Trade Receivables - Third Parties", SEP).plus(bs("Trade Receivables - Related Parties", SEP)),
    ap: bs("Trade Payables - Third Parties", SEP).plus(bs("Trade Payables - Affiliates", SEP)), cogs: pl("Cost of Sales", SEP), revenue: pl("Revenue", SEP), windowDays: 30,
  });
  return {
    today: "2026-10-01", base: "/kas", sim,
    row: { date: SEP, totalClosing: cash.toFixed(2), lowest: null, lowestDate: null, lowestWithout: null, lowestWithoutDate: null, assumption: null, horizon: null },
    solvency: {
      label: "September 2026", month: "2026-09-01", equity: sv.equity.toFixed(2), paidIn: sv.paid_in_capital.toFixed(2), affiliate: sv.affiliate_payable.toFixed(2),
      months: sv.months_to_negative_equity === null ? null : sv.months_to_negative_equity.toFixed(2), prevAffiliate: prev.affiliate_payable.toFixed(2),
      interestRows: [{ actual: pl("Interest Expense", SEP).toFixed(2), forecast: null }],
    },
    ccc: { date: SEP, dio: c.dio.toFixed(2), dso: c.dso.toFixed(2), dpo: c.dpo.toFixed(2), ccc: c.ccc.toFixed(2), workingCapital: c.workingCapital.toFixed(2), cogsPerDay: c.cogsPerDay.toFixed(2), revenuePerDay: c.revenuePerDay.toFixed(2), windowDays: 30 },
  };
}

/**
 * 26 Aug 2026 with the example week's cash plans (fixture rows from 27 Aug, as the template kas harian would carry them)
 * and the closing of 26 Aug; the affiliate loan already received this week is the weekly cash flow's actual 1.200 jt.
 */
export function kasFixtureProjection(): KasInput {
  const date = "2026-08-26";
  const week = loadFixtureWeek("2026-08-24", "2026-08-27");
  const balances = [{ date, account_no: "BCA 8577", opening: null, closing: "1289251345.68" }];
  const plans = (week.cash_plan as { date: string; cf_category: string | null; description: string | null; amount: string }[])
    .filter((p) => p.date > date).map((p) => ({ date: p.date, amount: p.amount, cf_category: p.cf_category, description: p.description, status: "plan" }));
  const split = cashProjectionSplit({ start: date, balances, plans, affiliateReceived: "1200000000" });
  const controls = cashControls({ date: "2026-08-25", balances, bsCash: null, from: "2026-08-24", isWorkingDay: (d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0, payables: [] });
  const months = cashProjection12mOrNull({ month: "2026-08-01", startClosing: "1289251345.68", nibtOutlook: "75300000", depreciation: "10393461" });
  const position = balancesOn(balances, date) as { account_no: string; closing: Decimal; date: string; carried: boolean }[];
  const horizon = kasHorizon({ date, position, banks: { "BCA 8577": "BCA" }, controls, split, months, affiliateReceived: D("1200000000") });
  const sv = solvencyOf(AUG);
  return {
    today: "2026-08-27", base: "/kas", sim,
    row: {
      date, totalClosing: "1289251345.68", lowest: split.lowest.balance.toFixed(2), lowestDate: split.lowest.date,
      lowestWithout: split.lowestWithout.balance.toFixed(2), lowestWithoutDate: split.lowestWithout.date, assumption: split.assumption, horizon,
    },
    solvency: {
      label: "Agustus 2026", month: "2026-08-01", equity: sv.equity.toFixed(2), paidIn: sv.paid_in_capital.toFixed(2), affiliate: sv.affiliate_payable.toFixed(2),
      months: sv.months_to_negative_equity === null ? null : sv.months_to_negative_equity.toFixed(2), prevAffiliate: null,
      interestRows: [{ actual: pl("Interest Expense", AUG).toFixed(2), forecast: null }],
    },
    ccc: null,
  };
}
