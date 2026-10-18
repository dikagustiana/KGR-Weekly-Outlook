/**
 * PRD v5.2-A irisan A1c — A2 uses the columns B5 added (schema 5.2.3), through the actions with the in-memory client:
 *   Q-v5.2-20  plan_check_reason.plan_week_id: a C58 reason is written for the saved plan version and counts for that version only
 *   Q-v5.2-21  plan_week_class.detail: the plan saves its split over the cut dates, the copy makes exactly those batches
 *   Q-v5.2-22  batch.lb_price_source: keputusan_kelas, keputusan_semua_kelas, manual (Q-v5.2-70)
 * The client is not PostgREST (no constraints, no triggers): that the database accepts these values is proved by test:rls
 * (docs/v5.2/b5.md, blocks "B-R85 lb_price_source" and "A2 plan_check_reason.plan_week_id plan_week_class.detail").
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
const { copyPlanAction, copyClassPlanAction, reasonAction, saveClassPlanAction } = await import("@/app/w/[week]/rencana/actions");
const { copyGate, reasonsFor, lbPriceSourceOf } = await import("./copy-plan");
const { planWeekClassRows } = await import("./ppic-data");
const { loadPlanning } = await import("../v3/planning");

afterEach(() => { sb = memSb(); on = {}; });
const form = (f: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(f)) d.append(k, v); return d; };
const DAYS = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];
const capacity = DAYS.map((date) => ({ date, cut_capacity_head: 5000, chiller_kg: null, abf_kg: null }));
const decision = (date: string, price: string, cls: string | null = null): MemRow => ({ id: `d-${date}-${cls}`, date, weight_class: cls, price, decided_at: "2026-08-26T09:00:00Z" });
const plan = (extra: MemRow = {}): MemRow => ({ id: "P1", week_start: "2026-08-24", version: 1, weight_class: "STD", head_count: 100, needs_approval: false, approved_by: null, copied_to_batch_at: null, deleted_at: null, created_at: "2026-08-26T08:00:00Z", ...extra });
const reason = (extra: MemRow = {}): MemRow => ({ id: "r1", week_start: "2026-08-24", code: "C58", reason: "supply menyusul dari CV X", created_at: "2026-08-26T10:00:00Z", deleted_at: null, plan_week_id: null, ...extra });

/** v4 plan (two plan days), no class rows: C58 is judged on the daily class need and has no supply. */
const v4Tables = (extra: Record<string, MemRow[]> = {}) => planSeed({
  yield_matrix: [{ weight_class: "STD", cut_pattern: "karkas", key: "Karkas", yield_pct: "0.7146", effective_from: "2026-01-01", effective_to: null, note: null, deleted_at: null }],
  capacity, sku_balance_daily: [{ date: "2026-08-23", key: "RPA|Karkas|Fresh", free_kg: "10" }],
  plan_week: [plan()],
  plan_day: [{ id: "pd1", plan_week_id: "P1", date: "2026-08-27", head_count: 60, weight_class: "STD", cut_pattern: "karkas", supplier: "CV X" }, { id: "pd2", plan_week_id: "P1", date: "2026-08-28", head_count: 40, weight_class: "STD", cut_pattern: "karkas", supplier: null }],
  sales_line: [po("a", "JLB0829", "1000", "2026-08-28")],
  ...extra,
});

