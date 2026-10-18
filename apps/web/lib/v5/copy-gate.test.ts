/**
 * PRD v5.2-A R51 (K58, one gate for every copy) and R52 (the batches are the saved plan_week_class), through the actions
 * with the in-memory client: the v4 and the v5 action refuse with the same blockers the pages show, C57 holds without a
 * reason, C58 only for a caller whose v5_ppic_class is on, the batch numbers after the copy equal the saved class rows.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { D } from "@kgr/engine";
import { memSb, type MemRow, type MemSb } from "../../test-support/mem-sb";
import { WEEK, flag, planSeed, po } from "../../test-support/plan-seed";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let sb: MemSb = memSb();
let on: Record<string, boolean> = {};
vi.mock("@/lib/supabase", () => ({ supabaseServer: async () => sb }));
vi.mock("@/lib/modules", () => ({
  requireModuleAction: async (key: string) => { if (!on[key]) throw new Error(`Modul ${key} belum aktif`); return { email: "ppic@x.test", role: "ppic" }; },
  moduleEnabled: async (key: string) => !!on[key],
}));
const { copyPlanAction, copyClassPlanAction, reasonAction } = await import("@/app/w/[week]/rencana/actions");
const { copyGate } = await import("./copy-plan");
const { loadPlanning } = await import("../v3/planning");
const { loadPpicV5 } = await import("./ppic-data");
const { ppicV5Model } = await import("./ppic");
const { stockMartControl } = await import("../v3/stale");

afterEach(() => { sb = memSb(); on = {}; });
const form = (f: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(f)) d.append(k, v); return d; };
const A = "11111111-1111-4111-8111-111111111111";

const DAYS = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];
const capacity = DAYS.map((date) => ({ date, cut_capacity_head: 5000, chiller_kg: null, abf_kg: null }));
const decision = (date: string, price: string, cls: string | null = null, at = "2026-08-26T09:00:00Z"): MemRow => ({ id: `d-${date}-${cls}`, date, weight_class: cls, price, decided_at: at });
const plan = (extra: MemRow = {}): MemRow => ({ id: "P1", week_start: "2026-08-24", version: 1, weight_class: "STD", head_count: 100, needs_approval: false, approved_by: null, copied_to_batch_at: null, deleted_at: null, created_at: "2026-08-26T08:00:00Z", ...extra });

/** A v4 plan (no class rows): two plan days. Only Karkas has a yield, so the units add no C46 surplus. */
function v4Tables(extra: Record<string, MemRow[]> = {}) {
  return planSeed({
    yield_matrix: [{ weight_class: "STD", cut_pattern: "karkas", key: "Karkas", yield_pct: "0.7146", effective_from: "2026-01-01", effective_to: null, note: null, deleted_at: null }],
    capacity, sku_balance_daily: [{ date: "2026-08-23", key: "RPA|Karkas|Fresh", free_kg: "10" }],
    plan_week: [plan()],
    plan_day: [{ id: "pd1", plan_week_id: "P1", date: "2026-08-27", head_count: 60, weight_class: "STD", cut_pattern: "karkas", supplier: "CV X" }, { id: "pd2", plan_week_id: "P1", date: "2026-08-28", head_count: 40, weight_class: "STD", cut_pattern: "karkas", supplier: null }],
    sales_line: [po(A, "JLB0829", "1000", "2026-08-28")],
    ...extra,
  });
}

