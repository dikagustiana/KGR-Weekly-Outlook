import "server-only";
/**
 * M6 cash, CCC, solvency (PRD v3 §4.7). Loads bank balances (template kas harian), cash plans, the fixed-cost schedule,
 * the last weekly balance sheet (v1 statements) and the journal, runs @kgr/engine (cashProjection, cashProjection12m,
 * ccc, solvency, cashControls) and writes the data marts cash_position_daily / ccc_daily / solvency_monthly.
 */
import {
  D, actualDaily, addDays, balancesOn, diffDays, cashControls, cashProjection, cashProjection12m, cashProjection12mOrNull, cashProjectionSplit, ccc, dailyTotals, firstOfMonth, monthSummary,
  fixedAllMissing, monthEnd, monthSummaryV4, plRowsFromMart, scheduledPayments, solvency, solvencyNibtV5, sum, toFixedString,
  type CashBalance, type CashPlan, type CashSplit, type CccResult, type ControlV3, type Decimal, type FixedCostRow, type Solvency, type WeekResult,
} from "@kgr/engine";
import { parseV3Table } from "@kgr/parsers";
import type { Supa } from "../supabase";
import { computeForWeek, fetchAll, listWeeks, type WeekRow } from "../data";
import { WriteError } from "../write";
import { martReplace, registerBuilder } from "../rebuild-registry";
import { plan0, registerV3Kind, type Row } from "./uploads";
import { plDaily, isWorkingDay } from "./monthly";
import { kasHorizon } from "../v4/kas";
import { must } from "../loader";
import type { FixedSource } from "../v5/pl-tiles";

/** v5_pl on (global flag): the solvency takes NIBT after fixed costs (K52). */
async function v5PlOn(sb: Supa): Promise<boolean> {
  const data = must(await sb.from("app_setting").select("value").eq("key", "v5_pl").maybeSingle(), "app_setting v5_pl") as Row | null;
  return (data?.value as { enabled?: boolean } | undefined)?.enabled === true;
}

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const f2 = (x: Decimal | null | undefined) => (x === null || x === undefined ? null : toFixedString(x, 2));

export interface CashState {
  date: string;
  week: WeekRow | null;
  accounts: Row[];
  balances: CashBalance[];
  plans: (CashPlan & { id?: string })[];
  scheduled: CashPlan[];
  position: ReturnType<typeof balancesOn>;
  projection: ReturnType<typeof cashProjection>;
  /** PRD v4 §3.7: operations and affiliate funding apart, and the scenario without the facility. */
  split: CashSplit;
  /** Affiliate funding already received that the scenario takes out: the weekly cash flow's "Pinjaman afiliasi (net)" actual (an assumption, stated on the page). */
  affiliateReceived: Decimal;
  months: ReturnType<typeof cashProjection12m>;
  /** 12 months on the NIBT outlook of pl_daily_v4; null without that basis ("tidak tersedia", PRD v4 §6.3). */
  monthsV4: ReturnType<typeof cashProjection12m> | null;
  ccc: CccResult | null;
  cccWindowDays: number;
  solvency: Solvency | null;
  controls: ControlV3[];
  bsCash: string | null;
}

const bsLine = (r: WeekResult, line: string, col: "yesterday" | "projection") => r.statements.bs.get(line).values[col];

