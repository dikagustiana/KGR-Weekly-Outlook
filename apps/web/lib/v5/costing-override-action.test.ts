/**
 * PRD v5.2-A irisan A1c, R61 (Q-v5.2-30, -61): the actions of /w/[week]/input/costing — `post` (Admin, Cost Accounting) posts
 * the allocations that have a reference price on every SKU; `postOverride` (Finance, Admin) posts the ones that do not,
 * through the RPC post_allocation_override. The in-memory client plays the part of the database for the RPC only (it
 * posts what it is given, as the real function does after its checks); the checks themselves are proved on PostgreSQL in
 * test:rls (docs/v5.2/b5.md, block "A3 R61 post_allocation_override").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { memSb, type MemRow, type MemSb } from "../../test-support/mem-sb";
import { WriteError } from "../write";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let sb: MemSb = memSb();
let who = "finance";
vi.mock("@/lib/supabase", () => ({ supabaseServer: async () => sb }));
vi.mock("@/lib/modules", () => ({
  requireModuleAction: async (_key: string, roles: string[]) => {
    if (!roles.includes(who)) throw new WriteError("Peran Anda tidak boleh melakukan ini");
    return { email: `${who}@x.test`, role: who };
  },
}));
const { post, postOverride } = await import("@/app/w/[week]/input/costing/actions");

afterEach(() => { sb = memSb(); who = "finance"; });
const form = (f: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(f)) d.append(k, v); return d; };

const WEEK = { id: "w35", week_start: "2026-08-24", week_end: "2026-08-30", update_date: "2026-08-28", tb_opening_date: "2026-07-31", status: "open" };
const batch = (id: string, ref: string): MemRow => ({ id, week_id: "w35", date: "2026-08-26", status: "Aktual", batch_ref: ref, supplier: null, lb_kg: "12000", lb_price: null, freight: null, maklon: null, processed_kg: "8200", cost_mode: "maklon", head_count: null, avg_lb_kg: null, costing_status: "allocated", document_ref: null, seq: 1, deleted_at: null, superseded_at: null });
const run = (id: string, batchId: string): MemRow => ({ id, batch_id: batchId, status: "draft", diff: "0", issues: [], run_at: "2026-08-27T10:00:00+07:00", total_cost: "0", total_allocated: "0", overhead_cost: "0", run_by: null, by_product_method: "joint", mode: "maklon" });
const line = (runId: string, key: string, kg: string, price: string | null): MemRow => ({ id: `${runId}-${key}`, allocation_run_id: runId, key, item_code: null, kg, price_ref: price, sales_value: "0", share: "0", allocated_cost: "0", cost_per_kg: "0", by_product_method: "joint", nrv_floor: null, nrv_writedown: "0" });
const out = (batchId: string): MemRow[] => [{ id: `${batchId}-o`, batch_id: batchId, key: "RPA|Karkas|Fresh", item_code: null, item_name: null, kg: "5000", price_ref: "36000", source: "WP", note: null, deleted_at: null }];

/** Two batches: 126 has a price on every SKU, 127 has Lemak without one. */
const mixed = () => ({
  week: [WEEK], batch: [batch("b126", "126/PO/KGR/08/2026"), batch("b127", "127/PO/KGR/08/2026")], batch_output_sku: [...out("b126"), ...out("b127")],
  allocation_run: [run("r126", "b126"), run("r127", "b127")],
  allocation_line: [line("r126", "RPA|Karkas|Fresh", "5000", "36000.0000"), line("r126", "RPA|Lemak|Fresh", "28.8", "5000.0000"), line("r127", "RPA|Karkas|Fresh", "5000", "36000.0000"), line("r127", "RPA|Lemak|Fresh", "28.8", null)],
  sku_key: [], sku_price: [], parameter: [{ week_id: "w35" }], cost_pool: [], cost_pool_line: [], overhead_rate: [],
});
/** What post_allocation_override does once its checks have passed (the checks are the database's own). */
const rpc = { post_allocation_override: (a: MemRow, db: MemSb) => {
  const ids = a.p_run_ids as string[];
  for (const r of db.tables.allocation_run.filter((x) => ids.includes(String(x.id)))) {
    r.status = "posted"; r.issues = [...(r.issues as string[]), `override Finance: ${String(a.p_reason)}`];
    const b = db.tables.batch.find((x) => x.id === r.batch_id); if (b) b.costing_status = "posted";
  }
  return { data: ids.length };
} };