describe("Q-v5.2-20 — the C58 reason is written for the plan version (plan_check_reason.plan_week_id)", () => {
  it("reasonAction writes plan_week_id = the latest saved version (not the first, not a deleted one); other codes carry none", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb(v4Tables({ plan_week: [plan({ id: "P1", version: 1 }), plan({ id: "P2", version: 2, created_at: "2026-08-26T12:00:00Z" }), plan({ id: "P3", version: 3, deleted_at: "2026-08-26T13:00:00Z" })] }));
    expect((await reasonAction({}, form({ week: "2026-08-24", code: "C58", reason: "supply versi 2 menyusul" }))).ok).toBe("Alasan C58 disimpan");
    expect((await reasonAction({}, form({ week: "2026-08-24", code: "C41", reason: "kekurangan dibeli trading" }))).ok).toBe("Alasan C41 disimpan");
    const [c58, c41] = sb.calls("plan_check_reason:insert").map((l) => l.payload as MemRow);
    expect(c58).toEqual({ week_start: "2026-08-24", code: "C58", reason: "supply versi 2 menyusul", plan_week_id: "P2" });
    expect(c41).toEqual({ week_start: "2026-08-24", code: "C41", reason: "kekurangan dibeli trading" });
  });
  it("with no plan saved yet the reason is written without a version (the column allows it) and then counts by time", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb(v4Tables({ plan_week: [], plan_day: [] }));
    expect((await reasonAction({}, form({ week: "2026-08-24", code: "C58", reason: "supply menyusul dari CV X" }))).ok).toBe("Alasan C58 disimpan");
    expect(sb.calls("plan_check_reason:insert")[0].payload).toEqual({ week_start: "2026-08-24", code: "C58", reason: "supply menyusul dari CV X" });
  });
  it("a reason of version 1 is retired when version 2 writes its own; a reason of the latest version is not written twice", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    // the v1 reason is stamped AFTER v2 was saved: by time it would look valid, by version it is stale
    sb = memSb(v4Tables({ plan_week: [plan({ id: "P1", version: 1 }), plan({ id: "P2", version: 2, created_at: "2026-08-26T12:00:00Z" })], plan_check_reason: [reason({ id: "r1", plan_week_id: "P1", created_at: "2026-08-26T15:00:00Z" })] }));
    expect((await reasonAction({}, form({ week: "2026-08-24", code: "C58", reason: "supply versi 2 menyusul" }))).ok).toBe("Alasan C58 disimpan");
    expect(sb.tables.plan_check_reason.find((r) => r.id === "r1")?.deleted_at).toBeTruthy();
    expect(sb.tables.plan_check_reason.filter((r) => !r.deleted_at).map((r) => [r.plan_week_id, r.reason])).toEqual([["P2", "supply versi 2 menyusul"]]);
    const before = sb.calls("plan_check_reason:insert").length;
    expect((await reasonAction({}, form({ week: "2026-08-24", code: "C58", reason: "sekali lagi" }))).error).toBe("Alasan untuk kontrol ini sudah ada");
    expect(sb.calls("plan_check_reason:insert")).toHaveLength(before);
  });
  it("copyGate: a reason bound to version 2 opens C58 for version 2 only; version 1 (an older version asked for) needs its own", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    const two = [plan({ id: "P1", version: 1 }), plan({ id: "P2", version: 2, created_at: "2026-08-26T12:00:00Z" })];
    sb = memSb(v4Tables({ plan_week: two, plan_check_reason: [reason({ plan_week_id: "P2", created_at: "2026-08-26T13:00:00Z" })] }));
    const g2 = await copyGate({ sb: sb as never, week: WEEK as never, planId: "P2", classOn: true });
    expect(g2.blockers).toEqual([]);
    expect(g2.c58Reason).toBe("supply menyusul dari CV X");
    // version 1 was saved earlier than the reason: by time it would count, by version it does not
    const g1 = await copyGate({ sb: sb as never, week: WEEK as never, planId: "P1", classOn: true });
    expect(g1.blockers).toEqual(["C58 BELUM DIISI"]);
    expect(g1.c58Reason).toBeNull();
  });
  it("copyGate: a reason bound to version 1 counts when version 1 is copied, even though version 2 exists and is newer", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb(v4Tables({ plan_week: [plan({ id: "P1", version: 1 }), plan({ id: "P2", version: 2, created_at: "2026-08-26T12:00:00Z" })], plan_check_reason: [reason({ plan_week_id: "P1", created_at: "2026-08-26T10:00:00Z" })] }));
    expect((await copyGate({ sb: sb as never, week: WEEK as never, planId: "P1", classOn: true })).blockers).toEqual([]);
    expect((await copyGate({ sb: sb as never, week: WEEK as never, planId: "P2", classOn: true })).blockers).toEqual(["C58 BELUM DIISI"]);
  });
  it("a row without plan_week_id (before v5.2) is still judged by time, and a row without a stamp always counts; other codes are not bound", async () => {
    const p2 = plan({ id: "P2", version: 2, created_at: "2026-08-26T12:00:00Z" });
    const ids = (rs: { code: string; reason: string; created_at?: string | null; plan_week_id?: string | null }[]) => reasonsFor(rs, p2).map((r) => r.reason);
    expect(ids([
      { code: "C58", reason: "lama", created_at: "2026-08-26T10:00:00Z", plan_week_id: null },      // before the version → no
      { code: "C58", reason: "baru", created_at: "2026-08-26T13:00:00Z", plan_week_id: null },      // after → yes
      { code: "C58", reason: "tanpa cap", created_at: null, plan_week_id: null },                    // no stamp → yes
      { code: "C58", reason: "versi lain", created_at: "2026-08-26T20:00:00Z", plan_week_id: "P1" }, // bound elsewhere → no, however late
      { code: "C58", reason: "versi ini", created_at: "2026-08-26T01:00:00Z", plan_week_id: "P2" },  // bound here → yes, however early
      { code: "C41", reason: "kode lain", created_at: "2026-08-26T01:00:00Z", plan_week_id: "P1" },  // not C58 → yes
    ])).toEqual(["baru", "tanpa cap", "versi ini", "kode lain"]);
    expect(reasonsFor([{ code: "C58", reason: "terikat", plan_week_id: "P1" }], null)).toEqual([]);
  });
  it("the planning read asks for plan_week_id (the column of B5), so the gate can use it", async () => {
    sb = memSb(v4Tables({ plan_check_reason: [reason({ plan_week_id: "P1" })] }));
    const src = await loadPlanning(sb as never, WEEK as never);
    expect(src.reasons).toEqual([{ code: "C58", reason: "supply menyusul dari CV X", created_at: "2026-08-26T10:00:00Z", plan_week_id: "P1" }]);
    // the in-memory client returns whole rows, so what the loader ASKS for is read from the request
    expect(sb.selects.filter((x) => x.table === "plan_check_reason").map((x) => x.columns.split(",").map((c) => c.trim()))).toEqual([["code", "reason", "created_at", "plan_week_id"]]);
  });
});

