/**
 * Q-v5.2-122, K43 part (A8): the commitment tile of Commercial offers a row only where the database accepts the save. A commitment is one row
 * per BASE key ("RPA|Karkas"); the database (tg_commitment_guard / sales_commitment_read, `assignment_covers`, O21(b)) lets a Sales user write it
 * only when an assignment of theirs covers that key: a base-key assignment covers every form, an assignment of one form ("RPA|Karkas|Fresh")
 * does not cover the base key (supabase/tests/rls_roles.sql, "P6 Fresh rep commits on the base key: denied"). Before A8 the tile matched on
 * `baseKey(assignment) === key`, so a form-only assignment was offered a row the save then refused. vitest; in-memory database, no RLS: the
 * refusal itself is the database's, proved in test:rls and in the e2e journey A7.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { memSb, type MemRow, type MemSb } from "../../test-support/mem-sb";
import { TilePage } from "@/components/v4/TilePage";
import { commitmentScope } from "./commitment-scope";
import { formOnlyNote, komersialV5Model } from "./komersial";

vi.mock("server-only", () => ({}));
const { loadKomersialV5 } = await import("./komersial-data");

const set = (...k: string[]) => new Set(k);
const KARKAS = "RPA|Karkas", SAYAP = "RPA|Sayap";

describe("commitmentScope: the coverage rule of the database, on base keys", () => {
  it("a base-key assignment covers its base key; an assignment of one form does not (it is only 'form only')", () => {
    expect(commitmentScope(set(KARKAS), [KARKAS, SAYAP])).toEqual({ rows: [KARKAS], formOnly: [] });
    expect(commitmentScope(set("RPA|Karkas|Fresh"), [KARKAS, SAYAP])).toEqual({ rows: [], formOnly: [KARKAS] });
    expect(commitmentScope(set("RPA|Karkas|Frozen"), [KARKAS])).toEqual({ rows: [], formOnly: [KARKAS] });
    expect(commitmentScope(set("RPA|Karkas|n/a"), [KARKAS])).toEqual({ rows: [], formOnly: [KARKAS] });
  });
  it("two assignments of one SKU: the base key wins; assignments of different SKUs split the candidates", () => {
    expect(commitmentScope(set("RPA|Karkas|Fresh", KARKAS), [KARKAS])).toEqual({ rows: [KARKAS], formOnly: [] });
    expect(commitmentScope(set("RPA|Karkas|Fresh", SAYAP), [KARKAS, SAYAP])).toEqual({ rows: [SAYAP], formOnly: [KARKAS] });
  });
  it("a candidate the viewer has no assignment for is in neither list; Admin and Kepala Sales ('all') get every candidate", () => {
    expect(commitmentScope(set(SAYAP), [KARKAS])).toEqual({ rows: [], formOnly: [] });
    expect(commitmentScope("all", [KARKAS, SAYAP])).toEqual({ rows: [KARKAS, SAYAP], formOnly: [] });
  });
  it("an empty assignment key covers nothing, as in the database (assignment_covers('', k) is false), unlike the engine's helper", () => {
    expect(commitmentScope(set(""), [KARKAS])).toEqual({ rows: [], formOnly: [] });
  });
  it("order of the candidates is kept (the tile is ordered by this week's kg)", () => {
    expect(commitmentScope(set(KARKAS, SAYAP, "RPA|Usus"), ["RPA|Usus", KARKAS, SAYAP]).rows).toEqual(["RPA|Usus", KARKAS, SAYAP]);
  });
});

describe("the note under the tile", () => {
  it("one sentence naming the SKUs, only when something was left out", () => {
    expect(formOnlyNote(undefined)).toBe("");
    expect(formOnlyNote([])).toBe("");
    expect(formOnlyNote([KARKAS, "RPA|Ceker"])).toBe(" Komitmen per key dasar butuh penugasan key dasar: penugasan Anda untuk Karkas, Ceker hanya satu bentuk, jadi barisnya tidak ditawarkan (minta Kepala Sales menugaskan key dasarnya).");
  });
});

describe("the loader of Commercial v5 (Sales session, in-memory database)", () => {
  let sb: MemSb = memSb();
  beforeAll(() => { process.env.KGR_TEST_NOW = "2026-08-27T09:00:00+07:00"; });
  afterEach(() => { sb = memSb(); });
  const WEEK = { id: "w1", week_start: "2026-08-24", week_end: "2026-08-30", update_date: "2026-08-27", tb_opening_date: "2026-08-23", status: "open" };
  const mart = (key: string, form: string): MemRow => ({
    date: "2026-08-27", key, form, free_fresh_kg: form === "Fresh" ? "20000" : "0", free_frozen_kg: form === "Frozen" ? "5000" : "0", oldest_age_days: 1, urgency: "aman", rank: 1, ordered_today_kg: "0", cost_per_kg_ma: "30000", price_list: "36000",
  });
  const line = (item: string, kg: string, date: string): MemRow => ({ item_code: item, key_manual: null, kg, status: "Order", demand_status: "Confirmed", delivery_date: date, date, deleted_at: null, superseded_at: null });
  const seed = (assignments: { key: string | null }[], extra: Record<string, MemRow[]> = {}): Record<string, MemRow[]> => ({
    week: [WEEK], parameter: [{ week_id: "w1", sales_sees_cost: true, cut_off_time: "14:00", commitment_lock_dow: 5, commitment_lock_time: "17:00" }],
    sales_assignment: assignments.map((a) => ({ email: "sales@x.test", active: true, ...a })),
    commercial_daily_sales: [mart("RPA|Karkas|Fresh", "Fresh"), mart("RPA|Karkas|Frozen", "Frozen"), mart("RPA|Sayap|Fresh", "Fresh")],
    item_map: [{ item_code: "JLB0922", key: "RPA|Karkas|Fresh", deleted_at: null }, { item_code: "JLB0100", key: "RPA|Sayap|Fresh", deleted_at: null }],
    // this week's orders of Karkas (6.000 kg) and Sayap (900 kg): what puts a SKU on the commitment tile
    sales_line: [line("JLB0922", "6000", "2026-08-26"), line("JLB0100", "900", "2026-08-26")],
    ...extra,
  });
  const sales = { email: "sales@x.test", role: "sales", fullName: null } as never;
  const lead = { email: "lead@x.test", role: "commercial_lead", fullName: null } as never;
  const load = async (assignments: { key: string | null }[], viewer = sales) => { sb = memSb(seed(assignments)); return loadKomersialV5(sb as never, viewer, "all"); };
  const rowKeys = (i: Awaited<ReturnType<typeof load>>) => i.commitment.rows.map((r) => r.key);

  it("form-only assignment (RPA|Karkas|Fresh): no row for Karkas, which the database would refuse; Karkas is named as left out", async () => {
    const i = await load([{ key: "RPA|Karkas|Fresh" }]);
    expect(i.failed ?? {}).toEqual({});
    expect(rowKeys(i)).toEqual([]);
    expect(i.commitment.formOnly).toEqual([KARKAS]);
  });
  it("base-key assignment (RPA|Karkas): the Karkas row is offered, nothing is left out; Sayap (no assignment) is not there", async () => {
    const i = await load([{ key: KARKAS }]);
    expect(rowKeys(i)).toEqual([KARKAS]);
    expect(i.commitment.formOnly).toEqual([]);
  });
  it("both: the base key wins (one row, nothing left out); a form of one SKU and the base key of another: one row, one left out", async () => {
    expect(rowKeys(await load([{ key: "RPA|Karkas|Fresh" }, { key: KARKAS }]))).toEqual([KARKAS]);
    const i = await load([{ key: "RPA|Karkas|Fresh" }, { key: SAYAP }]);
    expect(rowKeys(i)).toEqual([SAYAP]);
    expect(i.commitment.formOnly).toEqual([KARKAS]);
  });
  it("an assignment without a key (every SKU) and the lead see every SKU of the week, nothing left out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // the lead's 'Dari PPIC' tile has no plan in this stand-in database: its own error line
    for (const i of [await load([{ key: null }]), await load([], lead)]) {
      expect(rowKeys(i).sort()).toEqual([KARKAS, SAYAP]);
      expect(i.commitment.formOnly).toEqual([]);
    }
    vi.restoreAllMocks();
  });
  it("the tile: no row and one note for a form-only Sales user; unchanged note for the others", async () => {
    const text = (i: Awaited<ReturnType<typeof load>>) => {
      const t = komersialV5Model(i).tiles.find((x) => x.id === "t-komitmen")!;
      return { note: t.note ?? "", html: renderToStaticMarkup(<TilePage tiles={[t]} label="x" />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") };
    };
    const only = text(await load([{ key: "RPA|Karkas|Fresh" }]));
    expect(only.note).toContain("Komitmen per key dasar butuh penugasan key dasar: penugasan Anda untuk Karkas hanya satu bentuk");
    expect(only.html).not.toMatch(/Karkas\s+6\.000/); // no row of the table
    const base = text(await load([{ key: KARKAS }]));
    expect(base.note).not.toContain("Komitmen per key dasar butuh penugasan key dasar");
    expect(base.html).toMatch(/Karkas\s+6\.000/);
  });
});
