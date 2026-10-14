/**
 * PRD §10 golden numbers (example week 24–30 Aug 2026, update 27 Aug) — the headline acceptance list.
 * Each is asserted at the precision the PRD states it, and also against the exact Excel cell.
 */
import { describe, expect, it } from "vitest";
import { Decimal } from "../src/decimal";
import { computeWeek } from "../src/week";
import { loadFixtureWeek, loadGolden } from "../src/fixtures";
import { snapshotJson } from "../src/snapshot";

const r = computeWeek(loadFixtureWeek("2026-08-24"));
const g = loadGolden("2026-08-24");
const near = (a: Decimal, b: string | number, tol: number) => a.minus(new Decimal(b)).abs().lessThanOrEqualTo(tol);
const jt = (a: Decimal) => a.div(1e6).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber();
const cell = (c: string) => g[c] as string;

describe("PRD §10 golden numbers", () => {
  it("Week summary — kg actual to yesterday / projected week = 23.588 / 64.025 kg", () => {
    const t = r.block1[2];
    expect(t.kgActual.toDecimalPlaces(0).toNumber()).toBe(23588);
    expect(t.kgProjection.toDecimalPlaces(0).toNumber()).toBe(64025);
    expect(near(t.kgActual, cell("O_Outlook!B8"), 0.01)).toBe(true);
    expect(near(t.kgProjection, cell("O_Outlook!H8"), 0.01)).toBe(true);
  });
  it("Projected product GP KGR −47,6 jt; GP/kg −743", () => {
    const t = r.block1[2];
    expect(jt(t.gpProjection)).toBe(-47.6);
    expect(t.gpPerKg.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(-743);
    expect(near(t.gpProjection, cell("O_Outlook!J8"), 1)).toBe(true);
  });
  it("RPA: fresh orders in horizon / stock fresh today = 12.307 / 18.768 kg → net need 0, LB max 0", () => {
    const b = r.block2;
    expect(b.freshOrdersInHorizon.toDecimalPlaces(0).toNumber()).toBe(12307);
    expect(b.freshStockToday.toDecimalPlaces(0).toNumber()).toBe(18768);
    expect(b.netFreshNeed.toNumber()).toBe(0);
    expect(b.lbMaxWithoutFrozen.toNumber()).toBe(0);
  });
  it("RPA: planned LB in horizon 27.219 kg; karkas at risk of freezing 19.475 kg", () => {
    expect(r.block2.lbPlannedInHorizon.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(27219);
    expect(r.block2.karkasAtRiskOfFreezing.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(19475);
    expect(near(r.block2.karkasAtRiskOfFreezing, cell("O_Outlook!B18"), 0.01)).toBe(true);
  });
  it("RPA: breakeven Rp 20.726 at plan share / Rp 24.337 at 100% fresh; margin at Rp 24.600 = −3.874", () => {
    const b = r.block2;
    expect(b.breakevenAtPlanShare.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(20726);
    expect(b.breakevenAt100Fresh.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(24337);
    expect(b.lbPriceToday.toNumber()).toBe(24600);
    expect(b.marginPerKgLb.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(-3874);
    expect(near(b.breakevenAtPlanShare, cell("O_Outlook!B21"), 1)).toBe(true);
    expect(near(b.breakevenAt100Fresh, cell("O_Outlook!B22"), 1)).toBe(true);
  });
  it("RPA recommendation TUNDA / NEGOSIASI", () => {
    expect(r.block2.recommendation).toBe("TUNDA / NEGOSIASI");
    expect(r.block2.recommendationText.startsWith("TUNDA / NEGOSIASI")).toBe(true);
  });
  it("Trading: BLP Frozen → CEK HARGA (order 43.086 < average cost 47.199)", () => {
    const t = r.block3.find((x) => x.key === "Trading|BLP|Frozen")!;
    expect(t.recommendation).toBe("CEK HARGA");
    expect(t.sellPrice.toDecimalPlaces(0).toNumber()).toBe(43086);
    expect(t.avgStockCost.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(47199);
  });
  it("Trading: BLD Frozen → JUAL STOK 4.848 kg", () => {
    const t = r.block3.find((x) => x.key === "Trading|BLD|Frozen")!;
    expect(t.recommendation).toBe("JUAL STOK");
    expect(t.recommendationText).toBe("JUAL STOK: 4.848 kg tanpa order");
  });
  it("Stock actions: KURANG 0; JUAL 23 keys / 17.834 kg; PERHATIAN 7 keys / 116.290 kg", () => {
    const [k, j, p] = r.block4;
    expect([k.keys, j.keys, p.keys]).toEqual([0, 23, 7]);
    expect(j.kgToday.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(17834);
    expect(p.kgToday.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()).toBe(116290);
  });
  it("Batches: actual shrink / karkas yield / fresh % = 6,3% / 73,8% / 66,6% (2 batches)", () => {
    const a = r.block6.rows[0];
    expect(a.batches).toBe(2);
    expect(a.shrink!.times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber()).toBe(6.3);
    expect(a.karkasYield!.times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber()).toBe(73.8);
    expect(a.freshPct!.times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber()).toBe(66.6);
  });
  it("P&L projection: revenue 1.656,8 jt / GP −67,5 jt / NI −107,6 jt", () => {
    const P = (l: string) => r.statements.pnl.get(l).values.projection;
    expect(jt(P("TOTAL REVENUE"))).toBe(1656.8);
    expect(jt(P("GROSS PROFIT"))).toBe(-67.5);
    expect(jt(P("NET INCOME"))).toBe(-107.6);
  });
  it("P&L last week NI −111,0 jt / MTD actual NI +165,2 jt", () => {
    const ni = r.statements.pnl.get("NET INCOME").values;
    expect(jt(ni.lastWeek)).toBe(-111.0);
    expect(jt(ni.mtd)).toBe(165.2);
  });
  it("BS projected: total assets 8.531,3 jt; control 0 in all columns", () => {
    const bs = r.statements.bs;
    expect(jt(bs.totals.assets.values.projection)).toBe(8531.3);
    for (const c of ["tb", "lastWeekEnd", "yesterday", "projection", "delta"] as const) {
      expect(bs.totals.control.values[c].toNumber()).toBe(0);
    }
  });
  it("BS projected: cash 818,2 jt / inventory 3.992,4 jt / affiliate payables 5.600,0 jt", () => {
    const B = (l: string) => r.statements.bs.get(l).values.projection;
    expect(jt(B("Cash and cash equivalents"))).toBe(818.2);
    expect(jt(B("Inventory - Product").plus(B("Inventory - Trading")))).toBe(3992.4);
    expect(jt(B("Other Payable - Related Parties"))).toBe(5600.0);
  });
  it("CF projected: net +439,1 jt / customer receipts 1.872,9 jt / supplier payments −1.325,0 jt", () => {
    const cf = r.statements.cf;
    expect(jt(cf.net.projection)).toBe(439.1);
    expect(jt(cf.lines.find((l) => l.category === "Penerimaan dari pelanggan")!.values.projection)).toBe(1872.9);
    expect(jt(cf.lines.find((l) => l.category === "Bayar pemasok barang (live bird & trading)")!.values.projection)).toBe(-1325.0);
  });
  it("CF: lowest daily cash balance 289,7 jt on 28 Aug", () => {
    expect(jt(r.statements.cf.lowest.balance)).toBe(289.7);
    expect(r.statements.cf.lowest.date).toBe("2026-08-28");
  });
  it("Controls: 17 LULUS, 2 BELUM DIISI (Accurate totals not entered)", () => {
    const xs = r.controls.controls.filter((c) => c.no <= 19);
    expect(xs.filter((c) => c.status === "LULUS").length).toBe(17);
    expect(xs.filter((c) => c.status === "BELUM DIISI").map((c) => c.no)).toEqual([8, 9]);
    expect(r.controls.overall).toBe("PERIKSA");
    expect(r.controls.releasable).toBe(true);
  });
});

describe("determinism", () => {
  it("identical inputs give byte-identical snapshots", () => {
    const a = snapshotJson(computeWeek(loadFixtureWeek("2026-08-24")));
    const b = snapshotJson(computeWeek(loadFixtureWeek("2026-08-24")));
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10_000);
  });
});
