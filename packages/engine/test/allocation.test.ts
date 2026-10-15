/** M3 allocation (PRD v3 §4.4 step 7, §8 M3): B_Alokasi_Stok golden — 2.000 kg allocated of 100 t on hand; FEFO + cut-off rules. */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { loadV3Fixture } from "../src/fixtures";
import { allocateFEFO, cutoffBlasts, lotsForAllocation, sellableOn, stockAllocationRecon } from "../src/allocation";
import { computeLedger, frozenKeyOf, ledgerInputsFromWeek, type LedgerInputs } from "../src/ledger";
import { loadFixtureWeek } from "../src/fixtures";
import { planningControls } from "../src/controls-v3";

type In = { stock_on_hand: { sku: string; kg: string }[]; stock_allocations: { sku: string; customer: string | null; kg: string | null; price: string | null }[]; customers: string[] };
const inp = loadV3Fixture<In>("demand-2026-09", "inputs.json");
const g = loadV3Fixture<Record<string, string | null>>("demand-2026-09", "golden.json");
const near = (a: { toNumber(): number }, b: string | null | undefined, tol = 1e-9) => expect(Math.abs(a.toNumber() - Number(b))).toBeLessThanOrEqual(tol);

describe("B_Alokasi_Stok golden", () => {
  const r = stockAllocationRecon({ stock: inp.stock_on_hand, allocations: inp.stock_allocations, customers: inp.customers });
  it("on hand 100 t, allocated 2.000 kg, remaining 98.000 kg; per SKU E/F/G/H 53:60", () => {
    near(r.totals.on_hand, g["B_Alokasi_Stok!D61"]);
    near(r.totals.allocated, g["B_Alokasi_Stok!E61"]);
    near(r.totals.allocated, g["B_Alokasi_Stok!E49"]);
    near(r.totals.remaining, g["B_Alokasi_Stok!F61"]);
    near(r.totals.value, g["B_Alokasi_Stok!G49"]);
    expect(r.totals.allocated.toFixed(0)).toBe("2000");
    expect(r.totals.on_hand.toFixed(0)).toBe("100000");
    r.rows.forEach((x, i) => {
      expect(x.sku).toBe(g[`B_Alokasi_Stok!B${53 + i}`]);
      near(x.on_hand, g[`B_Alokasi_Stok!D${53 + i}`]);
      near(x.allocated, g[`B_Alokasi_Stok!E${53 + i}`]);
      near(x.remaining, g[`B_Alokasi_Stok!F${53 + i}`]);
      near(x.pct, g[`B_Alokasi_Stok!G${53 + i}`]);
      expect(x.status).toBe(g[`B_Alokasi_Stok!H${53 + i}`]);
    });
  });
  it("recap per customer (E66:F86)", () => {
    r.perCustomer.forEach((c, i) => { near(c.kg, g[`B_Alokasi_Stok!E${66 + i}`]); near(c.value, g[`B_Alokasi_Stok!F${66 + i}`]); });
    near(r.perCustomer.reduce((a, c) => a.plus(c.kg), D(0)), g["B_Alokasi_Stok!E86"]);
  });
  it("status rules: OVER, Full, —", () => {
    const x = stockAllocationRecon({ stock: [{ sku: "A", kg: "10" }, { sku: "B", kg: "10" }, { sku: "C", kg: "0" }], allocations: [{ sku: "A", customer: "P", kg: "11", price: "100" }, { sku: "B", customer: "P", kg: "10", price: null }], customers: ["P"] });
    expect(x.rows.map((r) => r.status)).toEqual(["OVER — cek alokasi", "Full", "—"]);
    expect(x.perCustomer[0].value.toFixed(0)).toBe("1100");
  });
});

const W = { freshHours: () => 48, frozenDays: () => 30 };