export async function loadCash(sb: Supa, date: string, opts: { m4: boolean }): Promise<CashState> {
  const weeks = (await listWeeks(sb)).slice().sort((a, b) => a.week_start.localeCompare(b.week_start));
  const week = weeks.filter((w) => w.week_start <= date).pop() ?? null;
  const horizon = addDays(date, 13 * 7 + 7);
  const [accounts, bal, plans, sched] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("bank_account").select("*").order("account_no").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("cash_daily").select("date, account_no, opening, closing").is("deleted_at", null).lte("date", date).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("cash_daily_plan").select("*").is("deleted_at", null).gte("date", addDays(date, -31)).lte("date", horizon).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("fixed_cost_schedule").select("*").is("deleted_at", null).range(a, b)),
  ]);
  const balances: CashBalance[] = bal.map((b) => ({ date: String(b.date), account_no: String(b.account_no), opening: s(b.opening), closing: String(b.closing) }));
  const planRows = plans.map((p) => ({ id: String(p.id), date: String(p.date), account_no: s(p.account_no), cf_category: s(p.cf_category), description: s(p.description), amount: String(p.amount), status: s(p.status), fixed_cost_schedule_id: s(p.fixed_cost_schedule_id) }));
  const schedule: FixedCostRow[] = sched.map((r) => ({ id: String(r.id), pl_line: String(r.pl_line), description: String(r.description), amount_per_month: s(r.amount_per_month), start_date: String(r.start_date), end_date: s(r.end_date), amortize: r.amortize === true, prepaid_total: s(r.prepaid_total), active: r.active === true }));
  const cashDay = Object.fromEntries(sched.map((r) => [String(r.id), r.cash_day_of_month === null ? null : Number(r.cash_day_of_month)]));
  const scheduled = scheduledPayments(schedule, planRows, cashDay, addDays(date, 1), horizon);
  const projection = cashProjection({ start: date, balances, plans: [...planRows, ...scheduled] });
  const c = week ? await computeForWeek(week.week_start) : null;
  const r = c?.result ?? null;
  const affLine = r?.statements.cf.lines.find((l) => l.category === "Pinjaman afiliasi (net)");
  const affiliateReceived = affLine ? affLine.values.actual : D(0);
  const split = cashProjectionSplit({ start: date, balances, plans: [...planRows, ...scheduled], affiliateReceived });
  // equity, affiliates, cash, payables from the last weekly balance sheet (yesterday column; projection for C37)
  const bsCash = r ? toFixedString(bsLine(r, "Cash and cash equivalents", "yesterday"), 2) : null;
  // NIBT outlook of the month (M4 data mart) for the 12 months and the months to negative equity
  let nibt: Decimal | null = null, depr: Decimal = D(0), nibtV4: Decimal | null = null, deprV4: Decimal | null = null;
  // K52: set while v5_pl is on (value null = unknown); null = the v4 NIBT
  let nibtSolvency: { value: Decimal | null } | null = null;
  if (opts.m4) {
    const rows = await plDaily(sb, firstOfMonth(date));
    if (rows.length) {
      const sm = monthSummary(rows, firstOfMonth(date), null, "0.10");
      nibt = sm.outlook.nibt;
      depr = sum(rows.filter((x) => x.pl_line === "Depreciation & amortisation").map((x) => (x.actual ?? D(0)).plus(x.forecast ?? D(0))));
    }
    // PRD v4 §3.2 / §6.3: the 12 months rest on the month's outlook of pl_daily_v4; without it the projection is "tidak tersedia"
    const v4 = await fetchAll<Row>((a, b) => sb.from("pl_daily_v4").select("date, segment, pl_line, basis, actual, forecast, kg, anomaly").gte("date", firstOfMonth(date)).lte("date", monthEnd(date)).range(a, b));
    if (v4.length) {
      const pr = plRowsFromMart(v4 as never);
      const sm = monthSummaryV4(pr, firstOfMonth(date), "0.10");
      nibtV4 = sm.outlook.nibt;
      deprV4 = sum(pr.filter((x) => x.pl_line === "Depreciation & amortisation").map((x) => (x.actual ?? D(0)).plus(x.forecast ?? D(0))));
      // PRD v5.1 K52 (flag v5_pl): the solvency runs on NIBT after fixed costs, with the fixed_estimate rows of the month
      if (await v5PlOn(sb)) {
        const lock = must(await sb.from("data_status").select("note").eq("table_name", "month_lock").eq("scope", firstOfMonth(date)).maybeSingle(), "data_status month_lock") as Row | null;
        // no `fixed` in the month builder's note = the month was built without the fixed-cost rows: NIBT after fixed
        // costs is unknown (null → "belum ada"), never the NIBT without them
        const fixed = (lock?.note ? (JSON.parse(String(lock.note)) as { fixed?: FixedSource[] }).fixed : null) ?? null;
        nibtSolvency = { value: solvencyNibtV5(plRowsFromMart(v4 as never, { fixedEstimate: true }), fixed === null || fixedAllMissing(fixed)) };
      }
    }
  }
  const months = cashProjection12m({ month: date, startClosing: projection.startClosing, nibtOutlook: nibt ?? D(0), depreciation: depr });
  const monthsV4 = cashProjection12mOrNull({ month: date, startClosing: projection.startClosing, nibtOutlook: nibtV4, depreciation: deprV4 });
  const sol = r ? solvency({
    equity: sum(["Shareholder Equity", "Retained earnings", "Current year profit"].map((l) => bsLine(r, l, "yesterday"))),
    paidInCapital: bsLine(r, "Shareholder Equity", "yesterday"),
    affiliatePayable: bsLine(r, "Other Payable - Related Parties", "yesterday").plus(bsLine(r, "Trade Payables - Affiliates", "yesterday")),
    affiliateReceivable: bsLine(r, "Trade Receivables - Related Parties", "yesterday").plus(bsLine(r, "Other Receivable - Affiliated Party", "yesterday")),
    nibtMonth: nibtSolvency ? nibtSolvency.value : nibtV4 ?? nibt,
  }) : null;
  // CCC: balance sheet yesterday + the journal of the last 90 days (fewer when the journal is shorter)
  let cccRes: CccResult | null = null, windowDays = 0;
  if (r) {
    const from = addDays(date, -90), to = addDays(date, -1);
    const [gl, coa] = await Promise.all([
      fetchAll<Row>((a, b) => sb.from("gl_line").select("date, account, debit, credit").is("deleted_at", null).gte("date", from).lte("date", to).range(a, b)),
      fetchAll<Row>((a, b) => sb.from("coa_map").select("account, pl_line").is("deleted_at", null).range(a, b)),
    ]);
    const rows = actualDaily({ gl: gl.map((g) => ({ date: s(g.date), account: s(g.account), debit: s(g.debit), credit: s(g.credit) })), coa: coa.map((x) => ({ account: String(x.account), pl_line: s(x.pl_line) })), from, to });
    const daily = dailyTotals(rows);
    const first = [...daily.keys()].sort()[0];
    windowDays = first ? diffDays(to, first) + 1 : 0;
    cccRes = windowDays > 0 ? ccc({
      inventory: bsLine(r, "Inventory - Product", "yesterday").plus(bsLine(r, "Inventory - Trading", "yesterday")),
      ar: bsLine(r, "Trade Receivables - Third Parties", "yesterday").plus(bsLine(r, "Trade Receivables - Related Parties", "yesterday")),
      ap: bsLine(r, "Trade Payables - Third Parties", "yesterday").plus(bsLine(r, "Trade Payables - Affiliates", "yesterday")),
      cogs: sum([...daily.values()].map((t) => t.cogs)), revenue: sum([...daily.values()].map((t) => t.revenue)), windowDays,
    }) : null;
  }
  const payables = r ? ["Trade Payables - Third Parties", "Trade Payables - Affiliates"].map((line) => ({ line, value: bsLine(r, line, "projection") })) : [];
  const controls = cashControls({ date: addDays(date, -1), balances, bsCash, from: week?.week_start ?? date, isWorkingDay, payables });
  return { date, week, accounts, balances, plans: planRows, scheduled, position: balancesOn(balances, date), projection, split, affiliateReceived, months, monthsV4, ccc: cccRes, cccWindowDays: windowDays, solvency: sol, controls, bsCash };
}

