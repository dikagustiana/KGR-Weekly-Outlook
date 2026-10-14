/**
 * Generates supabase/seed/*.sql from fixtures/week-<start>/ (I_Master, I_Item, I_COA, parameters and the example week).
 * Usage: tsx scripts/seed-sql.ts [weekStart] [adminEmail]
 * Files are split in chunks so they can be applied through the Supabase SQL editor or MCP.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const week = process.argv[2] ?? "2026-08-24";
const admin = (process.argv[3] ?? "").toLowerCase();
const dir = join(root, "fixtures", `week-${week}`);
const out = join(root, "supabase", "seed");
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith(".sql")) unlinkSync(join(out, f));

const J = <T>(n: string): T => JSON.parse(readFileSync(join(dir, n), "utf8")) as T;
type Row = Record<string, unknown>;

const q = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};
/** Deterministic UUID from a name (v5-style layout over sha1) so re-running the seed is idempotent. */
const uuid = (name: string) => {
  const h = createHash("sha1").update(`kgr-weekly-outlook:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
};
const weekId = uuid(`week:${week}`);

function insert(table: string, cols: string[], rows: unknown[][], conflict = "on conflict do nothing"): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += 400) {
    const part = rows.slice(i, i + 400).map((r) => `(${r.map(q).join(", ")})`).join(",\n");
    chunks.push(`insert into public.${table} (${cols.join(", ")}) values\n${part}\n${conflict};\n`);
  }
  return chunks;
}

const files: [string, string][] = [];
const add = (name: string, sql: string[]) => sql.forEach((s, i) => files.push([`${name}${sql.length > 1 ? `_${String(i + 1).padStart(2, "0")}` : ""}.sql`, s]));

// 01 users
if (admin) {
  add("01_app_user", [`insert into public.app_user (email, full_name, role) values (${q(admin)}, 'Admin (Group Project Finance)', 'admin') on conflict (email) do update set role = 'admin', active = true;\n`]);
}

// 02 master data
const sku = J<Row[]>("sku_keys.json");
add("02_sku_key", insert("sku_key", ["key", "segment", "sku", "form", "decision_group", "sort_order", "note"],
  sku.map((s, i) => [s.key, s.segment, s.sku, s.form, s.decision_group, i + 1, s.note]),
  "on conflict (key) do update set decision_group = excluded.decision_group, sort_order = excluded.sort_order"));
const items = J<Row[]>("item_map.json");
add("03_item_map", insert("item_map", ["item_code", "item_name", "key"], items.map((i) => [i.item_code, i.item_name, i.key]),
  "on conflict (item_code) do update set item_name = excluded.item_name, key = excluded.key"));
const coa = J<Row[]>("coa_map.json");
add("04_coa_map", insert("coa_map", ["account", "name", "type", "pl_line", "bs_line", "cf_category_as_counter", "is_cash", "fs_mapping_reference"],
  coa.map((c) => [c.account, c.name, c.type, c.pl_line, c.bs_line, c.cf_category_as_counter, c.is_cash, c.fs_mapping_reference]),
  "on conflict (account) do nothing"));

// 05 week + parameters + prices + run-rate
const w = J<Row>("week.json");
const p = J<Row & { yield_default: Row; last_week: Record<string, Row> }>("parameters.json");
const lw = p.last_week;
add("05_week", [
  `insert into public.week (id, week_start, update_date, tb_opening_date, lw_rpa_kg, lw_rpa_revenue, lw_rpa_gp, lw_trading_kg, lw_trading_revenue, lw_trading_gp, lw_source, note) values (${[
    weekId, w.week_start, w.update_date, w.tb_opening_date, lw.RPA.kg, lw.RPA.revenue, lw.RPA.gp, lw.Trading.kg, lw.Trading.revenue, lw.Trading.gp,
    "I_Parameter (contoh 17–23 Agu dari DO Accurate × harga rata-rata Agustus)", "Contoh minggu dari reference/KGR_Weekly_Outlook.xlsx",
  ].map(q).join(", ")}) on conflict (week_start) do nothing;\n` +
  `insert into public.parameter (week_id, horizon_fresh_days, target_shrink, freight_plan_per_kg_lb, maklon_per_kg_processed, lb_price_today, min_trading_spread, stock_age_limit_days, terms_lb_days, terms_trading_days, terms_freight_maklon_days, yield_karkas, yield_kepala, yield_ceker, yield_usus, yield_hja, yield_lemak, accurate_sales_kg, accurate_opening_stock_value, placeholder_note) values (${[
    weekId, p.horizon_fresh_days, p.target_shrink, p.freight_plan_per_kg_lb, p.maklon_per_kg_processed, p.lb_price_today, p.min_trading_spread,
    p.stock_age_limit_days, p.terms_lb_days, p.terms_trading_days, p.terms_freight_maklon_days, p.yield_default.karkas, p.yield_default.kepala,
    p.yield_default.ceker, p.yield_default.usus, p.yield_default.hja, p.yield_default.lemak, p.accurate_sales_kg, p.accurate_opening_stock_value,
    "PLACEHOLDER (PRD §11, docs/open-questions.md B1–B8): spread minimum Rp 2.000/kg, termin LB 7 / trading 14 / angkut-maklon 30 hari, horizon 3 hari, target shrink 3%, batas umur stok 30 hari",
  ].map(q).join(", ")}) on conflict (week_id) do nothing;\n`,
]);
add("06_sku_price", insert("sku_price", ["week_id", "key", "ref_sell_price", "replacement_buy_price", "note"],
  sku.map((s) => [weekId, s.key, s.ref_sell_price, s.replacement_buy_price, s.note]), "on conflict (week_id, key) do nothing"));
const rr = J<Row[]>("runrate.json");
add("07_runrate", insert("runrate", ["week_id", "pl_line", "monthly_amount", "week_adjustment", "basis", "seq"],
  rr.map((r, i) => [weekId, r.pl_line, r.monthly_amount, r.week_adjustment, r.basis, i + 1]), "on conflict (week_id, pl_line) do nothing"));

// 08+ input rows (ids are deterministic so the seed can be re-applied)
const os = J<Row[]>("opening_stock.json");
add("08_opening_stock", insert("opening_stock", ["id", "week_id", "seq", "item_code", "item_name", "kg", "value", "avg_age_days", "kg_over_age_limit", "note", "source", "document_ref"],
  os.map((r, i) => [uuid(`os:${week}:${r.row}`), weekId, i + 1, r.item_code, r.item_name, r.kg, r.value, r.avg_age_days, r.kg_over_age_limit, r.note, "Accurate", "Inventory Valuation 23 Agu 2026"])));
const sl = J<Row[]>("sales_lines.json");
add("09_sales_line", insert("sales_line", ["id", "week_id", "seq", "date", "status", "document_ref", "customer", "item_code", "key_manual", "kg", "price", "hpp_actual", "source"],
  sl.map((r, i) => [uuid(`sl:${week}:${r.row}`), weekId, i + 1, r.date, r.status, r.document_ref, r.customer, r.item_code, r.key_manual, r.kg, r.price, r.hpp_actual,
    r.status === "Aktual" ? "Accurate" : "Manual"])));
const rl = J<Row[]>("receipt_lines.json");
add("10_receipt_line", insert("receipt_line", ["id", "week_id", "seq", "date", "status", "receipt_source", "document_ref", "supplier", "item_code", "key_manual", "kg", "unit_cost", "source"],
  rl.map((r, i) => [uuid(`rl:${week}:${r.row}`), weekId, i + 1, r.date, r.status, r.receipt_source, r.document_ref, r.supplier, r.item_code, r.key_manual, r.kg, r.unit_cost,
    r.status === "Aktual" ? "Accurate" : "Manual"])));
const bt = J<(Row & { output: Row })[]>("batches.json");
add("11_batch", insert("batch", ["id", "week_id", "seq", "date", "status", "batch_ref", "supplier", "lb_kg", "lb_price", "freight", "maklon", "processed_kg",
  "out_karkas_fresh", "out_karkas_frozen", "out_kepala", "out_ceker", "out_usus", "out_hja", "out_lemak", "out_other", "source", "document_ref"],
  bt.map((b, i) => [uuid(`bt:${week}:${b.row}`), weekId, i + 1, b.date, b.status, b.batch_ref, b.supplier, b.lb_kg, b.lb_price, b.freight, b.maklon, b.processed_kg,
    b.output.karkas_fresh, b.output.karkas_frozen, b.output.kepala, b.output.ceker, b.output.usus, b.output.hja, b.output.lemak, b.output.other,
    b.status === "Aktual" ? "Ops" : "Manual", b.batch_ref])));
const gl = J<Row[]>("gl_lines.json");
add("12_gl_line", insert("gl_line", ["id", "seq", "date", "voucher_no", "voucher_type", "account", "account_name", "description", "debit", "credit", "party", "cf_override", "line_key", "source"],
  gl.map((g, i) => [uuid(`gl:${g.row}`), i + 1, g.date, g.voucher_no, g.voucher_type, g.account, g.account_name, g.description, g.debit, g.credit, g.party, g.cf_override,
    `${g.voucher_no}|${i + 1}`, "Accurate"])));
const tb = J<Row[]>("tb_opening.json");
add("13_tb_opening", insert("tb_opening", ["id", "week_id", "seq", "account", "name", "balance", "source"],
  tb.map((t, i) => [uuid(`tb:${week}:${t.row}`), weekId, i + 1, t.account, t.name, t.balance, "Accurate"])));
const cp = J<Row[]>("cash_plan.json");
add("14_cash_plan", insert("cash_plan", ["id", "week_id", "seq", "date", "cf_category", "bs_counter_line", "description", "amount", "source"],
  cp.map((c, i) => [uuid(`cp:${week}:${c.row}`), weekId, i + 1, c.date, c.cf_category, c.bs_counter_line, c.description, c.amount, "Manual"])));

for (const [name, sql] of files) writeFileSync(join(out, name), `-- generated by scripts/seed-sql.ts from fixtures/week-${week}\n` + sql);
console.log(`week id ${weekId}; wrote ${files.length} files to supabase/seed/`);
for (const [name, sql] of files) console.log(`${name}\t${sql.length}`);
