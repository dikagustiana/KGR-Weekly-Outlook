/** PRD v4 §3.4 weekly outlook on the example week 24–30 Aug 2026 (update date 27 Aug). */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { computeWeek } from "../src/week";
import { loadFixtureWeek } from "../src/fixtures";
import { gpBridge, jtV4, pctV4, plRowsFromMart, plRowsToMart, weekHeadline, weekOutlook, weekPlDaily } from "../src/week-outlook";

const r = computeWeek(loadFixtureWeek("2026-08-24", "2026-08-27"));
const rows = weekPlDaily(r);
const week = { weekStart: r.week.weekStart, today: r.week.today };

describe("weekPlDaily = weekly P&L split per day", () => {
  it("Σ rows per line over the week = O_PnL projection per line, to the cent", () => {
    for (const l of r.statements.pnl.lines.filter((x) => x.kind === "line")) {
      const s = rows.filter((x) => x.pl_line === l.line).reduce((a, x) => a.plus((x.date < week.today ? x.actual : x.forecast) ?? 0), D(0));
      expect(s.minus(l.values.projection).abs().toNumber(), l.line).toBeLessThan(0.005);
    }
  });
  it("journal only before the update date, forecast from it; 7 days", () => {
    expect(rows.every((x) => (x.date < week.today ? x.basis === "journal" : x.basis !== "journal"))).toBe(true);
    expect(new Set(rows.map((x) => x.date)).size).toBeLessThanOrEqual(7);
    expect(rows.every((x) => x.date >= "2026-08-24" && x.date <= "2026-08-30")).toBe(true);
  });
  it("mart round trip keeps the totals", () => {
    const back = plRowsFromMart(plRowsToMart(rows) as never);
    expect(weekOutlook(back, week).projection.gp.toFixed(0)).toBe(weekOutlook(rows, week).projection.gp.toFixed(0));
  });
});

describe("weekOutlook (K5: GP P&L headline)", () => {
  const wo = weekOutlook(rows, week, { revenue: D("1572306370"), gp: D("-4182480.39"), nibt: D("-110967765.88"), basis: "jurnal" });
  it("GP P&L −67,5 jt (−4,1%), revenue 1.656,8 jt (journal 589,0 + PO 1.067,8)", () => {
    expect(jtV4(wo.projection.gp)).toBe("−67,5");
    expect(pctV4(wo.gpPct)).toBe("−4,1%");
    expect(jtV4(wo.projection.revenue)).toBe("1.656,8");
    expect(jtV4(wo.actual.revenue)).toBe("589,0");
    expect(jtV4(wo.forecast.revenue)).toBe("1.067,8");
    expect(wo.poShare?.toFixed(2)).toBe("1.00");
  });
  it("NIBT = weekly NET INCOME; Δ GP vs last week", () => {
    expect(wo.projection.nibt.minus(r.statements.pnl.get("NET INCOME").values.projection).abs().toNumber()).toBeLessThan(0.01);
    expect(jtV4(wo.deltaGp!)).toBe("−63,3");
  });
  it("days: actual 24–26 (25 Aug without journal), PO 27–29, Sunday none", () => {
    expect(wo.days.map((d) => d.kind)).toEqual(["actual", "actual", "actual", "po", "po", "po", "none"]);
    expect(jtV4(wo.days[1].revenue)).toBe("0,0");
  });
});

describe("gpBridge GP produk → GP P&L", () => {
  const total = r.block1.find((b) => b.segment === "TOTAL KGR")!;
  const b = gpBridge({ revenueProduk: total.revenueProjection, gpProduk: total.gpProjection, rows, week });
  it("−47,6 + 17,8 − 0,8 − 20,6 − 16,4 = −67,5; residual ≤ Rp 1", () => {
    expect(b.steps.map((s) => [s.code, jtV4(s.value)])).toEqual([
      ["gp_produk", "−47,6"], ["timing", "17,8"], ["cogs_mapping", "−0,8"], ["expedition", "−20,6"],
      ["blasting", "−16,4"], ["cogs_other", "0,0"], ["residual", "0,0"], ["gp_pl", "−67,5"],
    ]);
    expect(b.reconciled).toBe(true);
  });
});

describe("weekHeadline (§6.1 template)", () => {
  const wo = weekOutlook(rows, week);
  const segs = r.block1.map((s) => ({ segment: s.segment, gpProjection: s.gpProjection }));
  it("GP P&L, worst segment (GP produk), stock over the age limit", () => {
    expect(weekHeadline({ outlook: wo, segments: segs, stockOverAge: "2782158915.98", cash: null }))
      .toBe("GP P&L minggu ini diproyeksikan Rp −67,5 jt (−4,1%); RPA menyumbang Rp −62,6 jt. Stok di atas batas umur Rp 2.782,2 jt.");
  });
  it("cash slot only when the lowest is under 0,25 × the average", () => {
    const h = weekHeadline({ outlook: wo, segments: segs, stockOverAge: null, cash: { lowest: "289672109.68", lowestDate: "2026-08-28", average: "1200000000" } });
    expect(h).toBe("GP P&L minggu ini diproyeksikan Rp −67,5 jt (−4,1%); RPA menyumbang Rp −62,6 jt. Kas Jumat turun ke Rp 289,7 jt.");
    expect(weekHeadline({ outlook: wo, segments: segs, stockOverAge: null, cash: { lowest: "289672109.68", lowestDate: "2026-08-28", average: "824000000" } })).not.toContain("Kas");
    expect(weekHeadline({ outlook: null, segments: segs, stockOverAge: null, cash: null })).toBeNull();
  });
});

describe("weekCash (v1 cash flow while M6 is off)", () => {
  it("lowest Fri 28 Aug 289,7 jt; without the affiliate loan −910,3 jt; average closing 824,5 jt", async () => {
    const { weekCash } = await import("../src/week-outlook");
    const c = weekCash(r);
    expect([c.lowest.date, jtV4(c.lowest.balance), jtV4(c.lowestWithoutAffiliate), jtV4(c.average)]).toEqual(["2026-08-28", "289,7", "−910,3", "824,5"]);
    expect(c.affiliateTimingAssumed).toBe(false);
    expect(c.flows.map((f) => [f.label, jtV4(f.projection)])).toEqual([
      ["Penerimaan pelanggan", "1.872,9"], ["Bayar pemasok", "−1.325,0"], ["Bayar jasa", "−1.229,0"],
      ["Karyawan dan lain-lain", "−79,9"], ["Pinjaman afiliasi net", "1.200,0"], ["Arus kas bersih", "439,1"],
    ]);
  });
});