describe("R51 — the v4 copy goes through the same gate (K58)", () => {
  it("v5_costing on, no LB decision for the cut dates: copyPlanAction refuses with C57 and writes nothing", async () => {
    on = { m3_planning: true };
    sb = memSb(v4Tables({ app_setting: [flag("v5_costing")] }));
    const r = await copyPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }));
    expect(r.error).toBe("Belum bisa disalin ke batch: C57 BELUM DIISI (2026-08-27 STD, 2026-08-28 STD)");
    expect(sb.calls("batch:insert")).toHaveLength(0);
    expect(sb.calls("batch:update")).toHaveLength(0);
    expect(sb.calls("plan_week:update")).toHaveLength(0);
  });
  it("a written reason does not open C57 (§7: only the operations director's decision does)", async () => {
    on = { m3_planning: true };
    sb = memSb(v4Tables({ app_setting: [flag("v5_costing")], plan_check_reason: [{ id: "r1", week_start: "2026-08-24", code: "C57", reason: "harga menyusul", created_at: "2026-08-26T10:00:00Z", deleted_at: null }] }));
    expect((await copyPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }))).error).toContain("C57 BELUM DIISI");
  });
  it("with the decision for all classes the copy runs, the batch takes that LB price, the new batches are written before the old copy is retired", async () => {
    on = { m3_planning: true };
    sb = memSb(v4Tables({
      app_setting: [flag("v5_costing")], lb_price_decision: [decision("2026-08-27", "24500"), decision("2026-08-28", "24800")],
      batch: [{ id: "old1", week_id: WEEK.id, status: "Rencana", batch_ref: "PLAN-2026-08-24-v0-2026-08-27", deleted_at: null }],
    }));
    const r = await copyPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toContain("2 batch rencana ditulis");
    expect(r.ok).toContain("harga LB: keputusan semua kelas 2");
    const rows = sb.calls("batch:insert")[0].payload as MemRow[];
    expect(rows.map((b) => [b.date, b.head_count, b.lb_price])).toEqual([["2026-08-27", 60, "24500.0000"], ["2026-08-28", 40, "24800.0000"]]);
    expect(sb.log.findIndex((l) => l.call === "batch:insert")).toBeLessThan(sb.log.findIndex((l) => l.call === "batch:update"));
    expect(sb.tables.batch.find((b) => b.id === "old1")?.deleted_at).toBeTruthy();
    expect(sb.tables.plan_week[0].copied_to_batch_at).toBeTruthy();
  });
  it("v5_costing off: no C57, the price is the supply / parameter price as before", async () => {
    on = { m3_planning: true };
    sb = memSb(v4Tables());
    const r = await copyPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }));
    expect(r.error).toBeUndefined();
    expect((sb.calls("batch:insert")[0].payload as MemRow[]).map((b) => b.lb_price)).toEqual(["24000.0000", "24000.0000"]);
  });
  it("the downgrade approval is part of the gate", async () => {
    on = { m3_planning: true };
    sb = memSb(v4Tables({ plan_week: [plan({ needs_approval: true })] }));
    expect((await copyPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }))).error).toBe("Belum bisa disalin ke batch: Persetujuan downgrade belum diberikan");
    sb = memSb(v4Tables({ plan_week: [plan({ needs_approval: true, approved_by: "fin@x.test" })] }));
    expect((await copyPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }))).error).toBeUndefined();
  });
  it("C58 never holds the v4 path while v5_ppic_class is off for the caller; with it on, the same data is held by C58", async () => {
    on = { m3_planning: true };
    sb = memSb(v4Tables());
    expect((await copyPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }))).error).toBeUndefined();
    // the same plan, v5_ppic_class on for the caller, the class need has no supply → C58 BELUM DIISI holds the v4 action too
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb(v4Tables());
    expect((await copyPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }))).error).toContain("C58 BELUM DIISI");
  });
  it("action and pages give the same blockers: the v4 action text, the v5 action text and the daily-plan tile of the v5 page", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    const tables = v4Tables({ app_setting: [flag("v5_costing")] });
    sb = memSb(tables);
    const week = WEEK as never;
    const src = await loadPlanning(sb as never, week);
    const c45 = await stockMartControl(sb as never, "2026-08-23");
    const v5 = await copyGate({ sb: sb as never, week, planId: "P1", classOn: true, src, c45 });
    const v4 = await copyGate({ sb: sb as never, week, planId: "P1", classOn: false, src, c45 });
    expect(v5.blockers.some((b) => b.startsWith("C58 "))).toBe(true);
    expect(v4.blockers.some((b) => b.startsWith("C58 "))).toBe(false);
    expect((await copyClassPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }))).error).toBe(`Belum bisa disalin ke batch: ${v5.blockers.join(", ")}`);
    on = { m3_planning: true };
    expect((await copyPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }))).error).toBe(`Belum bisa disalin ke batch: ${v4.blockers.join(", ")}`);
    const input = await loadPpicV5(sb as never, { src, result: { block2: { lbPlannedInHorizon: "0" }, block6: null } as never, base: "/w/x", versi: "need", canPlan: true, c45, gate: { ok: v5 } });
    expect(input.copyBlockers).toEqual(v5.blockers);
    const tile = JSON.stringify(ppicV5Model(input).tiles.find((t) => t.id === "t-harian"));
    expect(tile).toContain(`Belum bisa salin ke batch rencana: ${v5.blockers.join(", ")}`);
  });
});

