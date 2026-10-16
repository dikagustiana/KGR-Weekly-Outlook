/** PRD v5 §4.2–4.4 (K27, K28, C50, C51, C58) on fixtures/plan-2026-08-24 v5: Lampiran B.3 and B.4. */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { c50, c51, c58, classByProducts, dailyClassPlan, needByCutDate, netShareOf, sizeCode, sizeKgOf, toClassLB, weekClassPlan, type SizedLine } from "../src/ppic-class";
import { planDemand, planInp, planOrders, planWeek, planGold } from "./plan-fixture";

type V5In = { size_class_map: { size_kg: string; weight_class: string }[]; yield_karkas: Record<string, string>; avg_kg: Record<string, string>; mid_offset: string; fallback_class: string; lead_time_days: number; karkas_keys: string[] };
type V5Gold = {
  by_size: Record<string, { po_kg: string; class: string; lb_per_head: string; kg_lb: string; heads: string }>;
  by_class: Record<string, { kg_lb: string; heads: string }>; total: { po_kg: string; kg_lb: string; heads: string; lb_per_head: string };
  daily: { cut: string; ship: string; karkas_kg: string; kg_lb: string; heads: string; K: string; S: string; B: string; unsized: string }[];
  cut_2026_08_28_kg_lb: Record<string, string>; by_product_shortfall_kg: Record<string, string>; batch_plan: { kg_lb: string; surplus_kg: string; downgrade_jt: string };
};
const v5 = (planInp as unknown as { v5: V5In }).v5;
const gold = (planGold as unknown as { v5: V5Gold }).v5;
const names = new Map((planWeek.item_map as unknown as { item_code: string; item_name: string | null }[]).map((i) => [i.item_code, i.item_name]));
const codeOf = new Map((planWeek.sales_lines as unknown as { row: number; item_code: string | null }[]).map((s) => [String(s.row), s.item_code]));
const demand = planDemand();
const lines: SizedLine[] = planOrders().filter((o) => v5.karkas_keys.includes(o.key)).map((o) => ({
  ship_date: o.delivery_date!, key: o.key, size_kg: sizeKgOf(names.get(codeOf.get(o.ref) ?? "") ?? null), kg: o.kg,
}));
const setup = {
  classOf: (s: ReturnType<typeof D>) => v5.size_class_map.find((m) => D(m.size_kg).eq(s))?.weight_class ?? null,
  yieldKarkas: (c: string) => v5.yield_karkas[c] ?? null, avgKg: (c: string) => v5.avg_kg[c] ?? null, midOffset: v5.mid_offset, fallback: v5.fallback_class,
};
const cd = toClassLB({ lines, netShare: netShareOf(demand.rows), setup });
const near = (a: { toNumber(): number } | number, b: string | number, tol = 1) => expect(Math.abs((typeof a === "number" ? a : a.toNumber()) - Number(b)), `${typeof a === "number" ? a : a.toNumber()} vs ${b}`).toBeLessThanOrEqual(tol);

describe("size from the item name (O3, O4)", () => {
  it("'Uk x.x' → kg per head of karkas; no size → null; code", () => {
    expect(sizeKgOf("Karkas Uk 1.3 Karkas Uk 1.3 Fresh Premium")!.toFixed(2)).toBe("1.30");
    expect(sizeKgOf("Karkas Uk 0,9 Fresh")!.toFixed(2)).toBe("0.90");
    expect(sizeKgOf("Ayam Karkas Mix")).toBeNull();
    expect([sizeCode("1.30"), sizeCode(null)]).toEqual(["Uk 1.3", "tanpa"]);
  });
});