describe("Q-v5.2-21 — the plan saves its split per cut date (plan_week_class.detail) and the copy makes exactly those batches", () => {
  // two ship dates (27, 28 Aug → cut 26, 27 Aug); sizes 0,9 (K), 1,3 (S), 1,5 (B)
  const lines = [
    po("a1", "JLB0092", "100", "2026-08-27"), po("a2", "JLB0092", "60", "2026-08-28"), po("b1", "JLB0829", "700", "2026-08-27"), po("b2", "JLB0829", "300", "2026-08-28"),
    po("c1", "JLB0922", "400", "2026-08-27"), po("c2", "JLB0922", "200", "2026-08-28"),
  ];
  const supply: MemRow[] = ["2026-08-26", "2026-08-27"].flatMap((date) => ["K", "S", "B"].map((c) => ({ id: `s-${date}-${c}`, date, supplier: `CV ${c}`, weight_class: c, kg: "99999", head_count: null, price_per_kg: null, status: "confirmed", deleted_at: null })));
  const tables = (extra: Record<string, MemRow[]> = {}) => v4Tables({
    plan_week: [], plan_day: [], sales_line: lines, lb_supply: supply, app_setting: [flag("v5_costing")],
    yield_matrix: ["STD", "K", "S", "B"].map((c, i) => ({ weight_class: c, cut_pattern: "karkas", key: "Karkas", yield_pct: ["0.7146", "0.70", "0.72", "0.74"][i], effective_from: "2026-01-01", effective_to: null, note: null, deleted_at: null })),
    lb_price_decision: [decision("2026-08-27", "24500"), decision("2026-08-27", "25000", "K")],
    ...extra,
  });
  const save = async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    const r = await saveClassPlanAction({}, form({ week: "2026-08-24" }));
    expect(r.error).toBeUndefined();
    return sb.tables.plan_week_class;
  };

  it("saveClassPlanAction writes detail on every class row: [{ cut_date, heads, kg_lb }] on the cut dates, adding up to the row", async () => {
    sb = memSb(tables());
    const rows = await save();
    expect(rows.map((r) => r.weight_class).sort()).toEqual(["B", "K", "S"]);
    for (const r of rows) {
      const detail = r.detail as { cut_date: string; heads: number; kg_lb: string }[];
      expect(Array.isArray(detail) && detail.length > 0).toBe(true);
      expect(detail.map((d) => d.cut_date)).toEqual(["2026-08-26", "2026-08-27"]);
      expect(detail.every((d) => Object.keys(d).sort().join() === "cut_date,heads,kg_lb" && Number.isInteger(d.heads) && d.heads > 0 && /^\d+\.\d{2}$/.test(d.kg_lb))).toBe(true);
      expect(detail.reduce((a, d) => a + d.heads, 0)).toBe(r.heads);
      expect(detail.reduce((a, d) => a.plus(D(d.kg_lb)), D(0)).toFixed(2)).toBe(r.kg_lb);
      expect(r.plan_week_id).toBe(sb.tables.plan_week[0].id);
    }
  });
  it("the copy makes exactly the batches of the detail — also after the demand moved (a PO grew on the later date) — and a row without detail follows the new profile", async () => {
    sb = memSb(tables());
    const rows = await save();
    const planId = String(sb.tables.plan_week[0].id);
    // the demand moves after the plan was saved: the 2026-08-28 PO of size 1,3 (class S) triples
    sb.tables.sales_line.find((l) => l.id === "b2")!.kg = "900";
    const r = await copyClassPlanAction({}, form({ week: "2026-08-24", plan_id: planId }));
    expect(r.error).toBeUndefined();
    const batches = sb.calls("batch:insert")[0].payload as MemRow[];
    for (const row of rows) {
      const detail = row.detail as { cut_date: string; heads: number; kg_lb: string }[];
      const mine = batches.filter((b) => b.weight_class === row.weight_class);
      expect(mine.map((b) => [b.date, b.head_count, D(String(b.lb_kg)).toFixed(2)])).toEqual(detail.map((d) => [d.cut_date, d.heads, d.kg_lb]));
    }
    // the same plan with its S detail removed (a row saved before v5.2): the profile of today's demand divides S, and differently
    const s = rows.find((x) => x.weight_class === "S")!;
    const saved = (s.detail as { heads: number }[]).map((d) => d.heads);
    s.detail = null;
    sb.tables.batch = [];
    expect((await copyClassPlanAction({}, form({ week: "2026-08-24", plan_id: planId }))).error).toBeUndefined();
    const again = (sb.calls("batch:insert")[1].payload as MemRow[]).filter((b) => b.weight_class === "S").map((b) => Number(b.head_count));
    expect(again.reduce((a, b) => a + b, 0)).toBe(saved.reduce((a, b) => a + b, 0));
    expect(again).not.toEqual(saved);
  });
  it("the copy asks for detail when it reads the saved class rows (the client returns whole rows, so the request is what is checked)", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb(tables());
    const rows = await save();
    sb.selects.length = 0;
    expect((await copyClassPlanAction({}, form({ week: "2026-08-24", plan_id: String(sb.tables.plan_week[0].id) }))).error).toBeUndefined();
    expect(rows.length).toBe(3);
    expect(sb.selects.filter((x) => x.table === "plan_week_class").map((x) => x.columns)).toEqual(["weight_class, cut_pattern, kg_lb, heads, detail"]);
  });
  it("a detail that does not match its row holds the copy and says which class; nothing is written", async () => {
    sb = memSb(tables());
    const rows = await save();
    const planId = String(sb.tables.plan_week[0].id);
    (rows.find((x) => x.weight_class === "K")!.detail as { heads: number }[])[0].heads += 1;
    const r = await copyClassPlanAction({}, form({ week: "2026-08-24", plan_id: planId }));
    expect(r.error).toBe("Belum bisa disalin ke batch: Kelas K: rincian per tanggal tersimpan tidak cocok dengan ekor dan kg LB kelas: simpan rencana ulang");
    expect(sb.calls("batch:insert")).toHaveLength(0);
  });
  it("planWeekClassRows: a class with no daily need to place it on is saved with detail null (the copy holds it, as before)", () => {
    const demand = { byClass: [{ weight_class: "K", kg_lb: D("230"), heads: D("120") }, { weight_class: "STD", kg_lb: D("100"), heads: D("50") }] } as never;
    const daily = [{ cut_date: "2026-08-26", byClass: [{ weight_class: "K", kg_lb: D("600"), heads: D("10") }] }, { cut_date: "2026-08-27", byClass: [{ weight_class: "K", kg_lb: D("400"), heads: D("10") }] }] as never;
    const rows = planWeekClassRows("PX", demand, daily);
    expect(rows.map((r) => [r.weight_class, r.heads, r.kg_lb])).toEqual([["K", 120, "230.00"], ["STD", 50, "100.00"]]);
    expect(rows[0].detail).toEqual([{ cut_date: "2026-08-26", heads: 72, kg_lb: "138.00" }, { cut_date: "2026-08-27", heads: 48, kg_lb: "92.00" }]);
    expect(rows[1].detail).toBeNull();
  });
});

