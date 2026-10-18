import "server-only";
import type { WeekInputs } from "@kgr/engine";
import { addDays } from "@kgr/engine";
import type { Supa } from "./supabase";
import { fetchAll } from "./data";

type Row = Record<string, unknown>;

export class WriteError extends Error {}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** One RLS-checked transaction per call: inserts + updates + soft deletes + supersedes. */
export async function applyChanges(
  sb: Supa, table: string, inserts: Row[], updates: Row[] = [], softDeletes: string[] = [], supersede: string[] = [],
): Promise<{ inserted: number; updated: number; deleted: number; superseded: number }> {
  const total = { inserted: 0, updated: 0, deleted: 0, superseded: 0 };
  // keep every key present on every insert row (jsonb_populate_recordset uses the first row's keys)
  const keys = [...new Set(inserts.flatMap((r) => Object.keys(r)))];
  const norm = inserts.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
  const insChunks = chunk(norm, 800);
  const updChunks = chunk(updates, 400);
  const n = Math.max(insChunks.length, updChunks.length, 1);
  for (let i = 0; i < n; i++) {
    const { data, error } = await sb.rpc("apply_changes", {
      p_table: table,
      p_inserts: insChunks[i] ?? [],
      p_updates: updChunks[i] ?? [],
      p_soft_deletes: i === 0 ? softDeletes : [],
      p_supersede: i === 0 ? supersede : [],
    });
    if (error) throw new WriteError(`${table}: ${error.message}`);
    const d = data as typeof total;
    total.inserted += d.inserted; total.updated += d.updated; total.deleted += d.deleted; total.superseded += d.superseded;
  }
  return total;
}

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new WriteError(`${what}: ${error.message}`);
  return data;
}

export async function activeIds(sb: Supa, table: string, weekId: string): Promise<string[]> {
  const rows = await fetchAll<{ id: string }>((f, t) =>
    sb.from(table).select("id").eq("week_id", weekId).is("deleted_at", null).order("id").range(f, t));
  return rows.map((r) => r.id);
}

/** Upsert master data (I_Master keys, I_Item, I_COA) — Admin only (RLS). */
export async function upsertMaster(sb: Supa, inputs: WeekInputs): Promise<void> {
  await must(sb.from("sku_key").upsert(
    inputs.sku_keys.map((k, i) => ({ key: k.key, segment: k.segment, sku: k.sku, form: k.form, decision_group: k.decision_group, sort_order: i + 1, active: true })),
    { onConflict: "key" }), "sku_key");
  for (const part of chunk(inputs.item_map, 500)) {
    await must(sb.from("item_map").upsert(part.map((i) => ({ item_code: i.item_code, item_name: i.item_name ?? null, key: i.key, deleted_at: null })), { onConflict: "item_code" }), "item_map");
  }
  for (const part of chunk(inputs.coa_map, 500)) {
    await must(sb.from("coa_map").upsert(part.map((c) => ({
      account: c.account, name: c.name, type: c.type, pl_line: c.pl_line, bs_line: c.bs_line,
      cf_category_as_counter: c.cf_category_as_counter, is_cash: c.is_cash, fs_mapping_reference: c.fs_mapping_reference ?? null, deleted_at: null,
    })), { onConflict: "account" }), "coa_map");
  }
}

export interface LoadSummary {
  weekId: string;
  counts: Record<string, number>;
}

/**
 * Load a complete week (from the KGR workbook or the bundled example) into the database.
 * Replaces the week's input rows (old rows are soft-deleted, so the audit trail keeps them) and the journal lines
 * in the workbook's date range.
 */