// ------------------------------------------------------------------------------------------------ data marts

export async function buildCashDay(sb: Supa, date: string, m4: boolean): Promise<string> {
  const st = await loadCash(sb, date, { m4 });
  const d0 = st.projection.days[0];
  await martReplace(sb, "cash_position_daily", date, [{
    date, total_closing: f2(st.projection.startClosing), total_plan_in: f2(d0?.total_plan_in ?? null) ?? "0", total_plan_out: f2(d0?.total_plan_out ?? null) ?? "0",
    projected_closing: f2(d0?.projected_closing ?? null), lowest_next_13w: f2(st.projection.lowest), lowest_date: st.projection.lowestDate, accounts: st.position.length,
    // PRD v4 §3.7: the planned flows of the day split into operations and affiliate funding, and the scenario without the facility
    closing_without_affiliate: f2(st.split.days[0]?.closingWithout ?? null),
    operating_in: f2(sum(st.plans.concat(st.scheduled).filter((p) => p.date === date && (p.status ?? "plan") === "plan" && p.cf_category !== "Pinjaman afiliasi (net)" && p.cf_category !== "Transfer antar rekening" && D(p.amount).gt(0)).map((p) => D(p.amount)))) ?? "0",
    operating_out: f2(sum(st.plans.concat(st.scheduled).filter((p) => p.date === date && (p.status ?? "plan") === "plan" && p.cf_category !== "Pinjaman afiliasi (net)" && p.cf_category !== "Transfer antar rekening" && D(p.amount).lt(0)).map((p) => D(p.amount)))) ?? "0",
    affiliate_net: f2(sum(st.plans.concat(st.scheduled).filter((p) => p.date === date && (p.status ?? "plan") === "plan" && p.cf_category === "Pinjaman afiliasi (net)").map((p) => D(p.amount)))) ?? "0",
    lowest_without_affiliate: f2(st.split.lowestWithout.balance), lowest_without_date: st.split.lowestWithout.date, affiliate_assumption: st.split.assumption,
    // everything the management page "Kas & solvabilitas" shows beyond today's row (K17: the page reads this, it does not compute)
    horizon: kasHorizon({
      date, position: st.position, banks: Object.fromEntries(st.accounts.map((a) => [String(a.account_no), s(a.bank)])), controls: st.controls,
      split: st.split, months: st.monthsV4, affiliateReceived: st.affiliateReceived,
    }),
  }]);
  if (st.ccc) {
    await martReplace(sb, "ccc_daily", date, [{
      date, dio_days: f2(st.ccc.dio), dso_days: f2(st.ccc.dso), dpo_days: f2(st.ccc.dpo), ccc_days: f2(st.ccc.ccc), cogs_ttm_daily: f2(st.ccc.cogsPerDay), revenue_ttm_daily: f2(st.ccc.revenuePerDay),
      window_days: st.cccWindowDays, working_capital: f2(st.ccc.workingCapital),
    }]);
  }
  if (st.solvency) {
    const m = firstOfMonth(date);
    await martReplace(sb, "solvency_monthly", m, [{
      month: m, equity: f2(st.solvency.equity), paid_in_capital: f2(st.solvency.paid_in_capital), affiliate_payable: f2(st.solvency.affiliate_payable),
      affiliate_receivable: f2(st.solvency.affiliate_receivable), months_to_negative_equity: f2(st.solvency.months_to_negative_equity), basis_nibt: f2(st.solvency.basis_nibt), basis_date: date,
    }]);
  }
  return `kas ${f2(st.projection.startClosing)}, terendah 13 minggu ${f2(st.projection.lowest)} (${st.projection.lowestDate})`;
}

