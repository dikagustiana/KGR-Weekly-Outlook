/**
 * PRD v5.2-A irisan A1c, Q-v5.2-15 (code side): a Sales session reads nothing of PPIC's plan or demand. B2 already closed
 * plan_week_class and demand_class_weekly to Sales; B6 (5.2.5, a separate branch) closes plan_week and demand_weekly. This is the
 * proof that the code never asks for them as Sales — every Sales path runs on an in-memory database whose four planning tables
 * hold data (so an accidental read would show up in the answer) and the request log must not name any of them — and that what
 * Sales do see comes from the view surplus_for_sales_v52 or says "tidak ditampilkan untuk Sales", never 0.
 * test:rls (supabase/tests/rls_roles.sql) proves what the database answers a Sales session; this file proves what the code asks.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { computeWeek, stockSummary } from "@kgr/engine";
import { loadFixtureWeek } from "@kgr/engine/fixtures";
import { memSb, type MemRow, type MemSb } from "../../test-support/mem-sb";
import { WEEK, planSeed } from "../../test-support/plan-seed";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let sb: MemSb = memSb();
let who: { email: string; role: string } = { email: "sales@x.test", role: "sales" };
vi.mock("@/lib/supabase", () => ({ supabaseServer: async () => sb }));
vi.mock("@/lib/modules", () => ({
  requireModuleAction: async () => who,
  requireModulePage: async () => who,
  moduleSettings: async () => ({}),
}));
vi.mock("@/components/WeekShell", () => ({ WeekShell: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("@/lib/page", () => ({
  weekContext: async () => ({ viewer: who, week: WEEK, weeks: [WEEK], view: "preparer", lastRelease: null, computed: {} }),
}));
const { answerSurplusAction } = await import("@/app/komersial/actions-v5");
const { loadSurplusForSales, salesSurplusRows, surplusKeyOf } = await import("./surplus-view");
const { loadKomersialV5 } = await import("./komersial-data");
const { komersialV5Model } = await import("./komersial");
const { loadInputScreen } = await import("./input-data");
const { v3ForWeek } = await import("../v3/week");
const { managementV3 } = await import("../v3/management");
const { managementSlots } = await import("@/components/v3/ManagementV3");
const DemandPage = (await import("@/app/w/[week]/demand/page")).default;

beforeAll(() => { process.env.KGR_TEST_NOW = "2026-08-27T09:00:00+07:00"; });
afterEach(() => { sb = memSb(); who = { email: "sales@x.test", role: "sales" }; vi.restoreAllMocks(); });
const form = (f: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(f)) d.append(k, v); return d; };

/** What a Sales session must never ask for (plan_day: the plan's days — closed in the same stroke when B7 asks for it). */
const PLANNING = ["plan_week", "plan_week_class", "demand_weekly", "demand_class_weekly", "plan_day"];
const planningReads = (db: MemSb) => [...new Set(db.log.filter((l) => PLANNING.includes(l.table)).map((l) => `${l.table}:${l.op}`))];

const WS = "2026-08-24";
/** A row of the view as PostgREST answers it for a Sales user (Sales A, assignment RPA|Karkas). */
const view = (extra: MemRow): MemRow => ({ week_start: WS, plan_version: 2, plan_week_id: "P2", key: "RPA|Karkas", plan_surplus_kg: "6332.00", answered_surplus_kg: null, response: null, absorb_kg: null, price: null, responded_by: null, responded_at: null, ...extra });
/** The planning tables, filled with a plan that differs from the view's: a read of them would show in the answer. */
const planning = (): Record<string, MemRow[]> => ({
  plan_week: [{ id: "P9", week_start: WS, version: 9, deleted_at: null, surplus_kg_by_key: { "RPA|Karkas": "1.00", "RPA|Sayap": "999.00" }, head_count: 1 }],
  plan_week_class: [{ id: "c", plan_week_id: "P9", weight_class: "K", kg_lb: "1", heads: 1 }], plan_day: [{ id: "d", plan_week_id: "P9", date: WS, head_count: 1 }],
  demand_weekly: [{ id: "w", week_start: WS, key: "RPA|Karkas", net_kg: "1" }], demand_class_weekly: [{ id: "x", week_start: WS, size_code: "tanpa", net_kg: "1", kg_lb: "1" }],
});

