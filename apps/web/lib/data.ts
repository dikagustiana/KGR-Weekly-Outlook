import "server-only";
import { cache } from "react";
import { computeWeek, isISODate, type WeekInputs, type WeekResult } from "@kgr/engine";
import { supabaseServer, type Supa } from "./supabase";

export interface WeekRow {
  id: string;
  week_start: string;
  week_end: string;
  update_date: string;
  tb_opening_date: string;
  status: "open" | "released" | "closed";
  lw_rpa_kg: number; lw_rpa_revenue: number; lw_rpa_gp: number;
  lw_trading_kg: number; lw_trading_revenue: number; lw_trading_gp: number;
  lw_source: string | null;
  opening_stock_flag: string | null;
  note: string | null;
}

type Row = Record<string, unknown>;

const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** PostgREST returns at most 1000 rows per request; page through everything. */
export async function fetchAll<T = Row>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}

export async function listWeeks(sb: Supa): Promise<WeekRow[]> {
  const { data, error } = await sb.from("week").select("*").order("week_start", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WeekRow[];
}

// PRD v5.1 K38: the data date lives in clock.ts with the wall clock; re-exported for the builders that read it
export { dataToday } from "./clock";
// K42: `.in()` in chunks of 200 values
export { inChunks } from "./loader";

export async function getWeek(sb: Supa, weekStart: string): Promise<WeekRow | null> {
  if (!isISODate(weekStart)) return null; // e.g. /w/2026-02-31: not a week, and Postgres would reject the literal
  const { data, error } = await sb.from("week").select("*").eq("week_start", weekStart).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WeekRow) ?? null;
}

export interface LoadedWeek {
  week: WeekRow;
  inputs: WeekInputs;
  db: {
    sales: Row[];
    receipts: Row[];
    batches: Row[];
    opening: Row[];
    cashPlan: Row[];
    gl: Row[];
    tb: Row[];
    runrate: Row[];
    parameter: Row;
    prices: Row[];
    supersededSales: Row[];
    supersededReceipts: Row[];
  };
}

const active = <Q extends { is: (c: string, v: null) => Q }>(q: Q) => q.is("deleted_at", null);