describe("allocation rules (app flow)", () => {
  const lots = [
    { lot_ref: "L1", key: "K|Fresh", form: "fresh" as const, kg: "50", origin_date: "2026-09-08" },
    { lot_ref: "L2", key: "K|Fresh", form: "fresh" as const, kg: "100", origin_date: "2026-09-09" },
    { lot_ref: "L0", key: "K|Fresh", form: "fresh" as const, kg: "80", origin_date: "2026-09-06" }, // 4 days old: not sellable fresh
    { lot_ref: "Z1", key: "K|Frozen", form: "frozen" as const, kg: "40", origin_date: "2026-08-20" },
  ];
  it("FEFO: Confirmed before Tentative, larger value first; oldest sellable lot first; own key only", () => {
    const r = allocateFEFO({
      date: "2026-09-10", lots, windows: W,
      orders: [
        { ref: "t", key: "K|Fresh", delivery_date: "2026-09-10", demand_status: "Tentative", kg: "60", price: "50000" },
        { ref: "c1", key: "K|Fresh", delivery_date: "2026-09-10", demand_status: "Confirmed", kg: "30", price: "30000" },
        { ref: "c2", key: "K|Fresh", delivery_date: "2026-09-10", demand_status: "Confirmed", kg: "40", price: "40000" },
        { ref: "z", key: "K|Frozen", delivery_date: "2026-09-10", demand_status: "Confirmed", kg: "50" },
        { ref: "later", key: "K|Fresh", delivery_date: "2026-09-11", demand_status: "Confirmed", kg: "10" },
      ],
    });
    const a = r.allocations.map((x) => [x.sales_ref, x.lot_ref, x.kg.toFixed(0)]);
    expect(a).toEqual([["c2", "L1", "40"], ["c1", "L1", "10"], ["c1", "L2", "20"], ["z", "Z1", "40"], ["t", "L2", "60"]]);
    expect(r.unallocated.map((u) => [u.sales_ref, u.kg.toFixed(0)])).toEqual([["z", "10"]]);
    expect(r.lotsLeft.find((l) => l.lot_ref === "L2")!.kg.toFixed(0)).toBe("20");
    expect(sellableOn(lots[2], "2026-09-10", W)).toBe(false);
  });
  it("existing allocations hold their lot kg and cover their order; fulfilled kg is not allocated again", () => {
    const r = allocateFEFO({
      date: "2026-09-10", lots, windows: W, existing: [{ sales_ref: "m", lot_ref: "L1", kg: "50" }],
      orders: [{ ref: "m", key: "K|Fresh", delivery_date: "2026-09-10", demand_status: "Confirmed", kg: "60" }, { ref: "f", key: "K|Fresh", delivery_date: "2026-09-10", demand_status: "Confirmed", kg: "30", fulfilled_kg: "30" }],
    });
    expect(r.allocations.map((x) => [x.sales_ref, x.lot_ref, x.kg.toFixed(0)])).toEqual([["m", "L2", "10"]]);
  });
  it("cut-off: fresh left after today and after the coming days' orders (while still fresh) → blast to frozen with Rp downgrade", () => {
    const b = cutoffBlasts({
      date: "2026-09-10", windows: W, blastCostPerKg: "500", frozenKeyOf: (k) => k.replace("|Fresh", "|Frozen"),
      price: (k) => (k.endsWith("|Fresh") ? "40000" : "36000"),
      lotsLeft: [{ lot_ref: "L1", key: "K|Fresh", form: "fresh", kg: "30", origin_date: "2026-09-09" }, { lot_ref: "L2", key: "K|Fresh", form: "fresh", kg: "20", origin_date: "2026-09-10" }, { lot_ref: "Z1", key: "K|Frozen", form: "frozen", kg: "5", origin_date: "2026-09-01" }],
      // L1 (1 day old) is still fresh on the 11th (48 h), not on the 12th; L2 is fresh on both
      futureOrders: [{ key: "K|Fresh", delivery_date: "2026-09-11", kg: "10" }, { key: "K|Fresh", delivery_date: "2026-09-12", kg: "15" }],
    });
    expect(b.map((x) => [x.lot_ref, x.key_to, x.kg.toFixed(0), x.rp_downgrade.toFixed(0), x.blast_cost.toFixed(0)])).toEqual([["L1", "K|Frozen", "20", "80000", "10000"], ["L2", "K|Frozen", "5", "20000", "2500"]]);
  });
  it("lots for allocation from the ledger: actual stock before the date + today's stock-in; allocated sales of today excluded; ledger takes the allocated lot", () => {
    const inputs: LedgerInputs = {
      startDate: "2026-09-07", today: "2026-09-11",
      opening: [{ ref: "o1", item_code: "I1", key: "K|Fresh", kg: "100", value: "4000000", avg_age_days: "1" }],
      receipts: [{ ref: "r1", date: "2026-09-10", status: "Aktual", source: "Produksi RPA", item_code: "I1", key: "K|Fresh", kg: "50", unit_cost: "41000", document_ref: "B1" }],
      sales: [{ ref: "s1", date: "2026-09-10", status: "Aktual", item_code: "I1", key: "K|Fresh", kg: "30", hpp_actual: null, document_ref: "DO1" }],
      allocations: [{ sales_ref: "s1", lot_ref: "receipt:r1", kg: "40" }],
      keys: [{ key: "K|Fresh", form: "fresh" }], params: { blastCostPerKg: 0, defaultFreshWindowHours: 48, defaultFrozenAgeLimitDays: 30 },
    };
    const led = computeLedger(inputs);
    // the allocation (40 kg) never takes more than the sale (30 kg)
    const out = led.movements.filter((m) => m.type === "out_sale");
    expect(out.map((m) => [m.lot_ref, m.kg.toFixed(0)])).toEqual([["receipt:r1", "-30"]]);
    const av = lotsForAllocation(led, "2026-09-10", new Set(["s1"]));
    expect(av.map((l) => [l.lot_ref, D(l.kg).toFixed(0)])).toEqual([["opening:o1", "100"], ["receipt:r1", "50"]]);
    const av2 = lotsForAllocation(led, "2026-09-10", new Set());
    expect(av2.map((l) => [l.lot_ref, D(l.kg).toFixed(0)])).toEqual([["opening:o1", "100"], ["receipt:r1", "20"]]);
  });
});

