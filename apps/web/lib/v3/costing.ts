import "server-only";
/**
 * M1 costing — data access and actions (PRD v3 §4.2). The numbers come from @kgr/engine (allocateBatch,
 * computeCostPool, groupCostPerKg, costingControls); this file only loads rows, maps them to engine inputs and
 * stores the engine's output (allocation_run / allocation_line). No arithmetic on money here beyond Decimal
 * formatting of engine results.
 */
import {
  ENGINE_VERSION, allocateBatch, c48, computeCostPool, costComponentOf, costingControls, groupCostPerKg, toFixedString,
  type AllocateInput, type AllocationResult, type ControlV3, type CostComponent, type CostLine, D,
} from "@kgr/engine";
import { parseCostingWorkbook, parseV3Table, wpBatchRef, type WpBatch } from "@kgr/parsers";
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import { fetchAll, listWeeks, type WeekRow } from "../data";
import { inChunks, must, mustRows } from "../loader";
import { WriteError } from "../write";
import { plan0, registerV3Kind, weekOfDate, type Row, type V3Stage } from "./uploads";

const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export interface BatchRow {
  id: string; week_id: string; date: string | null; status: string | null; batch_ref: string | null; supplier: string | null;
  lb_kg: string | null; lb_price: string | null; freight: string | null; maklon: string | null; processed_kg: string | null;
  cost_mode: "maklon" | "own"; head_count: number | null; avg_lb_kg: string | null; costing_status: string; document_ref: string | null;
}
export interface OutputRow { id: string; batch_id: string; key: string | null; item_code: string | null; item_name: string | null; kg: string; price_ref: string | null; source: string; note: string | null }
export interface RunRow { id: string; batch_id: string; status: "draft" | "posted" | "superseded"; total_cost: string; total_allocated: string; diff: string; overhead_cost: string; run_at: string; run_by: string | null; by_product_method: string; mode: string; issues: string[] }
export interface LineRow { id: string; allocation_run_id: string; key: string | null; item_code: string | null; kg: string; price_ref: string | null; sales_value: string; share: string; allocated_cost: string; cost_per_kg: string; by_product_method: string; nrv_floor: string | null; nrv_writedown: string }
export interface PoolRow { id: string; period_start: string; period_end: string; mode: string; description: string | null; total_pi: string; total_gl: string | null; status: string }
export interface PoolLineRow { id: string; cost_pool_id: string; component: CostComponent; date: string | null; supplier: string | null; account: string | null; document_ref: string | null; amount: string; batch_id: string | null; note: string | null; line_key: string | null; source: string }
export interface RateRow { id: string; period_start: string; period_end: string; rate_per_kg_lb: string; rate_per_head: string | null; basis_kg: string | null; budget_overhead: string | null; note: string | null }
export interface KeyInfo { key: string; group_code: string | null; decision_group: string; cut_component: string | null; segment: string }

export interface CostingParams { by_product_method: "joint" | "nrv"; yield_gap_tolerance: string; avg_lb_kg_default: string; selling_cost_per_kg: string }

export interface CostingWeek {
  week: WeekRow;
  batches: BatchRow[];
  outputs: Map<string, OutputRow[]>;
  latestRun: Map<string, RunRow>;
  lines: Map<string, LineRow[]>;
  pools: PoolRow[];
  poolLines: PoolLineRow[];
  rates: RateRow[];
  keys: Map<string, KeyInfo>;
  prices: Map<string, string | null>;
  params: CostingParams;
}