describe("R51 — a C58 reason belongs to the plan version", () => {
  const unsupplied = () => v4Tables({ plan_check_reason: [{ id: "r1", week_start: "2026-08-24", code: "C58", reason: "supply menyusul dari CV X", created_at: "2026-08-26T10:00:00Z", deleted_at: null }] });
  it("a reason written after the plan version was saved opens C58", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb(unsupplied());
    const g = await copyGate({ sb: sb as never, week: WEEK as never, planId: "P1", classOn: true });
    expect(g.blockers).toEqual([]);
    expect(g.c58Reason).toBe("supply menyusul dari CV X");
  });
  it("a reason older than the plan version does not: a newer version needs its own reason", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb({ ...unsupplied(), plan_week: [plan({ created_at: "2026-08-26T12:00:00Z" })] });
    const g = await copyGate({ sb: sb as never, week: WEEK as never, planId: "P1", classOn: true });
    expect(g.blockers).toEqual(["C58 BELUM DIISI"]);
    expect(g.c58Reason).toBeNull();
  });
  it("reasonAction retires the stale C58 reason and writes the new one; a valid one is not written twice", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb({ ...unsupplied(), plan_week: [plan({ created_at: "2026-08-26T12:00:00Z" })] });
    const ok = await reasonAction({}, form({ week: "2026-08-24", code: "C58", reason: "supply versi 2 menyusul" }));
    expect(ok.ok).toBe("Alasan C58 disimpan");
    expect(sb.tables.plan_check_reason.filter((r) => !r.deleted_at).map((r) => r.reason)).toEqual(["supply versi 2 menyusul"]);
    expect(sb.tables.plan_check_reason.find((r) => r.id === "r1")?.deleted_at).toBeTruthy();
    // a C57 reason is refused as before
    expect((await reasonAction({}, form({ week: "2026-08-24", code: "C57", reason: "harga menyusul" }))).error).toContain("C57 tidak bisa diberi alasan");
  });
});

