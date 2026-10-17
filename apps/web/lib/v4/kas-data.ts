import "server-only";
/**
 * Reads for the page "Kas & solvabilitas" (PRD v4 §6.3, K17): the latest cash_position_daily row with the horizon the
 * rebuild wrote, ccc_daily, solvency_monthly (this month and the one before) and the month's interest from
 * pl_daily_v4. Nothing here computes a number; the model (kas.ts) places it.
 */
import { addDays, firstOfMonth, monthEnd } from "@kgr/engine";
import type { Supa } from "../supabase";
import type { KasHorizon, KasInput } from "./kas";

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: string | undefined, d: string) => (v !== undefined && /^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : d);
const MONTH = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export async function loadKas(sb: Supa, x: { today: string; sp: Record<string, string | undefined> }): Promise<KasInput> {
  const [{ data: pos }, { data: cc }, { data: svs }] = await Promise.all([
    sb.from("cash_position_daily").select("*").lte("date", x.today).not("total_closing", "is", null).order("date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("ccc_daily").select("*").lte("date", x.today).order("date", { ascending: false }).limit(1).maybeSingle(),
    sb.from("solvency_monthly").select("*").lte("month", x.today).order("month", { ascending: false }).limit(2),
  ]);
  const p = pos as Row | null;
  // a day built without any bank balance (no template kas harian uploaded yet) has no cash position: the balances and
  // what is projected from them are "belum diisi", never Rp 0 (K12); the planned flows and the missing days stay
  const noBalance = p !== null && Number(p.accounts ?? 0) === 0;
  const hz = (p?.horizon ?? null) as KasHorizon | null;
  const row: KasInput["row"] = p ? {
    date: String(p.date), totalClosing: noBalance ? null : s(p.total_closing), lowest: noBalance ? null : s(p.lowest_next_13w), lowestDate: noBalance ? null : s(p.lowest_date),
    lowestWithout: noBalance ? null : s(p.lowest_without_affiliate), lowestWithoutDate: noBalance ? null : s(p.lowest_without_date), assumption: s(p.affiliate_assumption),
    horizon: hz && noBalance ? { ...hz, weeks: hz.weeks.map((w) => ({ ...w, closing: null, closing_without: null })), months: null, lowest: { ...hz.lowest, balance: null }, lowest_without: { ...hz.lowest_without, balance: null } } : hz,
  } : null;

  let solvency: KasInput["solvency"] = null;
  const [cur, prev] = ((svs ?? []) as Row[]);
  if (cur && cur.equity !== null && cur.paid_in_capital !== null) {
    const month = String(cur.month);
    const { data: intr } = await sb.from("pl_daily_v4").select("actual, forecast").eq("pl_line", "Interest Expense").neq("basis", "fixed_estimate").gte("date", firstOfMonth(month)).lte("date", monthEnd(month));
    const ir = (intr ?? []) as Row[];
    solvency = {
      label: `${MONTH[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`, month, equity: String(cur.equity), paidIn: String(cur.paid_in_capital),
      affiliate: s(cur.affiliate_payable) ?? "0", months: s(cur.months_to_negative_equity), basis: s(cur.basis_nibt), interestRows: ir.length ? ir.map((r) => ({ actual: s(r.actual), forecast: s(r.forecast) })) : null,
      prevAffiliate: prev && String(prev.month) === firstOfMonth(addDays(month, -1)) ? s(prev.affiliate_payable) : null,
    };
  }

  const c = cc as Row | null;
  const ccc: KasInput["ccc"] = c ? {
    date: String(c.date), dio: s(c.dio_days), dso: s(c.dso_days), dpo: s(c.dpo_days), ccc: s(c.ccc_days), workingCapital: s(c.working_capital),
    cogsPerDay: s(c.cogs_ttm_daily), revenuePerDay: s(c.revenue_ttm_daily), windowDays: c.window_days === null ? null : Number(c.window_days),
  } : null;

  return {
    today: x.today, row, solvency, ccc, base: "/kas",
    sim: { lb: num(x.sp.lb, "7"), tr: num(x.sp.tr, "14"), share: num(x.sp.share, "0.5"), stock: x.sp.stock ? num(x.sp.stock, "") : "" },
  };
}