function monthBounds(d: string): { start: string; end: string } {
  const [y, m] = d.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${d.slice(0, 7)}-01`, end };
}

export async function loadCostingWeek(sb: Supa, week: WeekRow): Promise<CostingWeek> {
  const batches = (await fetchAll<Row>((f, t) => sb.from("batch").select("id, week_id, date, status, batch_ref, supplier, lb_kg, lb_price, freight, maklon, processed_kg, cost_mode, head_count, avg_lb_kg, costing_status, document_ref")
    .eq("week_id", week.id).is("deleted_at", null).is("superseded_at", null).order("date").order("seq").range(f, t))) as unknown as BatchRow[];
  const ids = batches.map((b) => b.id);
  const [outs, runs, keys, prices, param] = await Promise.all([
    ids.length ? inChunks(ids, (c) => fetchAll<Row>((f, t) => sb.from("batch_output_sku").select("id, batch_id, key, item_code, item_name, kg, price_ref, source, note").in("batch_id", c).is("deleted_at", null).order("kg", { ascending: false }).range(f, t))) : Promise.resolve([]),
    ids.length ? inChunks(ids, (c) => fetchAll<Row>((f, t) => sb.from("allocation_run").select("id, batch_id, status, total_cost, total_allocated, diff, overhead_cost, run_at, run_by, by_product_method, mode, issues").in("batch_id", c).neq("status", "superseded").order("run_at", { ascending: false }).range(f, t))) : Promise.resolve([]),
    fetchAll<Row>((f, t) => sb.from("sku_key").select("key, group_code, decision_group, cut_component, segment").range(f, t)),
    fetchAll<Row>((f, t) => sb.from("sku_price").select("key, ref_sell_price").eq("week_id", week.id).range(f, t)),
    sb.from("parameter").select("by_product_method, yield_gap_tolerance, avg_lb_kg_default, selling_cost_per_kg").eq("week_id", week.id).maybeSingle(),
  ]);
  const latestRun = new Map<string, RunRow>();
  for (const r of runs as unknown as RunRow[]) if (!latestRun.has(r.batch_id)) latestRun.set(r.batch_id, r);
  const runIds = [...latestRun.values()].map((r) => r.id);
  const lines = runIds.length ? ((await inChunks(runIds, (c) => fetchAll<Row>((f, t) => sb.from("allocation_line").select("id, allocation_run_id, key, item_code, kg, price_ref, sales_value, share, allocated_cost, cost_per_kg, by_product_method, nrv_floor, nrv_writedown").in("allocation_run_id", c).order("allocated_cost", { ascending: false }).range(f, t)))) as unknown as LineRow[]) : [];
  const m = monthBounds(week.week_start);
  const mEnd = monthBounds(week.week_end).end;
  const pools = (await fetchAll<Row>((f, t) => sb.from("cost_pool").select("id, period_start, period_end, mode, description, total_pi, total_gl, status").is("deleted_at", null).lte("period_start", mEnd).gte("period_end", m.start).order("period_start").range(f, t))) as unknown as PoolRow[];
  const poolLines = pools.length ? ((await inChunks(pools.map((p) => p.id), (c) => fetchAll<Row>((f, t) => sb.from("cost_pool_line").select("id, cost_pool_id, component, date, supplier, account, document_ref, amount, batch_id, note, line_key, source").in("cost_pool_id", c).is("deleted_at", null).order("date").range(f, t)))) as unknown as PoolLineRow[]) : [];
  const rates = (await fetchAll<Row>((f, t) => sb.from("overhead_rate").select("id, period_start, period_end, rate_per_kg_lb, rate_per_head, basis_kg, budget_overhead, note").is("deleted_at", null).lte("period_start", week.week_end).gte("period_end", week.week_start).range(f, t))) as unknown as RateRow[];
  const group = <T,>(xs: T[], k: (x: T) => string) => {
    const g = new Map<string, T[]>();
    for (const x of xs) g.set(k(x), [...(g.get(k(x)) ?? []), x]);
    return g;
  };
  const p = (param.data ?? {}) as Partial<CostingParams>;
  return {
    week, batches, outputs: group(outs as unknown as OutputRow[], (o) => o.batch_id), latestRun, lines: group(lines, (l) => l.allocation_run_id),
    pools, poolLines, rates,
    keys: new Map((keys as unknown as KeyInfo[]).map((k) => [k.key, k])),
    prices: new Map((prices as Row[]).map((r) => [String(r.key), s(r.ref_sell_price)])),
    params: {
      by_product_method: p.by_product_method === "nrv" ? "nrv" : "joint", yield_gap_tolerance: s(p.yield_gap_tolerance) ?? "0.02",
      avg_lb_kg_default: s(p.avg_lb_kg_default) ?? "2", selling_cost_per_kg: s(p.selling_cost_per_kg) ?? "0",
    },
  };
}

/** Cost lines of a batch: the cost pool lines booked to it; without them, the v1 batch header (LB, freight, maklon). */
export function batchCostLines(d: CostingWeek, b: BatchRow): CostLine[] {
  const own = d.poolLines.filter((l) => l.batch_id === b.id);
  if (own.length) return own.map((l) => ({ component: l.component, amount: l.amount, pool: l.note?.startsWith("pool:") ? l.note.slice(5) : null, document_ref: l.document_ref, account: l.account }));
  const out: CostLine[] = [];
  if (b.lb_kg && b.lb_price) out.push({ component: "LB", amount: D(b.lb_kg).times(D(b.lb_price)).toFixed(2), document_ref: b.document_ref });
  if (b.freight) out.push({ component: "freight", amount: b.freight });
  if (b.maklon) out.push({ component: "maklon", amount: b.maklon });
  return out;
}

export function allocationInput(d: CostingWeek, b: BatchRow): AllocateInput {
  const outs = d.outputs.get(b.id) ?? [];
  const rate = b.cost_mode === "own" && b.date ? d.rates.find((r) => b.date! >= r.period_start && b.date! <= r.period_end) ?? null : null;
  return {
    batch: {
      ref: b.batch_ref ?? b.id, date: b.date, mode: b.cost_mode, lb_kg: b.lb_kg, processed_kg: b.processed_kg,
      head_count: b.head_count, avg_lb_kg: b.avg_lb_kg ?? (b.head_count ? d.params.avg_lb_kg_default : null),
    },
    outputs: outs.map((o) => ({
      ref: o.id, key: o.key, item_code: o.item_code, name: o.item_name, kg: o.kg,
      // Q3: the WP price list of the cut week; without it the week's reference price of the key
      price_ref: o.price_ref ?? (o.key ? d.prices.get(o.key) ?? null : null),
      by_product: !!o.key && d.keys.get(o.key)?.decision_group === "By-product",
      pools: /boneless/i.test(o.item_name ?? "") ? ["boneless"] : [],
    })),
    costLines: batchCostLines(d, b),
    overheadRate: rate ? { rate_per_kg_lb: rate.rate_per_kg_lb, rate_per_head: rate.rate_per_head, basis_kg: rate.basis_kg } : null,
    options: { byProductMethod: d.params.by_product_method, sellingCostPerKg: d.params.selling_cost_per_kg },
  };
}

/** C21–C24 for the week, from the stored allocation runs and the pools of its month(s). */
export function weekCostingControls(d: CostingWeek): ControlV3[] {
  const runs = [...d.latestRun.values()];
  return [...costingControls({
    allocations: runs.map((r) => ({ batchRef: d.batches.find((b) => b.id === r.batch_id)?.batch_ref ?? r.batch_id, diff: D(r.diff) })),
    batches: d.batches.map((b) => ({
      ref: b.batch_ref ?? b.id, status: b.status, processed_kg: b.processed_kg,
      output_kg: (d.outputs.get(b.id) ?? []).reduce((a, o) => a.plus(D(o.kg)), D(0)).toFixed(2),
      allocation_status: d.latestRun.get(b.id)?.status === "posted" ? "posted" : d.latestRun.has(b.id) ? "draft" : null,
    })),
    pools: d.pools.map((p) => computeCostPool({ lines: d.poolLines.filter((l) => l.cost_pool_id === p.id).map((l) => ({ component: l.component, amount: l.amount, batch_ref: l.batch_id })), glTotal: p.total_gl })),
    yieldGapTolerance: d.params.yield_gap_tolerance,
  }), weekC48(d)];
}

/** C48 (PRD v4 §3.5): Aktual batches of the week without SKU output; their costing cannot be posted. */
export function weekC48(d: CostingWeek): ControlV3 {
  return c48({
    batches: d.batches.map((b) => ({ ref: b.batch_ref ?? b.id, status: b.status ?? "", date: b.date })),
    outputs: d.batches.flatMap((b) => (d.outputs.get(b.id) ?? []).map((o) => ({ batch_ref: b.batch_ref ?? b.id, kg: o.kg }))),
  });
}

export function poolSummaries(d: CostingWeek) {
  return d.pools.map((p) => ({ pool: p, res: computeCostPool({ lines: d.poolLines.filter((l) => l.cost_pool_id === p.id).map((l) => ({ component: l.component, amount: l.amount, batch_ref: l.batch_id })), glTotal: p.total_gl }) }));
}

export function groupsOfWeek(d: CostingWeek) {
  const lines = [...d.latestRun.values()].flatMap((r) => (d.lines.get(r.id) ?? []).map((l) => ({ key: l.key, kg: D(l.kg), allocatedCost: D(l.allocated_cost), salesValue: D(l.sales_value) })));
  return groupCostPerKg(lines, new Map([...d.keys.values()].map((k) => [k.key, k.group_code])));
}

function runRow(b: BatchRow, r: AllocationResult, viewer: Viewer, weekId: string, rateId: string | null, method: "joint" | "nrv"): Row {
  return {
    batch_id: b.id, method: "relative_sales_value", by_product_method: method, mode: r.mode, price_list_week_id: weekId, overhead_rate_id: rateId,
    run_by: viewer.email, total_cost: toFixedString(r.totalCost, 2), overhead_cost: toFixedString(r.overheadCost, 2),
    total_allocated: toFixedString(r.totalAllocated, 2), status: "draft", issues: r.issues, engine_version: ENGINE_VERSION,
  };
}

/** Run the allocation (engine) for the batches of the week that have SKU output, store it as draft runs. */
export async function allocateWeek(sb: Supa, viewer: Viewer, week: WeekRow, batchIds?: string[]): Promise<string> {
  const d = await loadCostingWeek(sb, week);
  const targets = d.batches.filter((b) => (!batchIds || batchIds.includes(b.id)) && (d.outputs.get(b.id) ?? []).length > 0);
  if (!targets.length) return "Tidak ada batch dengan output SKU untuk dialokasikan";
  const notes: string[] = [];
  for (const b of targets) {
    const input = allocationInput(d, b);
    const r = allocateBatch(input);
    const rate = b.cost_mode === "own" && b.date ? d.rates.find((x) => b.date! >= x.period_start && b.date! <= x.period_end) : undefined;
    const old = await sb.from("allocation_run").update({ status: "superseded" }).eq("batch_id", b.id).neq("status", "superseded");
    if (old.error) throw new WriteError(`allocation_run: ${old.error.message}`);
    const ins = await sb.from("allocation_run").insert(runRow(b, r, viewer, week.id, rate?.id ?? null, d.params.by_product_method)).select("id").single();
    if (ins.error) throw new WriteError(`allocation_run: ${ins.error.message}`);
    const runId = (ins.data as { id: string }).id;
    const rows = r.lines.map((l) => ({
      allocation_run_id: runId, batch_output_sku_id: l.ref, key: l.key, item_code: l.item_code, kg: toFixedString(l.kg, 2),
      price_ref: l.priceRef === null ? null : toFixedString(l.priceRef, 4), sales_value: toFixedString(l.salesValue, 2), share: toFixedString(l.share, 8),
      allocated_cost: toFixedString(l.allocatedCost, 2), cost_per_kg: toFixedString(l.costPerKg, 4), by_product_method: l.byProductMethod,
      nrv_floor: l.nrvFloor === null ? null : toFixedString(l.nrvFloor, 4), nrv_writedown: toFixedString(l.nrvWritedown, 2),
    }));
    if (rows.length) {
      const e = await sb.from("allocation_line").insert(rows);
      if (e.error) throw new WriteError(`allocation_line: ${e.error.message}`);
    }
    const u = await sb.from("batch").update({ costing_status: "allocated" }).eq("id", b.id);
    if (u.error) throw new WriteError(`batch: ${u.error.message}`);
    notes.push(`${b.batch_ref ?? b.date}: ${r.diff.abs().lte(1) ? "OK" : `selisih ${r.diff.toFixed(0)}`}`);
  }
  return `Dialokasikan ${targets.length} batch (draft): ${notes.join(" · ")}`;
}

/** Post the latest draft runs (C24); a posted run is what the monthly release and the ledger use. */
export async function postWeek(sb: Supa, viewer: Viewer, week: WeekRow): Promise<string> {
  const d = await loadCostingWeek(sb, week);
  const drafts = [...d.latestRun.values()].filter((r) => r.status === "draft");
  const bad = drafts.filter((r) => D(r.diff).abs().gt(1));
  if (bad.length) throw new WriteError(`${bad.length} alokasi belum seimbang (C21) — perbaiki output/harga lalu alokasikan ulang`);
  // C48: a batch whose SKU output is gone cannot be posted (the database trigger allocation_run_c48 refuses it too)
  const empty = drafts.filter((r) => !(d.outputs.get(r.batch_id) ?? []).some((o) => D(o.kg).gt(0)));
  if (empty.length) throw new WriteError(`C48: batch tanpa output SKU tidak bisa diposting — ${empty.map((r) => d.batches.find((b) => b.id === r.batch_id)?.batch_ref ?? r.batch_id).join(", ")}`);
  for (const r of drafts) {
    const e = await sb.from("allocation_run").update({ status: "posted", posted_at: new Date().toISOString(), posted_by: viewer.email }).eq("id", r.id);
    if (e.error) throw new WriteError(e.error.message);
    await sb.from("batch").update({ costing_status: "posted" }).eq("id", r.batch_id);
  }
  return `Diposting: ${drafts.length} batch`;
}

async function ensurePool(sb: Supa, date: string, mode: "maklon" | "own"): Promise<string> {
  const m = monthBounds(date);
  const data = must(await sb.from("cost_pool").select("id").eq("period_start", m.start).eq("period_end", m.end).eq("mode", mode).is("deleted_at", null).maybeSingle(), "costing.cost_pool") as Row | null;
  if (data) return (data as { id: string }).id;
  const ins = await sb.from("cost_pool").insert({ period_start: m.start, period_end: m.end, mode, description: `Cost pool RPA ${m.start.slice(0, 7)} (${mode})` }).select("id").single();
  if (ins.error) throw new WriteError(`cost_pool: ${ins.error.message}`);
  return (ins.data as { id: string }).id;
}

async function refreshPoolTotals(sb: Supa, poolIds: string[]): Promise<void> {
  for (const id of [...new Set(poolIds)]) {
    const lines = await fetchAll<Row>((f, t) => sb.from("cost_pool_line").select("amount").eq("cost_pool_id", id).is("deleted_at", null).range(f, t));
    const total = lines.reduce((a, l) => a.plus(D(String(l.amount))), D(0));
    const e = await sb.from("cost_pool").update({ total_pi: total.toFixed(2) }).eq("id", id);
    if (e.error) throw new WriteError(`cost_pool: ${e.error.message}`);
  }
}

/** v1 product columns of a new WP batch (out_*), so the weekly engine sees a complete batch. */
const OUT_COL: Record<string, string> = {
  "RPA|Karkas|Fresh": "out_karkas_fresh", "RPA|Karkas|Frozen": "out_karkas_frozen", "RPA|Kepala|Fresh": "out_kepala", "RPA|Kepala|Frozen": "out_kepala",
  "RPA|Ceker|Fresh": "out_ceker", "RPA|Ceker|Frozen": "out_ceker", "RPA|Usus|Fresh": "out_usus", "RPA|Usus|Frozen": "out_usus",
  "RPA|HJA (Hati/Jantung/Ampela)|Fresh": "out_hja", "RPA|HJA (Hati/Jantung/Ampela)|Frozen": "out_hja", "RPA|Lemak|Fresh": "out_lemak", "RPA|Lemak|Frozen": "out_lemak",
};

interface WpPlanned { b: WpBatch; weekId: string | null; existingId: string | null }

async function planWp(sb: Supa, batches: WpBatch[]): Promise<{ planned: WpPlanned[]; weeks: WeekRow[]; itemKey: Map<string, string> }> {
  const weeks = await listWeeks(sb);
  const items = await fetchAll<Row>((f, t) => sb.from("item_map").select("item_code, key").is("deleted_at", null).range(f, t));
  const itemKey = new Map(items.map((i) => [String(i.item_code).toUpperCase(), String(i.key)]));
  const planned: WpPlanned[] = [];
  for (const b of batches) {
    const w = weekOfDate(weeks, b.date);
    if (!w) { planned.push({ b, weekId: null, existingId: null }); continue; }
    const ex = (await sb.from("batch").select("id, batch_ref, date, lb_kg").eq("week_id", w.id).is("deleted_at", null).is("superseded_at", null).eq("status", "Aktual")).data as Row[] | null;
    const hit = (ex ?? []).find((e) => e.batch_ref === wpBatchRef(b))
      ?? (ex ?? []).find((e) => e.date === b.date && b.lb_kg !== null && e.lb_kg !== null && D(String(e.lb_kg)).minus(D(b.lb_kg)).abs().lte("0.5"));
    planned.push({ b, weekId: w.id, existingId: hit ? String(hit.id) : null });
  }
  return { planned, weeks, itemKey };
}

registerV3Kind({
  kind: "costing_wp", module: "m1_costing", label: "WP potong per batch (Pot_ISA / Pot_AGRO)", source: "Ops",
  target: "batch, batch_output_sku, cost_pool_line", roles: ["admin", "cost_accounting"],
  description: "File costing per batch (format 202609_Data_COGS_LB.xlsx): header batch, biaya (LB, ekspedisi, potong, biaya BL) dan hasil per SKU. Batch dicocokkan per minggu (nama sheet atau tanggal + kg LB); batch baru dibuat Aktual.",
  async stage({ sb, sheets }): Promise<V3Stage> {
    const res = parseCostingWorkbook(sheets);
    const { planned, itemKey } = await planWp(sb, res.batches);
    const pb = plan0("batch", "Batch"), po = plan0("batch_output_sku", "Hasil per SKU"), pc = plan0("cost_pool_line", "Biaya batch (cost pool)");
    const unmapped = new Map<string, { code: string; name: string | null; suggested: string | null }>();
    const issues = [...res.issues];
    for (const p of planned) {
      if (!p.weekId) { issues.push(`${p.b.sheet}: minggu untuk tanggal ${p.b.date ?? "?"} belum ada — dilewati`); continue; }
      if (p.existingId) pb.updates++; else pb.inserts++;
      po.inserts += p.b.rows.length;
      pc.inserts += p.b.costs.length + (p.b.cost_bl ? 1 : 0);
      for (const r of p.b.rows) if (r.item_code && !itemKey.has(r.item_code.toUpperCase())) unmapped.set(r.item_code, { code: r.item_code, name: r.item_name, suggested: null });
    }
    pb.notes.push(`${planned.filter((p) => p.existingId).length} batch cocok dengan batch yang ada (kolom v1 tidak diubah); ${pb.inserts} batch baru`);
    if (res.skipped.length) pb.notes.push(`Sheet dilewati: ${res.skipped.join(", ")}`);
    const dates = res.batches.map((b) => b.date).filter((x): x is string => !!x).sort();
    return {
      rows: planned.filter((p) => p.weekId).map((p) => ({ target: "wp_batch", data: p.b as unknown as Row })),
      plan: [pb, po, pc], issues, note: `${res.batches.length} sheet batch terbaca`, dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null,
      sample: res.batches.slice(0, 25).map((b) => ({ sheet: b.sheet, tanggal: b.date, pemasok: b.supplier, kg_lb: b.lb_kg, hasil_potong: b.processed_kg, total_biaya: b.total_cost, baris_sku: b.rows.length })),
      unmappedItems: [...unmapped.values()],
    };
  },
  async commit({ sb, uploadId, rows }) {
    const batches = rows.filter((r) => r.target === "wp_batch").map((r) => r.data as unknown as WpBatch);
    const { planned, itemKey } = await planWp(sb, batches);
    let inserted = 0, updated = 0, deleted = 0;
    const pools: string[] = [];
    const dates: string[] = [];
    for (const p of planned) {
      if (!p.weekId) continue;
      const b = p.b;
      const ref = wpBatchRef(b);
      const lb = b.costs.find((c) => costComponentOf(c.label) === "LB");
      const fr = b.costs.filter((c) => costComponentOf(c.label) === "freight").reduce((a, c) => a.plus(D(c.amount)), D(0));
      const mk = b.costs.filter((c) => costComponentOf(c.label) === "maklon").reduce((a, c) => a.plus(D(c.amount)), D(0));
      // SKU rows aggregated per (key, item code)
      const agg = new Map<string, { key: string | null; item_code: string | null; item_name: string | null; kg: ReturnType<typeof D>; sv: ReturnType<typeof D> }>();
      for (const r of b.rows) {
        const key = r.item_code ? itemKey.get(r.item_code.toUpperCase()) ?? null : null;
        const k = `${key ?? ""}|${r.item_code ?? r.product ?? ""}`;
        const kg = D(r.kg_non_blasting).plus(D(r.kg));
        const a = agg.get(k) ?? { key, item_code: r.item_code ?? null, item_name: r.item_name ?? r.product, kg: D(0), sv: D(0) };
        a.kg = a.kg.plus(kg);
        a.sv = a.sv.plus(kg.times(D(r.price)));
        agg.set(k, a);
      }
      let batchId = p.existingId;
      if (batchId) {
        // v1 columns of a matched batch stay as PPIC entered them; only the hasil potong is filled when still empty
        const e1 = await sb.from("batch").update({ processed_kg: b.processed_kg }).eq("id", batchId).is("processed_kg", null);
        const e2 = await sb.from("batch").update({ costing_status: "uploaded" }).eq("id", batchId);
        if (e1.error || e2.error) throw new WriteError(`batch: ${(e1.error ?? e2.error)!.message}`);
        updated++;
      } else {
        const out: Row = {};
        for (const a of agg.values()) {
          const col = (a.key && OUT_COL[a.key]) || "out_other";
          out[col] = D(String(out[col] ?? 0)).plus(a.kg).toFixed(2);
        }
        const ins = await sb.from("batch").insert({
          week_id: p.weekId, date: b.date, status: "Aktual", batch_ref: ref, supplier: b.supplier, lb_kg: b.lb_kg,
          lb_price: lb && b.lb_kg && !D(b.lb_kg).isZero() ? D(lb.amount).div(D(b.lb_kg)).toFixed(4) : null,
          freight: fr.toFixed(2), maklon: mk.toFixed(2), processed_kg: b.processed_kg, source: "Ops", document_ref: lb?.pi ?? ref,
          costing_status: "uploaded", upload_id: uploadId, ...out,
        }).select("id").single();
        if (ins.error) throw new WriteError(`batch ${ref}: ${ins.error.message}`);
        batchId = (ins.data as { id: string }).id;
        inserted++;
      }
      // batch_output_sku: upsert the WP rows, soft-delete WP rows that are gone
      const keep = new Set<string>();
      const outRows = [...agg.values()].map((a) => {
        keep.add(`${a.key ?? ""}|${a.item_code ?? ""}`);
        return {
          batch_id: batchId, key: a.key, item_code: a.item_code, item_name: a.item_name, kg: a.kg.toFixed(2),
          pct_of_processed: b.processed_kg && !D(b.processed_kg).isZero() ? a.kg.div(D(b.processed_kg)).toFixed(6) : null,
          price_ref: a.kg.isZero() ? null : a.sv.div(a.kg).toFixed(4), source: "WP", upload_id: uploadId, deleted_at: null, note: null,
        };
      });
      if (outRows.length) {
        const e = await sb.from("batch_output_sku").upsert(outRows, { onConflict: "batch_id,key,item_code" });
        if (e.error) throw new WriteError(`batch_output_sku: ${e.error.message}`);
        inserted += outRows.length;
      }
      const old = mustRows(await sb.from("batch_output_sku").select("id, key, item_code, source").eq("batch_id", batchId).is("deleted_at", null), "costing.batch_output_sku") as Row[];
      // WP rows that are no longer in the file, and the reconstructed (backfill) rows the WP now replaces
      const gone = old.filter((o) => (o.source === "WP" && !keep.has(`${o.key ?? ""}|${o.item_code ?? ""}`)) || o.source === "manual").map((o) => String(o.id));
      if (gone.length) {
        for (let i = 0; i < gone.length; i += 200) {
          const e = await sb.from("batch_output_sku").update({ deleted_at: new Date().toISOString() }).in("id", gone.slice(i, i + 200));
          if (e.error) throw new WriteError(e.error.message);
        }
        deleted += gone.length;
      }
      // cost lines (Ops, document = PI ref); replaced by the PI upload of the same document (cost_pool_pi)
      if (b.date) {
        const poolId = await ensurePool(sb, b.date, "maklon");
        pools.push(poolId);
        const lines = [
          ...b.costs.map((c, i) => ({ component: costComponentOf(c.label), amount: c.amount, document_ref: c.pi ?? c.document, note: null as string | null, line_key: `${ref}|${i + 1}` })),
          ...(b.cost_bl ? [{ component: "blast" as CostComponent, amount: b.cost_bl, document_ref: null, note: "pool:boneless", line_key: `${ref}|BL` }] : []),
        ];
        const existing = mustRows(await sb.from("cost_pool_line").select("id, line_key, source").eq("batch_id", batchId).is("deleted_at", null), "costing.cost_pool_line") as Row[];
        for (const l of lines) {
          const ex = existing.find((e) => e.line_key === l.line_key);
          if (ex && ex.source === "Accurate") continue; // the PI already replaced this line
          const row = { cost_pool_id: poolId, component: l.component, date: b.date, supplier: b.supplier, document_ref: l.document_ref, amount: D(l.amount).toFixed(2), batch_id: batchId, note: l.note, line_key: l.line_key, source: "Ops", upload_id: uploadId };
          const e = ex ? await sb.from("cost_pool_line").update(row).eq("id", String(ex.id)) : await sb.from("cost_pool_line").insert(row);
          if (e.error) throw new WriteError(`cost_pool_line: ${e.error.message}`);
          if (ex) updated++; else inserted++;
        }
        dates.push(b.date);
      }
    }
    await refreshPoolTotals(sb, pools);
    return { inserted, updated, deleted, dates, message: `WP: ${planned.filter((p) => p.weekId).length} batch diproses. Lanjutkan di Input → Costing: Alokasikan.` };
  },
});

registerV3Kind({
  kind: "cost_pool_pi", module: "m1_costing", label: "Daftar PI pemasok (Accurate) → cost pool", source: "Accurate",
  target: "cost_pool_line", roles: ["admin", "cost_accounting"],
  description: "Faktur pembelian (LB, ekspedisi, maklon, TKL, sewa, listrik). PI dengan nomor yang sama dengan biaya WP menggantikannya (biaya langsung batch); PI lain menjadi biaya periode (overhead).",
  async stage({ sb, sheets }) {
    const res = parseV3Table("cost_pool_pi", sheets);
    const ok = res.rows.filter((r) => !r.issues.length);
    const docs = ok.map((r) => r.values.document_ref).filter((x): x is string => !!x);
    const ex = docs.length ? await inChunks(docs, async (c) => mustRows(await sb.from("cost_pool_line").select("document_ref, source").in("document_ref", c).is("deleted_at", null), "costing.cost_pool_line_docs")) : [];
    const p = plan0("cost_pool_line", "Cost pool (PI)");
    for (const r of ok) {
      const hit = ex.find((e) => e.document_ref === r.values.document_ref);
      if (hit) p.updates++; else p.inserts++;
    }
    p.notes.push(`${p.updates} PI menggantikan biaya WP / PI sebelumnya; ${p.inserts} baru`);
    const dates = ok.map((r) => r.values.date).filter((x): x is string => !!x).sort();
    return {
      rows: ok.map((r) => ({ target: "pi", data: r.values as Row })), plan: [p], issues: res.issues, note: `${ok.length} baris PI`,
      dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null, sample: ok.slice(0, 25).map((r) => r.values as Row), unmappedItems: [],
    };
  },
  async commit({ sb, uploadId, rows }) {
    let inserted = 0, updated = 0;
    const pools: string[] = [];
    const seen = new Map<string, number>();
    // PRD v5.1 R23: an invoice line takes the cost of an actual batch only (a Rencana batch of the same ref never
    // does); a ref without one rejects the upload before any line is written
    const refs = [...new Set(rows.map(({ data: v }) => s(v.batch_ref)).filter((x): x is string => !!x))];
    const actual = new Map((await inChunks(refs, async (c) => mustRows(await sb.from("batch").select("id, batch_ref").in("batch_ref", c).eq("status", "Aktual")
      .is("deleted_at", null).is("superseded_at", null), "batch aktual (PI)"))).map((b) => [String(b.batch_ref), String(b.id)]));
    const noBatch = refs.filter((r) => !actual.has(r));
    if (noBatch.length) throw new WriteError(`batch aktual ${noBatch.join(", ")} belum ada — upload WP batch itu dulu, lalu upload PI ini lagi`);
    for (const { data: v } of rows) {
      const doc = s(v.document_ref)!;
      const date = s(v.date)!;
      const comp = (s(v.component) && ["LB", "freight", "maklon", "labour", "overhead", "blast", "other"].includes(s(v.component)!))
        ? (s(v.component) as CostComponent) : costComponentOf(`${s(v.description) ?? ""} ${s(v.supplier) ?? ""}`);
      const n = (seen.get(doc) ?? 0) + 1;
      seen.set(doc, n);
      const ex = mustRows(await sb.from("cost_pool_line").select("id, cost_pool_id, batch_id, source, line_key").eq("document_ref", doc).is("deleted_at", null), "costing.cost_pool_line_doc") as Row[];
      const hit = ex.find((e) => e.source === "Accurate" && e.line_key === `PI|${doc}|${n}`) ?? ex.find((e) => e.source !== "Accurate") ?? null;
      let batchId = hit ? s(hit.batch_id) : null;
      if (!batchId && s(v.batch_ref)) batchId = actual.get(s(v.batch_ref)!) ?? null;
      const poolId = hit ? String(hit.cost_pool_id) : await ensurePool(sb, date, "maklon");
      pools.push(poolId);
      const row = {
        cost_pool_id: poolId, component: comp, date, supplier: s(v.supplier), account: s(v.account), document_ref: doc,
        amount: D(s(v.amount)).toFixed(2), batch_id: batchId, note: s(v.description), line_key: `PI|${doc}|${n}`, source: "Accurate", upload_id: uploadId,
      };
      const e = hit ? await sb.from("cost_pool_line").update(row).eq("id", String(hit.id)) : await sb.from("cost_pool_line").insert(row);
      if (e.error) throw new WriteError(`cost_pool_line: ${e.error.message}`);
      if (hit) updated++; else inserted++;
    }
    await refreshPoolTotals(sb, pools);
    return { inserted, updated, deleted: 0, dates: [], message: `PI: ${inserted} baru, ${updated} menggantikan biaya sebelumnya` };
  },
});
