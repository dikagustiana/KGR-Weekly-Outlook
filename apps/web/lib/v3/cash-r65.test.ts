/**
 * PRD v5.2-A R65 (F13, K52): the cash projection of 12 months on the August fixture. With v5_pl on it starts from the NIBT
 * after fixed costs, adds the non-cash costs back once (explicit reconciliation) and never falls back to the journal NIBT
 * or to 0 when that NIBT is unknown; with v5_pl off nothing of it changes.
 */
import { describe, expect, it, vi } from "vitest";
import { plRowsToMart } from "@kgr/engine";
import { fakeSb } from "../fake-sb";
import { augustV5, SCHEDULE_SEED } from "../../test-support/pl-v5-fixture";

vi.mock("server-only", () => ({}));
const { loadCash } = await import("./cash");
const { kasHorizon, kasModel } = await import("../v4/kas");

const v5 = augustV5();
const DATE = "2026-08-27";
const schedule = SCHEDULE_SEED.map((r) => ({ ...r, cash_day_of_month: null, deleted_at: null }));
const OMIT = "omit";
const note = (fixed: unknown) => JSON.stringify({ cutOff: "2026-08-26", ...(fixed === OMIT ? {} : { fixed }) });
const rows = (over: { app?: unknown; fixed?: unknown; mart?: Record<string, unknown>[] } = {}) => ({
  week: [], bank_account: [], cash_daily: [], cash_daily_plan: [], fixed_cost_schedule: schedule, pl_daily: [],
  pl_daily_v4: over.mart ?? plRowsToMart(v5.rows),
  app_setting: [{ key: "v5_pl", value: over.app ?? { enabled: true } }], data_status: [{ note: note("fixed" in over ? over.fixed : v5.fixed) }],
});
const jt = (v: { div(n: number): { toFixed(n: number): string } }) => v.div(1e6).toFixed(1);

describe("R65: v5_pl on — NIBT after fixed costs plus the non-cash costs", () => {
  it("12 months change = −7,8 + penyusutan 10,4 = +2,6 jt, with the reconciliation", async () => {
    const st = await loadCash(fakeSb({ rows: rows() }) as never, DATE, { m4: true });
    expect(st.monthsV4).not.toBeNull();
    expect(jt(st.monthsV4![0].change)).toBe("2.6");
    expect(st.monthsRecon).toMatchObject({ depreciation: expect.stringMatching(/^10393461\./), prepaid: [] });
    expect(Number(st.monthsRecon!.nibt) / 1e6).toBeCloseTo(-7.8, 1);
    expect(Number(st.monthsRecon!.change) / 1e6).toBeCloseTo(2.6, 1);
    // the v3 table shows the same projection (one basis)
    expect(st.months![0].change.toFixed(2)).toBe(st.monthsV4![0].change.toFixed(2));
  });
  it("NIBT unknown — every fixed nominal missing, or no `fixed` in the builder's note: no projection, no journal NIBT, no 0", async () => {
    for (const fixed of [v5.fixed.map((f) => ({ ...f, nominal: null, source: "belum ada" })), OMIT]) {
      const st = await loadCash(fakeSb({ rows: rows({ fixed }) }) as never, DATE, { m4: true });
      expect(st.monthsV4).toBeNull();
      expect(st.months).toBeNull();
      expect(st.monthsRecon).toMatchObject({ nibt: null, change: null });
    }
  });
  it("v5_pl off: the v4 basis as before (journal NIBT outlook + journal depreciation), no reconciliation", async () => {
    const st = await loadCash(fakeSb({ rows: rows({ app: { enabled: false }, mart: plRowsToMart(v5.plan.rows) }) }) as never, DATE, { m4: true });
    expect(st.monthsRecon).toBeNull();
    expect(jt(st.monthsV4![0].change)).toBe("79.2");
    // v3 months: no pl_daily rows → "tidak tersedia", not a flat projection on NIBT 0
    expect(st.months).toBeNull();
  });
});

describe("R65 on the Kas tile", () => {
  const hz = async (over?: Parameters<typeof rows>[0]) => {
    const st = await loadCash(fakeSb({ rows: rows(over) }) as never, DATE, { m4: true });
    return kasHorizon({ date: DATE, position: [], banks: {}, controls: [], split: st.split, months: st.monthsV4, monthsRecon: st.monthsRecon, affiliateReceived: st.affiliateReceived });
  };
  const tile = (h: Awaited<ReturnType<typeof hz>>) => kasModel({ today: DATE, row: { date: DATE, totalClosing: "495400000", lowest: null, lowestDate: null, lowestWithout: null, lowestWithoutDate: null, assumption: null, horizon: h }, solvency: null, ccc: null, sim: { lb: "", tr: "", share: "", stock: "" }, base: "/kas" }).tiles.find((t) => t.id === "ch-12bulan")!;
  it("the note reconciles the monthly change: NIBT setelah beban tetap + penyusutan nonkas = perubahan kas", async () => {
    const t = tile(await hz());
    expect(t.note).toBe("Perubahan kas per bulan = NIBT setelah beban tetap −7,8 jt + penyusutan nonkas 10,4 jt = 2,6 jt, dipertahankan tetap.");
    expect(t.cara?.basis).toBe("NIBT setelah beban tetap");
    expect(t.cara?.rule).toContain("beban nonkas");
  });
  it("unknown NIBT: the tile says tidak tersedia and why", async () => {
    const t = tile(await hz({ fixed: v5.fixed.map((f) => ({ ...f, nominal: null, source: "belum ada" })) }));
    expect(t.content.type).toBe("list");
    expect(JSON.stringify(t.content)).toContain("NIBT setelah beban tetap belum ada");
  });
  it("without v5_pl the tile keeps the v4 text", async () => {
    const t = tile(await hz({ app: { enabled: false }, mart: plRowsToMart(v5.plan.rows) }));
    expect(t.note).toBe("Bulan berjalan dan seterusnya: laba sebelum pajak outlook bulan ini ditambah penyusutan, dipertahankan tetap.");
  });
});