describe("R61 — the override action: Finance and Admin through the RPC, Cost Accounting not", () => {
  it("Finance posts the unpriced run through the RPC (id and reason as typed); the priced run stays a draft; allocation_run and batch are not written by the client", async () => {
    sb = memSb(mixed(), { rpc });
    who = "finance";
    const r = await postOverride({}, form({ week: "2026-08-24", reason: "harga Lemak menyusul dari pemasok" }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe("Override: 1 batch diposting tanpa harga acuan (127/PO/KGR/08/2026: RPA|Lemak|Fresh); batch tetap di bawah final");
    expect(sb.rpcCalls).toEqual([{ name: "post_allocation_override", args: { p_run_ids: ["r127"], p_reason: "harga Lemak menyusul dari pemasok" } }]);
    expect(sb.log.filter((l) => l.op !== "select" && l.op !== "rpc")).toEqual([]);
    expect(sb.tables.allocation_run.map((x) => [x.id, x.status])).toEqual([["r126", "draft"], ["r127", "posted"]]);
  });
  it("Admin may too; Cost Accounting and the other roles are refused by the action and the RPC is not called", async () => {
    sb = memSb(mixed(), { rpc });
    who = "admin";
    expect((await postOverride({}, form({ week: "2026-08-24", reason: "harga Lemak menyusul dari pemasok" }))).error).toBeUndefined();
    for (const role of ["cost_accounting", "ppic", "sales", "management", "purchasing"]) {
      sb = memSb(mixed(), { rpc });
      who = role;
      expect((await postOverride({}, form({ week: "2026-08-24", reason: "harga Lemak menyusul dari pemasok" }))).error).toBe("Peran Anda tidak boleh melakukan ini");
      expect(sb.rpcCalls).toEqual([]);
    }
  });
  it("a reason under 10 characters stops before the RPC; the database's own refusal reaches the screen word for word (K41)", async () => {
    sb = memSb(mixed(), { rpc });
    who = "finance";
    expect((await postOverride({}, form({ week: "2026-08-24", reason: "singkat" }))).error).toBe("Override posting: alasan minimal 10 karakter");
    expect(sb.rpcCalls).toEqual([]);
    const refusal = "Minggu batch 127/PO/KGR/08/2026 sudah ditutup";
    sb = memSb(mixed(), { fail: { "rpc:post_allocation_override": { message: refusal, code: "42501" } } });
    expect((await postOverride({}, form({ week: "2026-08-24", reason: "harga Lemak menyusul dari pemasok" }))).error).toBe(refusal);
    expect(sb.tables.allocation_run.map((x) => x.status)).toEqual(["draft", "draft"]);
  });
});

describe("R61 — the normal posting: complete prices only; the override is not a way around it", () => {
  it("Cost Accounting posts the run with a complete price (two writes, no RPC) and is told which run is held; Finance has no normal posting", async () => {
    sb = memSb(mixed(), { rpc });
    who = "cost_accounting";
    const r = await post({}, form({ week: "2026-08-24" }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe("Diposting: 1 batch; ditahan karena harga acuan kosong: 127/PO/KGR/08/2026: RPA|Lemak|Fresh (override Finance atau Admin dengan alasan)");
    expect(sb.rpcCalls).toEqual([]);
    expect(sb.tables.allocation_run.map((x) => [x.id, x.status])).toEqual([["r126", "posted"], ["r127", "draft"]]);
    expect(sb.tables.batch.map((x) => [x.id, x.costing_status])).toEqual([["b126", "posted"], ["b127", "allocated"]]);
    sb = memSb(mixed(), { rpc });
    who = "finance";
    expect((await post({}, form({ week: "2026-08-24" }))).error).toBe("Peran Anda tidak boleh melakukan ini");
  });
  it("a week with only unpriced runs is refused by the normal posting, naming batch and SKU; nothing is written", async () => {
    const m = mixed();
    sb = memSb({ ...m, batch: [m.batch[1]], allocation_run: [m.allocation_run[1]], allocation_line: m.allocation_line.slice(2) }, { rpc });
    who = "cost_accounting";
    const r = await post({}, form({ week: "2026-08-24" }));
    expect(r.error).toBe("Belum bisa diposting: harga acuan kosong — 127/PO/KGR/08/2026: RPA|Lemak|Fresh — isi harga lalu alokasikan ulang (atau override Finance/Admin dengan alasan)");
    expect(sb.log.filter((l) => l.op !== "select")).toEqual([]);
  });
});