export async function loadWeek(sb: Supa, weekStart: string): Promise<LoadedWeek | null> {
  const week = await getWeek(sb, weekStart);
  if (!week) return null;
  const wid = week.id;
  const byWeek = (table: string, extra?: (q: any) => any) =>
    fetchAll<Row>((from, to) => {
      let q: any = sb.from(table).select("*").eq("week_id", wid);
      if (table !== "runrate") q = q.is("deleted_at", null);
      if (extra) q = extra(q);
      q = q.order("seq");
      if (table !== "runrate") q = q.order("created_at");
      return q.order("id").range(from, to);
    });

  const [param, keys, prices, items, coa, opening, sales, receipts, batches, tb, runrate, cashPlan, supSales, supRec] = await Promise.all([
    sb.from("parameter").select("*").eq("week_id", wid).maybeSingle(),
    fetchAll<Row>((f, t) => sb.from("sku_key").select("*").eq("active", true).order("sort_order").order("key").range(f, t)),
    fetchAll<Row>((f, t) => sb.from("sku_price").select("*").eq("week_id", wid).range(f, t)),
    fetchAll<Row>((f, t) => active(sb.from("item_map").select("item_code, item_name, key")).order("item_code").range(f, t)),
    fetchAll<Row>((f, t) => active(sb.from("coa_map").select("*")).order("account").range(f, t)),
    byWeek("opening_stock", (q) => q.is("superseded_at", null)),
    byWeek("sales_line", (q) => q.is("superseded_at", null)),
    byWeek("receipt_line", (q) => q.is("superseded_at", null)),
    byWeek("batch", (q) => q.is("superseded_at", null)),
    byWeek("tb_opening"),
    byWeek("runrate"),
    byWeek("cash_plan"),
    byWeek("sales_line", (q) => q.not("superseded_at", "is", null).eq("source", "Ops")),
    byWeek("receipt_line", (q) => q.not("superseded_at", "is", null).eq("source", "Ops")),
  ]);
  if (param.error) throw new Error(param.error.message);
  if (!param.data) throw new Error(`Parameter minggu ${weekStart} belum ada`);
  const p = param.data as Row;
  const gl = await fetchAll<Row>((f, t) =>
    sb.from("gl_line").select("*").is("deleted_at", null).gt("date", week.tb_opening_date).lt("date", week.update_date)
      .order("date").order("seq").order("id").range(f, t),
  );

  const priceBy = new Map(prices.map((r) => [String(r.key), r]));
  const inputs: WeekInputs = {
    week: { week_start: week.week_start, update_date: week.update_date, tb_opening_date: week.tb_opening_date },
    parameters: {
      horizon_fresh_days: s(p.horizon_fresh_days)!, target_shrink: s(p.target_shrink)!, freight_plan_per_kg_lb: s(p.freight_plan_per_kg_lb)!,
      maklon_per_kg_processed: s(p.maklon_per_kg_processed)!, lb_price_today: s(p.lb_price_today)!, min_trading_spread: s(p.min_trading_spread)!,
      stock_age_limit_days: s(p.stock_age_limit_days)!, terms_lb_days: s(p.terms_lb_days)!, terms_trading_days: s(p.terms_trading_days)!,
      terms_freight_maklon_days: s(p.terms_freight_maklon_days)!,
      yield_default: {
        karkas: s(p.yield_karkas)!, kepala: s(p.yield_kepala)!, ceker: s(p.yield_ceker)!, usus: s(p.yield_usus)!, hja: s(p.yield_hja)!, lemak: s(p.yield_lemak)!,
      },
      last_week: {
        RPA: { kg: s(week.lw_rpa_kg)!, revenue: s(week.lw_rpa_revenue)!, gp: s(week.lw_rpa_gp)! },
        Trading: { kg: s(week.lw_trading_kg)!, revenue: s(week.lw_trading_revenue)!, gp: s(week.lw_trading_gp)! },
      },
      accurate_sales_kg: s(p.accurate_sales_kg),
      accurate_opening_stock_value: s(p.accurate_opening_stock_value),
    },
    sku_keys: keys.map((k) => {
      const pr = priceBy.get(String(k.key));
      return {
        key: String(k.key), segment: String(k.segment), sku: String(k.sku), form: String(k.form), decision_group: String(k.decision_group),
        ref_sell_price: s(pr?.ref_sell_price), replacement_buy_price: s(pr?.replacement_buy_price), note: s(pr?.note ?? k.note),
      };
    }),
    item_map: items.map((i) => ({ item_code: String(i.item_code), item_name: s(i.item_name), key: String(i.key) })),
    coa_map: coa.map((c) => ({
      account: String(c.account), name: String(c.name), type: String(c.type), pl_line: s(c.pl_line), bs_line: s(c.bs_line),
      cf_category_as_counter: s(c.cf_category_as_counter), is_cash: !!c.is_cash, fs_mapping_reference: s(c.fs_mapping_reference),
    })),
    opening_stock: opening.map((r) => ({
      id: s(r.id)!, row: Number(r.seq), source: r.source as never, document_ref: s(r.document_ref), item_code: s(r.item_code),
      item_name: s(r.item_name), key_manual: s(r.key_manual), kg: s(r.kg), value: s(r.value), avg_age_days: s(r.avg_age_days),
      kg_over_age_limit: s(r.kg_over_age_limit), note: s(r.note),
    })),
    sales_lines: sales.map(toSales),
    receipt_lines: receipts.map(toReceipt),
    batches: batches.map((b) => ({
      id: s(b.id)!, row: Number(b.seq), source: b.source as never, document_ref: s(b.document_ref), date: s(b.date), status: s(b.status),
      batch_ref: s(b.batch_ref), supplier: s(b.supplier), lb_kg: s(b.lb_kg), lb_price: s(b.lb_price), freight: s(b.freight), maklon: s(b.maklon),
      processed_kg: s(b.processed_kg),
      output: {
        karkas_fresh: s(b.out_karkas_fresh), karkas_frozen: s(b.out_karkas_frozen), kepala: s(b.out_kepala), ceker: s(b.out_ceker),
        usus: s(b.out_usus), hja: s(b.out_hja), lemak: s(b.out_lemak), other: s(b.out_other),
      },
    })),
    gl_lines: gl.map((g) => ({
      id: s(g.id)!, row: Number(g.seq), source: g.source as never, date: s(g.date), voucher_no: s(g.voucher_no), voucher_type: s(g.voucher_type),
      account: s(g.account), account_name: s(g.account_name), description: s(g.description), debit: s(g.debit), credit: s(g.credit),
      party: s(g.party), cf_override: s(g.cf_override),
    })),
    tb_opening: tb.map((t) => ({ id: s(t.id)!, row: Number(t.seq), account: String(t.account), name: s(t.name), balance: s(t.balance) })),
    runrate: runrate.map((r) => ({ pl_line: String(r.pl_line), monthly_amount: s(r.monthly_amount), week_adjustment: s(r.week_adjustment), basis: s(r.basis) })),
    cash_plan: cashPlan.map((c) => ({
      id: s(c.id)!, row: Number(c.seq), source: c.source as never, document_ref: s(c.document_ref), date: s(c.date), cf_category: s(c.cf_category),
      bs_counter_line: s(c.bs_counter_line), description: s(c.description), amount: s(c.amount),
    })),
    superseded_ops_rows: { sales: supSales.map(toSales), receipts: supRec.map(toReceipt) },
  };
  return {
    week, inputs,
    db: { sales, receipts, batches, opening, cashPlan, gl, tb, runrate, parameter: p, prices, supersededSales: supSales, supersededReceipts: supRec },
  };
}

function toSales(r: Row) {
  return {
    id: s(r.id)!, row: Number(r.seq), source: r.source as never, document_ref: s(r.document_ref), date: s(r.date), status: s(r.status),
    customer: s(r.customer), item_code: s(r.item_code), key_manual: s(r.key_manual), kg: s(r.kg), price: s(r.price), hpp_actual: s(r.hpp_actual),
  };
}

function toReceipt(r: Row) {
  return {
    id: s(r.id)!, row: Number(r.seq), source: r.source as never, document_ref: s(r.document_ref), date: s(r.date), status: s(r.status),
    receipt_source: s(r.receipt_source), supplier: s(r.supplier), item_code: s(r.item_code), key_manual: s(r.key_manual), kg: s(r.kg),
    unit_cost: s(r.unit_cost),
  };
}

export interface Computed {
  loaded: LoadedWeek;
  result: WeekResult;
  computeMs: number;
}

/** Load and compute one week once per request. */
export const computeForWeek = cache(async (weekStart: string): Promise<Computed | null> => {
  const sb = await supabaseServer();
  const loaded = await loadWeek(sb, weekStart);
  if (!loaded) return null;
  const t0 = performance.now();
  const result = computeWeek(loaded.inputs);
  return { loaded, result, computeMs: Math.round(performance.now() - t0) };
});

export const weeksCached = cache(async () => listWeeks(await supabaseServer()));