describe("the answer to PPIC's surplus: a Sales user goes through the view (R56 + Q-v5.2-15)", () => {
  const tables = (): Record<string, MemRow[]> => ({
    week: [WEEK], input_task_rule: [], ...planning(),
    surplus_for_sales_v52: [view({}), view({ plan_version: 1, plan_week_id: "P1", plan_surplus_kg: "100.00" }), view({ key: "RPA|Kepala|Fresh", plan_surplus_kg: "55.00" }), view({ key: "RPA|Ceker", plan_surplus_kg: null, response: "reduce" })],
  });
  it("the plan version and the surplus kg come from the view (the latest version), the answer is inserted for that plan, and no planning table is asked for", async () => {
    sb = memSb(tables());
    const r = await answerSurplusAction({}, form({ week_start: WS, key: "RPA|Karkas", response: "partial", absorb_kg: "3000", price: "28500" }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toContain("Jawaban terkirim ke PPIC.");
    expect(sb.calls("surplus_response:insert")[0].payload).toEqual({ plan_week_id: "P2", key: "RPA|Karkas", surplus_kg: "6332.00", response: "partial", absorb_kg: "3000", price: "28500", note: null });
    expect(planningReads(sb)).toEqual([]);
  });
  it("a key that is not in the view for this Sales user (another rep's SKU, a SKU without surplus, or a key only an answer remains of) is 'not in the list'; nothing is written", async () => {
    sb = memSb(tables());
    for (const key of ["RPA|Sayap", "RPA|Karkas|Fresh", "RPA|Ceker", ""]) {
      const r = await answerSurplusAction({}, form({ week_start: WS, key, response: "absorb" }));
      expect(r.error, key).toBe(key ? `SKU ${key} tidak ada di daftar surplus rencana` : "Pilih SKU surplus yang dijawab");
    }
    expect(sb.calls("surplus_response:insert")).toHaveLength(0);
    expect(planningReads(sb)).toEqual([]);
  });
  it("no plan version in the view for the week → 'Belum ada rencana PPIC tersimpan'; the plan table is not consulted to find one", async () => {
    sb = memSb({ ...tables(), surplus_for_sales_v52: [] });
    expect((await answerSurplusAction({}, form({ week_start: WS, key: "RPA|Karkas", response: "absorb" }))).error).toBe("Belum ada rencana PPIC tersimpan untuk minggu ini");
    expect(planningReads(sb)).toEqual([]);
  });
  it("a failing read of the view is the error shown, not 'no surplus' (K41)", async () => {
    sb = memSb(tables(), { fail: { surplus_for_sales_v52: "permission denied for view surplus_for_sales_v52" } });
    expect((await answerSurplusAction({}, form({ week_start: WS, key: "RPA|Karkas", response: "absorb" }))).error).toBe("komersial.surplus_for_sales_v52: permission denied for view surplus_for_sales_v52");
  });
  it("the lead and Admin still read the plan (they may): the view is not used for them", async () => {
    who = { email: "lead@x.test", role: "commercial_lead" };
    sb = memSb({ ...tables(), surplus_for_sales_v52: [] });
    const r = await answerSurplusAction({}, form({ week_start: WS, key: "RPA|Sayap", response: "absorb" }));
    expect(r.error).toBeUndefined();
    expect(sb.calls("surplus_response:insert")[0].payload).toMatchObject({ plan_week_id: "P9", key: "RPA|Sayap", surplus_kg: "999.00" });
    expect(sb.log.filter((l) => l.table === "surplus_for_sales_v52")).toEqual([]);
  });
});

describe("the surplus rows of the view: one row per key, the same before and after B6", () => {
  it("a unit key is the base key of its RPA SKU; a plan row and an answer row of the same key are joined (B2's view says 'Karkas' for the plan and 'RPA|Karkas' for the answer)", () => {
    expect(surplusKeyOf("Karkas")).toBe("RPA|Karkas");
    expect(surplusKeyOf("RPA|Karkas|Fresh")).toBe("RPA|Karkas|Fresh");
    const before = salesSurplusRows([
      { key: "Karkas", plan_surplus_kg: "6332.00", response: null },
      { key: "RPA|Karkas", plan_surplus_kg: null, response: "absorb", absorb_kg: "6332.00", price: "30000", responded_at: "2026-08-26T10:00:00Z" },
    ]);
    const after = salesSurplusRows([{ key: "RPA|Karkas", plan_surplus_kg: "6332.00", response: "absorb", absorb_kg: "6332.00", price: "30000", responded_at: "2026-08-26T10:00:00Z" }]);
    expect(before).toEqual([{ key: "RPA|Karkas", kg: "6332.00", response: "absorb", absorbKg: "6332.00", price: "30000" }]);
    expect(after).toEqual(before);
  });
  it("the latest answer wins; a plan row without an answer stays unanswered; rows come sorted by key", () => {
    const rows = salesSurplusRows([
      { key: "RPA|Sayap", plan_surplus_kg: "5.00", response: null },
      { key: "RPA|Karkas", plan_surplus_kg: "10.00", response: "reduce", responded_at: "2026-08-26T09:00:00Z" },
      { key: "RPA|Karkas", plan_surplus_kg: "10.00", response: "partial", absorb_kg: "4", price: "1", responded_at: "2026-08-26T11:00:00Z" },
    ]);
    expect(rows.map((r) => [r.key, r.kg, r.response, r.absorbKg])).toEqual([["RPA|Karkas", "10.00", "partial", "4"], ["RPA|Sayap", "5.00", null, null]]);
  });
  it("loadSurplusForSales reads the latest version of the week only, two requests, ordered, bounded; a full page is an error", async () => {
    sb = memSb({ surplus_for_sales_v52: [view({}), view({ plan_version: 1, plan_week_id: "P1", plan_surplus_kg: "100.00" }), view({ week_start: "2026-08-17", plan_version: 7, plan_week_id: "PX" })] });
    const s = await loadSurplusForSales(sb as never, WS);
    expect(s).toMatchObject({ planWeekId: "P2", version: 2, weekStart: WS, rows: [{ key: "RPA|Karkas", kg: "6332.00" }] });
    expect(sb.log.map((l) => l.filters.join("|"))).toEqual(["eq week_start 2026-08-24", "eq plan_week_id P2"]);
    expect(await loadSurplusForSales(memSb({ surplus_for_sales_v52: [] }) as never, WS)).toBeNull();
    const many = Array.from({ length: 500 }, (_, i) => view({ key: `RPA|K${String(i).padStart(3, "0")}` }));
    await expect(loadSurplusForSales(memSb({ surplus_for_sales_v52: many }) as never, WS)).rejects.toThrow(/lebih dari 499 baris/);
  });
});

describe("the Commercial screen for Sales: the surplus of their SKUs from the view, nothing else of the plan", () => {
  const viewer = { email: "sales@x.test", role: "sales", fullName: null } as never;
  const seed = (): Record<string, MemRow[]> => ({
    week: [WEEK], parameter: [{ week_id: WEEK.id, sales_sees_cost: true, cut_off_time: "14:00", commitment_lock_dow: 5, commitment_lock_time: "17:00" }],
    sales_assignment: [{ email: "sales@x.test", key: "RPA|Karkas", active: true }], ...planning(),
    surplus_for_sales_v52: [view({}), view({ key: "RPA|Kepala|Fresh", plan_surplus_kg: "55.00" })],
  });
  const tile = (m: ReturnType<typeof komersialV5Model>, id: string) => JSON.stringify(m.tiles.find((t) => t.id === id));

  it("loadKomersialV5 as Sales: ppic is null (no plan detail), surplusForSales holds the view's rows, no planning table is asked for", async () => {
    sb = memSb(seed());
    const input = await loadKomersialV5(sb as never, viewer, "all");
    expect(input.ppic).toBeNull();
    expect(input.surplusForSales).toMatchObject({ planWeekId: "P2", version: 2, weekStart: WS });
    expect(input.surplusForSales!.rows.map((r) => [r.key, r.kg])).toEqual([["RPA|Karkas", "6332.00"], ["RPA|Kepala|Fresh", "55.00"]]);
    expect(planningReads(sb)).toEqual([]);
    expect(input.failed ?? {}).toEqual({});
  });
  it("the tile says what the plan says of their SKUs (kg, answer) and that the rest is not shown; the answer form is theirs to use", () => {
    sb = memSb(seed());
    const base = { today: "2026-08-27", spotToday: true, roleLabel: "Sales", sales: true, base: "/komersial", filter: "all", stockDate: null, rows: [], summary: stockSummary([]), holdingRate: null, approvalsWaiting: 0, cutOffTime: "14.00", commitment: { weekStart: "2026-08-31", weekEnd: "2026-09-06", deadline: "Jum 28/08 17.00", rows: [], canEdit: true, canLock: false, priceListLocked: false }, ppic: null, spot: [], controls: [] };
    const answered = { planWeekId: "P2", version: 2, weekStart: WS, rows: [{ key: "RPA|Karkas", kg: "6332.00", response: "partial" as const, absorbKg: "3000", price: "28500" }, { key: "RPA|Kepala|Fresh", kg: "55.00", response: null, absorbKg: null, price: null }] };
    const t = tile(komersialV5Model({ ...base, surplusForSales: answered } as never), "t-ppic");
    expect(t).toContain("surplus untuk SKU Anda · rencana v2");
    expect(t).toContain("serap 3.000 kg");
    expect(t).toContain("belum dijawab");
    expect(t).toContain("6.332");
    expect(t).toContain("Detail rencana (kelas, ekor, biaya, downgrade) tidak ditampilkan untuk Sales.");
    // no saved plan for their SKUs: said so, not an empty plan or a zero
    expect(tile(komersialV5Model({ ...base, surplusForSales: null } as never), "t-ppic")).toContain("Belum ada rencana PPIC tersimpan minggu ini untuk SKU Anda.");
    // a plan with no surplus of their SKUs
    expect(tile(komersialV5Model({ ...base, surplusForSales: { ...answered, rows: [] } } as never), "t-ppic")).toContain("Rencana PPIC tidak menyebut surplus untuk SKU Anda.");
    // not loaded at all (old callers): the earlier text stays
    expect(tile(komersialV5Model(base as never), "t-ppic")).toContain("Tidak ditampilkan untuk Sales (data perencanaan).");
  });
});

describe("the Input screen card for Sales: 'Karkas tanpa ukuran' is not shown, not 0 kg", () => {
  const seed = (): Record<string, MemRow[]> => ({ week: [WEEK], parameter: [{ week_id: WEEK.id }], input_task_rule: [], input_task: [], ...planning() });
  const card = async (viewerRole: string, shown: string) => {
    sb = memSb(seed());
    const input = await loadInputScreen(sb as never, { email: "x@x.test", role: viewerRole, fullName: null } as never, shown as never, null);
    return { card: input.cards.find((c) => c.title === "Karkas tanpa ukuran")!, input };
  };
  it("Sales: the card says 'tidak ditampilkan' and demand_class_weekly is not read", async () => {
    const { card: c } = await card("sales", "sales");
    expect(c).toEqual({ title: "Karkas tanpa ukuran", value: "tidak ditampilkan", sub: "tidak ditampilkan untuk Sales (data perencanaan)", tone: "plain" });
    expect(planningReads(sb)).toEqual([]);
  });
  it("the lead (who reads it) and Admin looking as Sales see the number as before", async () => {
    for (const role of ["commercial_lead", "admin"]) {
      const { card: c } = await card(role, "sales");
      expect(c.value).toBe("1 kg");
      expect(c.sub).toBe("dihitung STD di PPIC (C50)");
      expect(planningReads(sb)).toEqual(["demand_class_weekly:select"]);
    }
  });
});

describe("the other pages a Sales session can open", () => {
  it("Demand: Sales get the notice, nothing of demand_weekly, plan_week or plan_day is read; the other readers are not given the notice", async () => {
    sb = memSb({ ...planSeed(), ...planning() });
    const html = renderToStaticMarkup(await DemandPage({ params: Promise.resolve({ week: WS }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("tidak ditampilkan untuk Sales (data perencanaan)");
    expect(html).not.toContain("Ekor dibutuhkan");
    expect(planningReads(sb)).toEqual([]);
    expect(sb.log).toEqual([]);
  });
  it("v3ForWeek (the Kontrol page, snapshot.json) for Sales: no planning read, no demand or plan in the snapshot; for Admin the same call reads and fills them", async () => {
    const settings = { m3_planning: { enabled: true } } as never;
    sb = memSb({ ...planSeed(), ...planning() });
    const forSales = await v3ForWeek(sb as never, WEEK as never, settings, undefined, "sales" as never);
    expect(planningReads(sb)).toEqual([]);
    expect(forSales.snapshot.demand).toBeUndefined();
    expect(forSales.snapshot.plan).toBeUndefined();
    expect(forSales.controls.map((c) => c.code)).not.toContain("C28");
    sb = memSb({ ...planSeed(), ...planning(), plan_week: planning().plan_week });
    const forAdmin = await v3ForWeek(sb as never, WEEK as never, settings, undefined, "admin" as never);
    expect(planningReads(sb)).toEqual(expect.arrayContaining(["plan_week:select", "demand_weekly:select"]));
    expect(forAdmin.snapshot.demand).toHaveLength(1);
    expect(forAdmin.snapshot.plan).toMatchObject({ version: 9 });
  });
  it("the management preview (Outlook) for Sales: the demand section says 'tidak ditampilkan untuk Sales' and demand_weekly, plan_week are not read; for Admin it shows the numbers", async () => {
    const r = computeWeek(loadFixtureWeek("2026-08-24"));
    const settings = { m3_planning: { enabled: true } } as never;
    sb = memSb({ ...planSeed(), ...planning() });
    const m = await managementV3(sb as never, WEEK as never, settings, r, "sales" as never);
    expect(planningReads(sb)).toEqual([]);
    expect(m.demand).toBeNull();
    expect(m.demandHidden).toBe(true);
    expect(renderToStaticMarkup(<>{managementSlots(m).demand}</>)).toContain("Tidak ditampilkan untuk Sales (data perencanaan).");
    sb = memSb({ ...planSeed(), ...planning(), demand_weekly: [{ id: "w", week_start: WS, key: "RPA|Karkas", confirmed_kg: "10", tentative_kg: "0", forecast_kg: "0", weighted_kg: "10", stock_free_kg: "0", net_kg: "10" }] });
    const a = await managementV3(sb as never, WEEK as never, settings, r, "admin" as never);
    expect(a.demandHidden).toBeUndefined();
    expect(a.demand).toMatchObject({ rows: 1, planVersion: 9, heads: 1 });
    expect(renderToStaticMarkup(<>{managementSlots(a).demand}</>)).not.toContain("tidak ditampilkan untuk Sales");
  });
});