describe("K28 toClassLB = Lampiran B.3 (kirim 27–29 Agu, yield placeholder 71,46%)", () => {
  it("per size: PO kg, class, kg LB per head, kg LB, heads (±1)", () => {
    for (const [code, g] of Object.entries(gold.by_size)) {
      const r = cd.bySize.find((x) => x.size_code === code)!;
      expect(r, code).toBeDefined();
      expect(r.weight_class, code).toBe(g.class);
      near(r.po_kg, g.po_kg); near(r.kg_lb, g.kg_lb); near(r.heads, g.heads);
      expect(r.lb_per_head!.toFixed(2), code).toBe(g.lb_per_head);
    }
  });
  it("per class K 2.548 / S 8.212 / B 6.463 / STD 1.135 kg LB; total 18.358 kg LB, ± 9.871 heads, 1,86 kg LB per head", () => {
    for (const [c, g] of Object.entries(gold.by_class)) {
      const r = cd.byClass.find((x) => x.weight_class === c)!;
      near(r.kg_lb, g.kg_lb);
      near(r.heads, g.heads);   // S: 4.420,5 (PRD 4.420)
    }
    near(cd.total.po_kg, gold.total.po_kg); near(cd.total.kg_lb, gold.total.kg_lb);
    expect(cd.total.heads.toFixed(0)).toBe(gold.total.heads);
    expect(cd.total.lb_per_head!.toFixed(2)).toBe(gold.total.lb_per_head);
    // the same kg LB as v4 (one STD class): only the heads change (9.179 → 9.871)
    near(cd.total.kg_lb, planGold.kg_lb);
  });
  it("C50: 811 kg karkas without a size (kirim 27 Agu) counted at STD", () => {
    const c = c50(cd);
    expect(c.status).toBe("PERIKSA");
    expect(c.detail).toEqual(["kirim 2026-08-27: 811 kg tanpa kelas"]);
    expect(cd.rows.filter((r) => !r.mapped).every((r) => r.weight_class === "STD")).toBe(true);
  });
  it("by-products do not add kg LB; shortfall as v4 B.3 (HJA 1.022, Usus 897, Kepala 842, Ceker 548)", () => {
    const yields = (planInp.yields as { pattern: string; key: string; yield_pct: string }[]).filter((y) => y.pattern === "karkas");
    const net = demand.unitNet.filter((u) => u.key !== "Karkas" && gold.by_product_shortfall_kg[u.key] !== undefined).map((u) => ({ unit: u.key, kg: u.kg }));
    const bp = classByProducts({ byClass: cd.byClass, yieldOf: (_c, unit) => yields.find((y) => y.key === unit)?.yield_pct ?? null, net });
    for (const [u, kg] of Object.entries(gold.by_product_shortfall_kg)) near(bp.find((b) => b.unit === u)!.shortfall_kg, kg);
  });
});

describe("§4.4 daily plan per class (Lampiran B.4, cut H−1)", () => {
  const days = dailyClassPlan({ demand: cd, leadTimeDays: v5.lead_time_days });
  it("Rab 26 → 7.461 kg LB (0 / 2.081 / 1.221 + 568 tanpa ukuran), Kam 27 → 4.664, Jum 28 → 6.233", () => {
    expect(days.map((d) => [d.cut_date, d.ship_date])).toEqual(gold.daily.map((g) => [g.cut, g.ship]));
    for (const g of gold.daily) {
      const d = days.find((x) => x.cut_date === g.cut)!;
      near(d.karkas_kg, g.karkas_kg); near(d.kg_lb, g.kg_lb); near(d.heads, g.heads);
      for (const c of ["K", "S", "B"] as const) near(d.byClass.find((b) => b.weight_class === c)?.heads ?? 0, g[c]);
      near(d.unsizedHeads, g.unsized);
    }
    const fri = days.find((d) => d.cut_date === "2026-08-28")!;
    for (const [c, kg] of Object.entries(gold.cut_2026_08_28_kg_lb)) near(fri.byClass.find((b) => b.weight_class === c)!.kg_lb, kg);
  });
  it("C58: supply per class below the need → PERIKSA; none entered → BELUM DIISI; enough → LULUS", () => {
    const need = needByCutDate(days);
    expect(c58({ need, supply: [] }).status).toBe("BELUM DIISI");
    const full = need.map((n) => ({ date: n.cut_date, weight_class: n.weight_class, kg_lb: n.kg_lb.plus(1).toFixed(0) }));
    expect(c58({ need, supply: full }).status).toBe("LULUS");
    const short = full.map((s) => (s.date === "2026-08-28" && s.weight_class === "S" ? { ...s, kg_lb: "2400" } : s));
    const c = c58({ need, supply: short });
    expect(c.status).toBe("PERIKSA");
    expect(c.detail[0]).toBe("2026-08-28 S: supply 2400 < kebutuhan 2456 kg LB");
  });
});

describe("§4.3 the saved plan: batch rencana 27.219 kg LB", () => {
  it("surplus ± 6.332 kg karkas, downgrade 32,0 jt at 36.705 / 31.658", () => {
    const p = weekClassPlan({ kgLb: gold.batch_plan.kg_lb, demandKarkasKg: cd.total.net_kg, yieldKarkas: v5.yield_karkas.STD, priceFresh: "36705", priceFrozen: "31658" });
    near(p.surplus_kg, gold.batch_plan.surplus_kg, 2);
    near(p.downgrade!.div(1e6).toNumber(), gold.batch_plan.downgrade_jt, 0.1);
    expect(weekClassPlan({ kgLb: cd.total.kg_lb, demandKarkasKg: cd.total.net_kg, yieldKarkas: v5.yield_karkas.STD, priceFresh: "36705", priceFrozen: "31658" }).surplus_kg.toFixed(0)).toBe("0");
  });
});

describe("C51: classes used but not registered", () => {
  it("K, S, B in an upload before the master has them → GAGAL; registered → LULUS", () => {
    const used = ["K", "S", "B"].map((c) => ({ source: "yield", weight_class: c }));
    expect(c51({ registered: ["STD"], used }).status).toBe("GAGAL");
    expect(c51({ registered: ["STD"], used }).detail).toEqual(["K (yield)", "S (yield)", "B (yield)"]);
    expect(c51({ registered: ["STD", "K", "S", "B"], used }).status).toBe("LULUS");
  });
});