export async function loadWeekInputs(
  sb: Supa, inputs: WeekInputs, opts: { source: "Accurate" | "Ops" | "Manual"; note?: string; uploadId?: string | null; master?: boolean },
): Promise<LoadSummary> {
  const W = inputs.week;
  if (opts.master) await upsertMaster(sb, inputs);
  const p = inputs.parameters;
  const existing = await must(sb.from("week").select("id").eq("week_start", W.week_start).maybeSingle(), "week");
  const weekRow = {
    week_start: W.week_start, update_date: W.update_date, tb_opening_date: W.tb_opening_date,
    lw_rpa_kg: p.last_week.RPA.kg, lw_rpa_revenue: p.last_week.RPA.revenue, lw_rpa_gp: p.last_week.RPA.gp,
    lw_trading_kg: p.last_week.Trading.kg, lw_trading_revenue: p.last_week.Trading.revenue, lw_trading_gp: p.last_week.Trading.gp,
    lw_source: "workbook I_Parameter", note: opts.note ?? null, opening_stock_flag: null,
  };
  let weekId: string;
  if (existing) {
    weekId = (existing as { id: string }).id;
    await must(sb.from("week").update(weekRow).eq("id", weekId), "week");
  } else {
    const ins = await must(sb.from("week").insert(weekRow).select("id").single(), "week");
    weekId = (ins as { id: string }).id;
  }
  const yd = p.yield_default;
  await must(sb.from("parameter").upsert({
    week_id: weekId, horizon_fresh_days: p.horizon_fresh_days, target_shrink: p.target_shrink, freight_plan_per_kg_lb: p.freight_plan_per_kg_lb,
    maklon_per_kg_processed: p.maklon_per_kg_processed, lb_price_today: p.lb_price_today, min_trading_spread: p.min_trading_spread,
    stock_age_limit_days: p.stock_age_limit_days, terms_lb_days: p.terms_lb_days, terms_trading_days: p.terms_trading_days,
    terms_freight_maklon_days: p.terms_freight_maklon_days, yield_karkas: yd.karkas, yield_kepala: yd.kepala, yield_ceker: yd.ceker,
    yield_usus: yd.usus, yield_hja: yd.hja, yield_lemak: yd.lemak, accurate_sales_kg: p.accurate_sales_kg,
    accurate_opening_stock_value: p.accurate_opening_stock_value,
    placeholder_note: "PLACEHOLDER (PRD §11): spread minimum, termin, horizon, target shrink, batas umur stok — lihat docs/open-questions.md B1–B8",
  }, { onConflict: "week_id" }), "parameter");
  const known = new Set(((await must(sb.from("sku_key").select("key"), "sku_key")) ?? []).map((k: { key: string }) => k.key));
  await must(sb.from("sku_price").upsert(
    inputs.sku_keys.filter((k) => known.has(k.key)).map((k) => ({ week_id: weekId, key: k.key, ref_sell_price: k.ref_sell_price, replacement_buy_price: k.replacement_buy_price, note: k.note ?? null })),
    { onConflict: "week_id,key" }), "sku_price");
  await must(sb.from("runrate").upsert(
    // a line without a monthly amount is not written (NOT NULL column: a blank would be stored as 0, missing ≠ 0)
    inputs.runrate.flatMap((r, i) => r.monthly_amount === null || r.monthly_amount === undefined ? [] : [{ week_id: weekId, pl_line: r.pl_line, monthly_amount: r.monthly_amount, week_adjustment: r.week_adjustment ?? 0 /* missing-ok: penyesuaian kosong = tidak ada penyesuaian (kolom NOT NULL default 0) */, basis: r.basis ?? null, seq: i + 1 }]),
    { onConflict: "week_id,pl_line" }), "runrate");

  const src = opts.source;
  const up = opts.uploadId ?? null;
  const counts: Record<string, number> = {};
  const replace = async (table: string, rows: Row[]) => {
    const old = await activeIds(sb, table, weekId);
    const r = await applyChanges(sb, table, rows, [], old);
    counts[table] = r.inserted;
  };
  await replace("opening_stock", inputs.opening_stock.map((o, i) => ({
    week_id: weekId, seq: i + 1, item_code: o.item_code, item_name: o.item_name ?? null, key_manual: o.key_manual ?? null, kg: o.kg, value: o.value,
    avg_age_days: o.avg_age_days, kg_over_age_limit: o.kg_over_age_limit, note: o.note ?? null, source: o.source ?? src, upload_id: up,
  })));
  await replace("sales_line", inputs.sales_lines.map((s, i) => ({
    week_id: weekId, seq: i + 1, date: s.date, status: s.status, document_ref: s.document_ref ?? null, customer: s.customer ?? null,
    item_code: s.item_code, key_manual: s.key_manual ?? null, kg: s.kg, price: s.price, hpp_actual: s.hpp_actual ?? null,
    source: s.source ?? (s.status === "Aktual" ? "Accurate" : "Manual"), upload_id: up,
  })));
  await replace("receipt_line", inputs.receipt_lines.map((r, i) => ({
    week_id: weekId, seq: i + 1, date: r.date, status: r.status, receipt_source: r.receipt_source, document_ref: r.document_ref ?? null,
    supplier: r.supplier ?? null, item_code: r.item_code, key_manual: r.key_manual ?? null, kg: r.kg, unit_cost: r.unit_cost,
    source: r.source ?? (r.status === "Aktual" ? "Accurate" : "Manual"), upload_id: up,
  })));
  await replace("batch", inputs.batches.map((b, i) => ({
    week_id: weekId, seq: i + 1, date: b.date, status: b.status, batch_ref: b.batch_ref ?? null, supplier: b.supplier ?? null, lb_kg: b.lb_kg,
    lb_price: b.lb_price, freight: b.freight, maklon: b.maklon, processed_kg: b.processed_kg, out_karkas_fresh: b.output.karkas_fresh,
    out_karkas_frozen: b.output.karkas_frozen, out_kepala: b.output.kepala, out_ceker: b.output.ceker, out_usus: b.output.usus,
    out_hja: b.output.hja, out_lemak: b.output.lemak, out_other: b.output.other, source: b.source ?? (b.status === "Aktual" ? "Ops" : "Manual"),
    document_ref: b.batch_ref ?? null, upload_id: up,
  })));
  await replace("tb_opening", inputs.tb_opening.map((t, i) => ({ week_id: weekId, seq: i + 1, account: t.account, name: t.name ?? null, balance: t.balance, source: "Accurate", upload_id: up })));
  await replace("cash_plan", inputs.cash_plan.map((c, i) => ({
    week_id: weekId, seq: i + 1, date: c.date, cf_category: c.cf_category, bs_counter_line: c.bs_counter_line, description: c.description ?? null,
    amount: c.amount, source: c.source ?? "Manual", upload_id: up,
  })));

  // Journal lines: replace the workbook's date range.
  const dates = inputs.gl_lines.map((g) => g.date).filter((d): d is string => !!d).sort();
  if (dates.length > 0) {
    const from = dates[0], to = dates[dates.length - 1];
    const old = await fetchAll<{ id: string }>((f, t) => sb.from("gl_line").select("id").is("deleted_at", null).gte("date", from).lte("date", to).order("id").range(f, t));
    const seen = new Map<string, number>();
    const rows = inputs.gl_lines.filter((g) => g.date).map((g, i) => {
      const n = (seen.get(g.voucher_no ?? "") ?? 0) + 1; // missing-ok: penghitung baris per voucher (indeks)
      seen.set(g.voucher_no ?? "", n);
      return {
        seq: i + 1, date: g.date, voucher_no: g.voucher_no, voucher_type: g.voucher_type ?? null, account: g.account, account_name: g.account_name ?? null,
        description: g.description ?? null, debit: g.debit, credit: g.credit, party: g.party ?? null, cf_override: g.cf_override ?? null,
        line_key: `${g.voucher_no}|${n}`, source: "Accurate", upload_id: up,
      };
    });
    const r = await applyChanges(sb, "gl_line", rows, [], old.map((o) => o.id));
    counts.gl_line = r.inserted;
  }
  return { weekId, counts };
}

export { addDays };
