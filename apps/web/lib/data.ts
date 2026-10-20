import "server-only";
import { computeWeek, isISODate, type WeekInputs, type WeekResult } from "@kgr/engine";
import type { Supa } from "./supabase";
import { LoaderError, isSchemaError, must } from "./loader";
import { weeksOf } from "./request-memo";

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

export type FetchPage<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>;

/** How the rebuild worker pages (PRD v6 R123): 5000 rows a page (PostgREST max-rows after B-R121), four pages at a time. */
export interface PageOpts {
  size?: number;
  parallel?: number;
}
export const WORKER_PAGES: PageOpts = { size: 5000, parallel: 4 };

/**
 * PostgREST returns at most max-rows (1000 on KGR-OS until B-R121) per request; page through everything. R47 (K42): the
 * caller must order uniquely. With the default size the pages are read one after the other, as before v6.
 * R123 (worker only): a larger size and `parallel` pages per round. The page size actually served is the length of the
 * first page — a server capped below `size` answers fewer rows than asked, which is not the end of the table — so a first
 * page of ≥ 1000 rows (a plausible cap; max-rows is never set below 1000) shorter than `size` is followed by more pages of
 * that length; the end is the first page shorter than that length.
 */
export async function fetchAll<T = Row>(page: FetchPage<T>, size = 1000, opts: PageOpts = {}): Promise<T[]> {
  const got = async (from: number, to: number): Promise<T[]> => {
    const { data, error } = await page(from, to);
    if (error) throw new LoaderError("fetchAll", error.message, isSchemaError(error.code), error.code);
    return data ?? []; // k41-ok: error sudah dilempar di baris atas; data null tanpa error = halaman kosong
  };
  const want = opts.size ?? size;
  if (want <= 1000 && !opts.parallel) {
    const out: T[] = [];
    for (let from = 0; ; from += want) {
      const rows = await got(from, from + want - 1);
      out.push(...rows);
      if (rows.length < want) break;
    }
    return out;
  }
  const out = await got(0, want - 1);
  const step = out.length;
  if (step === 0 || (step < want && step < 1000)) return out;
  const par = Math.max(1, opts.parallel ?? 1);
  for (let from = step; ; from += step * par) {
    const round = await Promise.all(Array.from({ length: par }, (_, i) => got(from + i * step, from + (i + 1) * step - 1)));
    let ended = false;
    for (const rows of round) {
      if (ended && rows.length) throw new LoaderError("fetchAll", "baris berubah saat dibaca berhalaman; ulangi", false);
      out.push(...rows);
      if (rows.length < step) ended = true;
    }
    if (ended) return out;
  }
}

/** K56 (R43): fetchAll of a table that may not be migrated yet — 42P01 returns [], any other error throws. */
export async function fetchAllOrMissing<T = Row>(page: FetchPage<T>, where: string, size = 1000, opts: PageOpts = {}): Promise<T[]> {
  try {
    return await fetchAll(page, size, opts);
  } catch (e) {
    if (e instanceof LoaderError && e.code === "42P01") {
      console.error(`[schema] ${where}: ${e.message}`);
      return [];
    }
    throw e;
  }
}

/** Every week, newest first; once per client (PRD v6 R126, request-memo). */
export async function listWeeks(sb: Supa): Promise<WeekRow[]> {
  return weeksOf(sb);
}

// PRD v5.1 K38: the data date lives in clock.ts with the wall clock; re-exported for the builders that read it
export { dataToday } from "./clock";
// K42: `.in()` in chunks of 200 values
export { inChunks } from "./loader";

export async function getWeek(sb: Supa, weekStart: string): Promise<WeekRow | null> {
  if (!isISODate(weekStart)) return null; // e.g. /w/2026-02-31: not a week, and Postgres would reject the literal
  return must(await sb.from("week").select("*").eq("week_start", weekStart).maybeSingle(), "getWeek.week") as WeekRow | null;
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

/** `pages`: WORKER_PAGES in the rebuild worker and the release (R123); the default pages one by one. */
export async function loadWeek(sb: Supa, weekStart: string, pages: PageOpts = {}): Promise<LoadedWeek | null> {
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
    }, 1000, pages);

  const [param, keys, prices, items, coa, opening, sales, receipts, batches, tb, runrate, cashPlan, supSales, supRec] = await Promise.all([
    sb.from("parameter").select("*").eq("week_id", wid).maybeSingle(),
    fetchAll<Row>((f, t) => sb.from("sku_key").select("*").eq("active", true).order("sort_order").order("key").range(f, t), 1000, pages),
    fetchAll<Row>((f, t) => sb.from("sku_price").select("*").eq("week_id", wid).order("key").order("week_id").range(f, t), 1000, pages),
    fetchAll<Row>((f, t) => active(sb.from("item_map").select("item_code, item_name, key")).order("item_code").range(f, t), 1000, pages),
    fetchAll<Row>((f, t) => active(sb.from("coa_map").select("*")).order("account").range(f, t), 1000, pages),
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
    1000, pages,
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

/**
 * Q-v5.2-51 (A1d): a week is loaded and computed with the client the caller gives — the signed-in user's client in the
 * app (RLS applies), the service client in the rebuild and the cron. Never the session client behind the caller's back:
 * a cron has no session (anon reads an empty week) and the same builder must write the same mart whoever runs it.
 * Memoised per client: a request loads a week once because the app edge shares one client per request
 * (`supabaseServer` is cached); a rebuild run holds one service client, so it loads a week once per run.
 */
const weekMemo = new WeakMap<object, Map<string, Promise<Computed | null>>>();

export async function loadAndCompute(sb: Supa, weekStart: string, pages: PageOpts = {}): Promise<Computed | null> {
  const loaded = await loadWeek(sb, weekStart, pages);
  if (!loaded) return null;
  const t0 = performance.now();
  const result = computeWeek(loaded.inputs);
  return { loaded, result, computeMs: Math.round(performance.now() - t0) };
}

export function computeForWeek(sb: Supa, weekStart: string, pages: PageOpts = {}): Promise<Computed | null> {
  let byWeek = weekMemo.get(sb);
  if (!byWeek) weekMemo.set(sb, (byWeek = new Map()));
  let p = byWeek.get(weekStart);
  if (!p) {
    const own = byWeek;
    // a failure is not remembered (the next caller, e.g. the next date of a rebuild run, reads again) and still reaches the caller
    p = loadAndCompute(sb, weekStart, pages).catch((e: unknown) => { own.delete(weekStart); throw e; });
    own.set(weekStart, p);
  }
  return p;
}