describe("R52 — the batch numbers after the copy are the saved plan_week_class (K / S / B, two dates)", () => {
  // two ship dates (27, 28 Aug → cut 26, 27 Aug); sizes 0,9 (K), 1,3 (S), 1,5 (B)
  const lines = [
    po("a1", "JLB0092", "100", "2026-08-27"), po("a2", "JLB0092", "60", "2026-08-28"), po("b1", "JLB0829", "700", "2026-08-27"), po("b2", "JLB0829", "300", "2026-08-28"),
    po("c1", "JLB0922", "400", "2026-08-27"), po("c2", "JLB0922", "200", "2026-08-28"),
  ];
  const saved: MemRow[] = [
    { id: "k", plan_week_id: "P1", weight_class: "K", cut_pattern: "karkas", kg_lb: "230.00", heads: 120 },
    { id: "s", plan_week_id: "P1", weight_class: "S", cut_pattern: "karkas", kg_lb: "1389.00", heads: 801 },
    { id: "b", plan_week_id: "P1", weight_class: "B", cut_pattern: "karkas", kg_lb: "811.00", heads: 407 },
  ];
  const supply: MemRow[] = ["2026-08-26", "2026-08-27"].flatMap((date) => ["K", "S", "B"].map((c) => ({ id: `s-${date}-${c}`, date, supplier: `CV ${c}`, weight_class: c, kg: "99999", head_count: null, price_per_kg: null, status: "confirmed", deleted_at: null })));
  const classTables = (extra: Record<string, MemRow[]> = {}) => v4Tables({
    sales_line: lines, plan_week_class: saved, lb_supply: supply, app_setting: [flag("v5_costing")],
    plan_day: [{ id: "pd1", plan_week_id: "P1", date: "2026-08-27", head_count: 60, weight_class: "STD", cut_pattern: "karkas", supplier: null }, { id: "pd2", plan_week_id: "P1", date: "2026-08-28", head_count: 40, weight_class: "STD", cut_pattern: "karkas", supplier: null }],
    yield_matrix: ["STD", "K", "S", "B"].map((c, i) => ({ weight_class: c, cut_pattern: "karkas", key: "Karkas", yield_pct: ["0.7146", "0.70", "0.72", "0.74"][i], effective_from: "2026-01-01", effective_to: null, note: null, deleted_at: null })),
    lb_price_decision: [decision("2026-08-27", "24500"), decision("2026-08-27", "25000", "K")],
    ...extra,
  });

  it("per class: the batches add up to the saved heads and kg LB, on the two cut dates; the class yield and price decision are used", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb(classTables());
    const r = await copyClassPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }));
    expect(r.error).toBeUndefined();
    const rows = sb.calls("batch:insert")[0].payload as MemRow[];
    for (const sv of saved) {
      const mine = rows.filter((b) => b.weight_class === sv.weight_class);
      expect(mine.map((b) => b.date)).toEqual(["2026-08-26", "2026-08-27"]);
      expect(mine.reduce((a, b) => a + Number(b.head_count), 0)).toBe(sv.heads);
      expect(mine.reduce((a, b) => a.plus(D(String(b.lb_kg))), D(0)).toFixed(2)).toBe(sv.kg_lb);
    }
    expect(rows.every((b) => b.cut_pattern === "karkas" && String(b.batch_ref).startsWith("PLAN-2026-08-24-v1-"))).toBe(true);
    // the karkas output of a class batch is its kg LB × the yield of the class (K 0,70, S 0,72, B 0,74), not the v1 yield of STD
    for (const b of rows) {
      const y = { K: 0.7, S: 0.72, B: 0.74 }[String(b.weight_class) as "K" | "S" | "B"];
      expect(Number(b.out_karkas_fresh)).toBeCloseTo(Number(b.lb_kg) * y, 1);
    }
    // price: the decision of the class (K 25.000 on the 27th), else the one for all classes (24.500); a cut date before the data date has none → parameter 24.000
    const price = (cls: string, date: string) => rows.find((b) => b.weight_class === cls && b.date === date)?.lb_price;
    expect([price("K", "2026-08-27"), price("S", "2026-08-27"), price("B", "2026-08-26")]).toEqual(["25000.0000", "24500.0000", "24000.0000"]);
    expect(r.ok).toContain("6 batch rencana ditulis (K / S / B; 2430 kg LB, 1328 ekor)");
    expect(r.ok).toContain("harga LB: ");
  });
  it("a class without a yield of its own takes the STD yield and the message says so", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb(classTables({ yield_matrix: ["STD", "K", "S"].map((c, i) => ({ weight_class: c, cut_pattern: "karkas", key: "Karkas", yield_pct: ["0.7146", "0.70", "0.72"][i], effective_from: "2026-01-01", effective_to: null, note: null, deleted_at: null })) }));
    const r = await copyClassPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toContain("B yield STD untuk Karkas");
    const b = (sb.calls("batch:insert")[0].payload as MemRow[]).find((x) => x.weight_class === "B")!;
    expect(Number(b.out_karkas_fresh)).toBeCloseTo(Number(b.lb_kg) * 0.7146, 1);
  });
  it("a saved class with no need left (nothing to place it on) holds the copy instead of inventing batches", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb(classTables({ plan_week_class: [...saved, { id: "x", plan_week_id: "P1", weight_class: "STD", cut_pattern: "karkas", kg_lb: "100.00", heads: 50 }] }));
    const r = await copyClassPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }));
    expect(r.error).toBe("Belum bisa disalin ke batch: Kelas STD tersimpan tanpa kebutuhan per tanggal: simpan rencana ulang");
    expect(sb.calls("batch:insert")).toHaveLength(0);
  });
  it("another plan version's class rows are not read: the version asked is the one copied", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb(classTables({ plan_week: [plan(), plan({ id: "P0", version: 0 })], plan_week_class: [...saved, { id: "z", plan_week_id: "P0", weight_class: "B", cut_pattern: "karkas", kg_lb: "5.00", heads: 3 }] }));
    const r = await copyClassPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }));
    expect(r.error).toBeUndefined();
    expect((sb.calls("batch:insert")[0].payload as MemRow[]).reduce((a, b) => a + Number(b.head_count), 0)).toBe(1328);
  });
});