describe("example week end-to-end (update date 27 Aug): lots → FEFO allocation → Terkirim → cut-off → ledger", () => {
  const w = loadFixtureWeek("2026-08-24");
  const base = ledgerInputsFromWeek(w);
  const date = base.today;
  const led0 = computeLedger(base);
  const lots = lotsForAllocation(led0, date, new Set());
  const orders = base.sales.filter((x) => x.status === "Order" && x.date === date).map((x) => ({ ref: x.ref, key: x.key ?? "", delivery_date: x.date, demand_status: "Confirmed", kg: x.kg ?? "0" }));
  const fefo = allocateFEFO({ date, orders, lots, windows: W });
  const left = allocateFEFO({ date, orders: [], lots, existing: fefo.allocations.map((a) => ({ sales_ref: a.sales_ref, lot_ref: a.lot_ref, kg: a.kg })), windows: W });
  const future = base.sales.filter((x) => x.status === "Order" && (x.date ?? "") > date).map((x) => ({ key: x.key ?? "", delivery_date: x.date!, kg: x.kg ?? "0" }));
  const cut = cutoffBlasts({ date, lotsLeft: left.lotsLeft, futureOrders: future, windows: W, frozenKeyOf: (k) => frozenKeyOf(k), price: () => null, blastCostPerKg: "0" });
  // Terkirim: today's PO lines become Aktual; the allocations and the cut-off blasts go back into the ledger
  const led1 = computeLedger({
    ...base,
    sales: base.sales.map((x) => (x.status === "Order" && x.date === date ? { ...x, status: "Aktual" } : x)),
    allocations: fefo.allocations.map((a) => ({ sales_ref: a.sales_ref, lot_ref: a.lot_ref, kg: a.kg })),
    blasts: cut.map((b, i) => ({ ref: `cut${i}`, date, lot_ref: b.lot_ref, kg: b.kg, to_key: b.key_to })),
  });
  it("today's PO lines are allocated from lots of their own key, never more than the lot holds", () => {
    expect(orders.length).toBeGreaterThan(0);
    expect(fefo.allocations.length).toBeGreaterThan(0);
    for (const a of fefo.allocations) expect(lots.find((l) => l.lot_ref === a.lot_ref)!.key).toBe(a.key);
    for (const l of left.lotsLeft) expect(l.kg.gte(0)).toBe(true);
    const sumAlloc = fefo.allocations.reduce((m, a) => m.plus(a.kg), D(0));
    const sumUn = fefo.unallocated.reduce((m, u) => m.plus(u.kg), D(0));
    expect(sumAlloc.plus(sumUn).toFixed(2)).toBe(orders.reduce((m, o) => m.plus(D(o.kg)), D(0)).toFixed(2));
  });
  it("Terkirim: each allocation is the line's out_sale on its lot (not assumed)", () => {
    for (const a of fefo.allocations) {
      const m = led1.movements.filter((x) => x.type === "out_sale" && x.sales_ref === a.sales_ref && x.lot_ref === a.lot_ref);
      expect(m.length).toBe(1);
      expect(m[0].kg.neg().toFixed(2)).toBe(a.kg.toFixed(2));
      expect(m[0].assumed).toBe(false);
      expect(m[0].planned).toBe(false);
    }
  });
  it("cut-off moves the fresh left over to frozen lots (blast:<ref>); C29 and C31 pass", () => {
    for (const [i, b] of cut.entries()) {
      const lot = led1.lots.find((l) => l.ref === `blast:cut${i}`);
      expect(lot?.form).toBe("frozen");
      expect(lot?.kg_in.toFixed(2)).toBe(b.kg.toFixed(2));
    }
    const c = planningControls({
      today: date, orders: [],
      allocated: fefo.allocations.map((a) => ({ sales_ref: a.sales_ref, kg: a.kg, line_kg: orders.find((o) => o.ref === a.sales_ref)!.kg })),
      blasts: cut.map((_, i) => ({ ref: `cut${i}`, lot_ref_to: led1.lots.some((l) => l.ref === `blast:cut${i}`) ? `blast:cut${i}` : null })),
    });
    expect(c.find((x) => x.code === "C29")!.status).toBe("LULUS");
    expect(c.find((x) => x.code === "C31")!.status).toBe("LULUS");
  });
});

