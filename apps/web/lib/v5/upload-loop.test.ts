/**
 * PRD v5.2-A R58 (A-UI-11, B-REL-1) and R54 (WP) through saveUploadV5 with the in-memory client: a Sales PO upload never touches
 * a line outside the rep's assignment rows (customer and key together, O21(b)); a WP whose rows are held is judged by C22 on
 * what is saved, a held line keeps its old row; the upload is committed even when the work after the save fails.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { validateUpload, type Grid } from "@kgr/engine";
import { memSb, type MemRow, type MemSb } from "../../test-support/mem-sb";
import { WEEK, planSeed } from "../../test-support/plan-seed";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/modules", () => ({ moduleSettings: async () => ({}) }));
const { saveUploadV5 } = await import("./input-save");
const { uploadContext } = await import("./input-data");

let sb: MemSb = memSb();
const NOW = (iso: string) => { process.env.KGR_TEST_NOW = iso; };
beforeAll(() => NOW("2026-08-27T09:00:00+07:00"));
afterEach(() => { sb = memSb(); vi.restoreAllMocks(); });

const sales = { email: "sales@x.test", role: "sales" } as never;
const ctxViewer = { email: "cost@x.test", role: "cost_accounting" } as never;
const rpc = { advance_update_date: () => ({ data: "2026-08-27" }) };

async function save(viewer: never, kind: "po_lines" | "costing_wp", grid: Grid, reason = "") {
  const ctx = await uploadContext(sb as never, viewer, kind);
  const preview = validateUpload(kind, grid, ctx);
  return saveUploadV5(sb as never, viewer, { kind, grid, fingerprint: preview.fingerprint, fileName: `${kind}.xlsx`, reason });
}

describe("R58 — a Sales PO upload leaves other reps' lines alone", () => {
  const line = (id: string, customer: string, item: string, n: number, kg = "100.00"): MemRow => ({
    id, status: "Order", po_ref: "PO-1", customer, item_code: item, key_manual: null, kg, line_key: `PO-1|${item}|${n}`, deleted_at: null, superseded_at: null, delivery_date: "2026-08-28", date: "2026-08-28",
  });
  const tables = () => planSeed({
    item_map: [
      { item_code: "JLB0829", item_name: "Karkas Uk 1.3 Fresh", key: "RPA|Karkas|Fresh", size_kg: null, deleted_at: null },
      { item_code: "JLB0300", item_name: "Karkas Frozen", key: "RPA|Karkas|Frozen", size_kg: null, deleted_at: null },
      { item_code: "JLB0001", item_name: "Sayap Fresh", key: "RPA|Sayap|Fresh", size_kg: null, deleted_at: null },
    ],
    sales_assignment: [{ id: "a1", sales_rep: "Rep A", email: "sales@x.test", customer: "PT A", key: "RPA|Karkas", active: true }],
    sales_line: [
      line("L1", "PT A", "JLB0829", 1), line("L2", "PT A", "JLB0829", 2),   // the rep's: L1 is in the file, L2 is no longer in it
      line("L3", "PT A", "JLB0001", 1),                                    // same PO and customer, a SKU of another rep
      line("L4", "PT B", "JLB0829", 1),                                    // same PO, another customer
      line("L5", "PT A", "JLB0300", 1),                                    // a frozen SKU under the base key "RPA|Karkas" (covers both forms): the rep's
    ],
  });
  const grid = (...rows: Grid): Grid => [["no_po", "tanggal_kirim", "kode_item", "kg", "harga", "pelanggan"], ...rows];

  it("only L1 is updated and the lines of the rep that left the file (L2, L5) are retired; L3 (other SKU) and L4 (other customer) are untouched", async () => {
    sb = memSb(tables());
    const msg = await save(sales, "po_lines", grid(["PO-1", "2026-08-28", "JLB0829", 500, 36705, "PT A"]));
    expect(msg).toContain("1 dari 1 baris lolos cek; 0 baru, 1 diubah");
    const by = (id: string) => sb.tables.sales_line.find((l) => l.id === id)!;
    expect(by("L1")).toMatchObject({ kg: "500.00", deleted_at: null });
    expect(by("L2").deleted_at).toBeTruthy();
    expect(by("L5").deleted_at).toBeTruthy();
    expect(by("L3")).toMatchObject({ kg: "100.00", deleted_at: null });
    expect(by("L4")).toMatchObject({ kg: "100.00", deleted_at: null });
    // writes: the update of L1 first, the retirement of the gone lines after; never a write that names L3 or L4
    const ops = sb.log.filter((l) => l.table === "sales_line" && (l.op === "update" || l.op === "insert"));
    expect(ops.map((o) => `${o.op}:${o.filters.join("|")}`)).toEqual(["update:eq id L1", "update:in id [L2,L5]"]);
  });
  it("a line of a SKU the rep is not assigned to is held by the validation itself (no half-written PO)", async () => {
    sb = memSb(tables());
    const grid2 = grid(["PO-1", "2026-08-28", "JLB0829", 500, 36705, "PT A"], ["PO-1", "2026-08-28", "JLB0001", 40, 30000, "PT A"]);
    const ctx = await uploadContext(sb as never, sales, "po_lines");
    const r = validateUpload("po_lines", grid2, ctx);
    expect(r.ok_count).toBe(1);
    expect(r.rows[1].action).toBe("PT A · RPA|Sayap|Fresh tidak ditugaskan kepada Anda");
    expect(r.checks.find((c) => c.code === "K32")).toMatchObject({ title: "Pelanggan dan SKU sesuai assignment", level: "fail" });
  });
  it("an assignment key with a form suffix covers only that exact key (O21(b)): RPA|Karkas|Fresh does not cover the frozen SKU", async () => {
    sb = memSb({ ...tables(), sales_assignment: [{ id: "a1", sales_rep: "Rep A", email: "sales@x.test", customer: "PT A", key: "RPA|Karkas|Fresh", active: true }] });
    const ctx = await uploadContext(sb as never, sales, "po_lines");
    const r = validateUpload("po_lines", grid(["PO-1", "2026-08-28", "JLB0829", 500, 36705, "PT A"], ["PO-1", "2026-08-28", "JLB0300", 50, 31000, "PT A"]), ctx);
    expect(r.records.map((x) => x.level !== "fail")).toEqual([true, false]);
    await save(sales, "po_lines", grid(["PO-1", "2026-08-28", "JLB0829", 500, 36705, "PT A"]));
    // L5 (frozen) is outside the exact-key assignment: it is not retired as "gone"
    expect(sb.tables.sales_line.find((l) => l.id === "L5")?.deleted_at).toBeNull();
    expect(sb.tables.sales_line.find((l) => l.id === "L2")?.deleted_at).toBeTruthy();
  });
  it("the commercial lead (all) sees every line of the PO × customer pairs in the file, as before", async () => {
    sb = memSb(tables());
    await save({ email: "lead@x.test", role: "commercial_lead" } as never, "po_lines", grid(["PO-1", "2026-08-28", "JLB0829", 500, 36705, "PT A"]));
    expect(["L2", "L3", "L5"].map((id) => !!sb.tables.sales_line.find((l) => l.id === id)?.deleted_at)).toEqual([true, true, true]);
    expect(sb.tables.sales_line.find((l) => l.id === "L4")?.deleted_at).toBeNull();
  });
});

describe("R58 — C22 on what is saved; R54 — the H+1 date of a WP is queued", () => {
  const wp = (valid: number, held: number): Grid => [["batch", "kg_lb", "ekor", "kode_item", "kg"], ["B260826", 10000, 5000, "JLB0829", valid], ["B260826", "", "", "X-HATI", held]];
  const tables = (old: MemRow[] = []) => planSeed({
    item_map: [{ item_code: "JLB0829", item_name: "Karkas Uk 1.3 Fresh", key: "RPA|Karkas|Fresh", size_kg: null, deleted_at: null }],
    batch: [{ id: "b1", week_id: WEEK.id, batch_ref: "B260826", date: "2026-08-26", status: "Aktual", lb_kg: null, deleted_at: null, superseded_at: null }],
    batch_output_sku: old, input_task_rule: [{ kind: "costing_wp", due_rule: "batch.date + 1 day 12:00", active: true }],
  });
  const oldWp = (code: string, key: string | null, kg: string, id = code): MemRow => ({ id, batch_id: "b1", key, item_code: code, kg, source: "WP", deleted_at: null });

  it("WP_HELD_MASS: 6.000 of 9.700 saved (the rest held) → C22 GAGAL; without a reason nothing is written", async () => {
    sb = memSb(tables(), { rpc });
    await expect(save(ctxViewer, "costing_wp", wp(6000, 3600))).rejects.toThrow(/Batch B260826: selisih hasil potong di atas toleransi C22/);
    expect(sb.log.filter((l) => l.table === "batch_output_sku" && l.op !== "select")).toEqual([]);
    const ctx = await uploadContext(sb as never, ctxViewer, "costing_wp");
    expect(validateUpload("costing_wp", wp(6000, 3600), ctx).checks.find((c) => c.code === "C22")).toMatchObject({ level: "fail", detail: "6.000,0 vs 9.700,0 kg (LB − susut 3%), selisih 38,1% (batas 2%)" });
  });
  it("with a reason it is saved, flagged; a held line keeps its old row and that old output is what C22 counted", async () => {
    sb = memSb(tables([oldWp("X-HATI", null, "3600.00"), oldWp("OLD-GONE", "RPA|Karkas|Fresh", "10.00")]), { rpc });
    const ctx = await uploadContext(sb as never, ctxViewer, "costing_wp");
    // 6.000 passes + the old 3.600 of the held X-HATI line = 9.600 vs 9.700 expected: inside the tolerance, no reason needed
    expect(validateUpload("costing_wp", wp(6000, 3600), ctx).checks.find((c) => c.code === "C22")).toMatchObject({ level: "ok" });
    const msg = await save(ctxViewer, "costing_wp", wp(6000, 3600));
    expect(msg).toContain("1 dari 2 baris lolos cek");
    const by = (code: string) => sb.tables.batch_output_sku.find((o) => o.item_code === code)!;
    expect(by("X-HATI").deleted_at).toBeNull();          // held in the file: its old row stays
    expect(by("OLD-GONE").deleted_at).toBeTruthy();      // not in the file at all: retired after the new rows were written
    expect(by("JLB0829")).toMatchObject({ kg: "6000.00", source: "WP" });
    // the new rows were written before the old ones were retired
    const wps = sb.log.filter((l) => l.table === "batch_output_sku" && (l.op === "upsert" || l.op === "update"));
    expect(wps.map((l) => l.op)).toEqual(["upsert", "update"]);
  });
  it("R54: the day after the batch (H+1) is queued with the batch date — the grid cell of the WP task is refreshed", async () => {
    NOW("2026-08-26T09:00:00+07:00");   // data date 26 Aug: the due date 27 Aug is after it and queues itself
    try {
      sb = memSb(tables(), { rpc });
      await save(ctxViewer, "costing_wp", [["batch", "kg_lb", "ekor", "kode_item", "kg"], ["B260826", 10000, 5000, "JLB0829", 9650]]);
      expect((sb.calls("rebuild_queue:insert")[0].payload as MemRow[]).map((r) => r.date)).toEqual(["2026-08-26", "2026-08-27"]);
    } finally { NOW("2026-08-27T09:00:00+07:00"); }
  });
  it("what follows the save does not turn a saved upload into a failed one: the queue error is in the message, the upload is committed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sb = memSb(tables(), { rpc, fail: { "rebuild_queue:insert": "canceling statement due to statement timeout" } });
    const msg = await save(ctxViewer, "costing_wp", [["batch", "kg_lb", "ekor", "kode_item", "kg"], ["B260826", 10000, 5000, "JLB0829", 9650]]);
    expect(msg).toContain("Data tersimpan, tetapi langkah sesudahnya gagal");
    expect(sb.tables.upload[0]).toMatchObject({ status: "committed" });
  });
});