let m4On = false;
registerBuilder({
  module: "m6_cash", name: "cash",
  after: ["m4_monthly"],
  begin: async (sb) => {
    const { data } = await sb.from("app_setting").select("value").eq("key", "m4_monthly").maybeSingle();
    m4On = ((data as Row | null)?.value as { enabled?: boolean } | undefined)?.enabled === true;
  },
  build: (sb, date) => buildCashDay(sb, date, m4On),
});

// ------------------------------------------------------------------------------------------------ upload (template kas harian)

registerV3Kind({
  kind: "cash_daily", module: "m6_cash", label: "Finance — template kas harian (saldo rekening + rencana)", source: "Manual",
  target: "cash_daily", roles: ["admin", "finance"],
  description: "File reference/templates/Template_Kas_Harian.xlsx: sheet Saldo (tanggal, no_rekening, saldo_awal, saldo_akhir, catatan) dan sheet Rencana (tanggal, no_rekening, kategori_cf, deskripsi, jumlah, id_jadwal_tetap). Tanggal × rekening yang sama ditimpa.",
  async stage({ sheets }) {
    const b = parseV3Table("cash_balance", sheets);
    const p = parseV3Table("cash_plan_daily", sheets.filter((x) => x.name !== b.detected?.sheet));
    const okB = b.detected ? b.rows.filter((r) => !r.issues.length) : [];
    const okP = p.detected ? p.rows.filter((r) => !r.issues.length) : [];
    const n = new Map<string, number>();
    const plans = okP.map((r) => {
      const base = `${r.values.date}|${r.values.account_no ?? ""}|${r.values.cf_category ?? ""}`;
      const i = (n.get(base) ?? 0) + 1;
      n.set(base, i);
      return { target: "plan", data: { ...r.values, line_key: `${base}|${i}` } as Row };
    });
    const pb = plan0("cash_daily", "Saldo rekening"); pb.inserts = okB.length;
    const pp = plan0("cash_daily_plan", "Rencana kas"); pp.inserts = plans.length;
    const dates = [...okB, ...okP].map((r) => String(r.values.date)).sort();
    return {
      rows: [...okB.map((r) => ({ target: "balance", data: r.values as Row })), ...plans], plan: [pb, pp],
      issues: [...(b.detected ? b.issues : ["Sheet saldo tidak ditemukan"]), ...(p.detected ? p.issues : [])],
      note: `${okB.length} saldo, ${plans.length} rencana`, dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null,
      sample: [...okB, ...okP].slice(0, 25).map((r) => r.values as Row), unmappedItems: [],
    };
  },
  async commit({ sb, uploadId, rows }) {
    const bal = rows.filter((r) => r.target === "balance").map((r) => ({
      date: r.data.date, account_no: String(r.data.account_no).trim(), opening: r.data.opening === null || r.data.opening === undefined ? null : D(s(r.data.opening)).toFixed(2),
      closing: D(s(r.data.closing)).toFixed(2), note: s(r.data.note), upload_id: uploadId, deleted_at: null,
    }));
    const plans = rows.filter((r) => r.target === "plan").map((r) => ({
      date: r.data.date, account_no: s(r.data.account_no), cf_category: s(r.data.cf_category), description: s(r.data.description), amount: D(s(r.data.amount)).toFixed(2),
      fixed_cost_schedule_id: s(r.data.fixed_cost_schedule_id), line_key: r.data.line_key, upload_id: uploadId, deleted_at: null, status: "plan",
    }));
    const accts = [...new Set([...bal.map((b) => b.account_no), ...plans.map((p) => p.account_no).filter((x): x is string => !!x)])];
    if (accts.length) { const e = await sb.from("bank_account").upsert(accts.map((a) => ({ account_no: a })), { onConflict: "account_no", ignoreDuplicates: true }); if (e.error) throw new WriteError(`bank_account: ${e.error.message}`); }
    if (bal.length) { const e = await sb.from("cash_daily").upsert(bal, { onConflict: "date,account_no" }); if (e.error) throw new WriteError(`cash_daily: ${e.error.message}`); }
    if (plans.length) { const e = await sb.from("cash_daily_plan").upsert(plans, { onConflict: "line_key" }); if (e.error) throw new WriteError(`cash_daily_plan: ${e.error.message}`); }
    return { inserted: bal.length + plans.length, updated: 0, deleted: 0, dates: [...new Set([...bal, ...plans].map((x) => String(x.date)))], message: "Kas harian disimpan" };
  },
});