describe("Q-v5.2-22 / Q-v5.2-70 — the copy writes batch.lb_price_source", () => {
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
    yield_matrix: ["STD", "K", "S", "B"].map((c, i) => ({ weight_class: c, cut_pattern: "karkas", key: "Karkas", yield_pct: ["0.7146", "0.70", "0.72", "0.74"][i], effective_from: "2026-01-01", effective_to: null, note: null, deleted_at: null })),
    lb_price_decision: [decision("2026-08-27", "24500"), decision("2026-08-27", "25000", "K")],
    ...extra,
  });

  it("class decision → keputusan_kelas; decision for all classes → keputusan_semua_kelas; neither (the parameter price) → manual", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    sb = memSb(classTables());
    expect((await copyClassPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }))).error).toBeUndefined();
    const rows = sb.calls("batch:insert")[0].payload as MemRow[];
    const of = (cls: string, date: string) => { const b = rows.find((x) => x.weight_class === cls && x.date === date)!; return [b.lb_price, b.lb_price_source]; };
    expect(of("K", "2026-08-27")).toEqual(["25000.0000", "keputusan_kelas"]);
    expect(of("S", "2026-08-27")).toEqual(["24500.0000", "keputusan_semua_kelas"]);
    expect(of("B", "2026-08-26")).toEqual(["24000.0000", "manual"]);
    // every value is one the check of the column accepts
    expect(new Set(rows.map((b) => b.lb_price_source))).toEqual(new Set(["keputusan_kelas", "keputusan_semua_kelas", "manual"]));
  });
  it("a price taken from the LB supply row is manual too (typed by Purchasing, not a decision); the message still says 'harga supply'", async () => {
    on = { m3_planning: true, v5_ppic_class: true };
    // v5_costing off: no C57 holds a copy without a decision, so the supply price is the price of the batch
    sb = memSb(classTables({ lb_supply: supply.map((x) => ({ ...x, price_per_kg: "24200" })), lb_price_decision: [], app_setting: [] }));
    const r = await copyClassPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }));
    expect(r.error).toBeUndefined();
    const rows = sb.calls("batch:insert")[0].payload as MemRow[];
    expect(rows.every((b) => b.lb_price === "24200.0000" && b.lb_price_source === "manual")).toBe(true);
    expect(r.ok).toContain("harga LB: harga supply 6");
  });
  it("the v4 copy writes it as well (the same copy, K58)", async () => {
    on = { m3_planning: true };
    sb = memSb(v4Tables({ app_setting: [flag("v5_costing")], lb_price_decision: [decision("2026-08-27", "24500"), decision("2026-08-28", "24800")] }));
    expect((await copyPlanAction({}, form({ week: "2026-08-24", plan_id: "P1" }))).error).toBeUndefined();
    expect((sb.calls("batch:insert")[0].payload as MemRow[]).map((b) => b.lb_price_source)).toEqual(["keputusan_semua_kelas", "keputusan_semua_kelas"]);
    expect(lbPriceSourceOf(null)).toBe("manual");
    expect(lbPriceSourceOf({ weight_class: "K" })).toBe("keputusan_kelas");
    expect(lbPriceSourceOf({ weight_class: null })).toBe("keputusan_semua_kelas");
  });
});
