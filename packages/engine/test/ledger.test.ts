/** M2 golden (PRD v3 §8): lot ledger of the example week vs the v1 stock projection (O_Stok) and Accurate's DO cost. */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { addDays, weekDays } from "../src/dates";
import { computeWeek } from "../src/week";
import { loadFixtureWeek } from "../src/fixtures";
import { balanceAt, computeLedger, frozenKeyOf, ledgerInputsFromWeek, reconcile, type LedgerInputs } from "../src/ledger";

const week = loadFixtureWeek("2026-08-24", "2026-08-27");
const v1 = computeWeek(week);
const li = ledgerInputsFromWeek(week);
const led = computeLedger(li);

describe("ledger golden — example week 24–30 Aug 2026 (update 27 Aug)", () => {
  it("balance at the start of 24 Aug = opening stock per key (± 0,01 kg)", () => {
    const day0 = balanceAt(led, addDays("2026-08-24", -1), li.keys, li.params);
    // opening lots are dated before 24 Aug by their age; their in-movement is on 24 Aug
    const open = balanceAt(computeLedger({ ...li, receipts: [], sales: [] }), "2026-08-24", li.keys, li.params);
    for (const r of v1.stock.rows) {
      const k = open.perKey.find((x) => x.key === r.key);
      expect((k?.kg ?? D(0)).minus(r.openingKg).abs().toNumber(), r.key).toBeLessThanOrEqual(0.01);
    }
    expect(open.totalKg.toFixed(2)).toBe("162687.92");
    expect(day0.totalKg.isZero()).toBe(true);
  });

  it("roll-forward 162.687 → 156.956 kg: every day and key equals the O_Stok closing (± 0,01 kg)", () => {
    for (const [i, d] of weekDays("2026-08-24").entries()) {
      const b = balanceAt(led, d, li.keys, li.params);
      for (const r of v1.stock.rows) {
        const k = b.perKey.find((x) => x.key === r.key);
        expect((k?.kg ?? D(0)).minus(r.closing[i]).abs().toNumber(), `${d} ${r.key}`).toBeLessThanOrEqual(0.01);
      }
    }
    const sun = balanceAt(led, "2026-08-30", li.keys, li.params);
    expect(sun.totalKg.toFixed(2)).toBe("156956.05");
  });

  it("opening value = Σ opening stock value (MA and SI)", () => {
    const open = balanceAt(computeLedger({ ...li, receipts: [], sales: [] }), "2026-08-24", li.keys, li.params);
    expect(open.totalCostMa.toFixed(0)).toBe("3954932012");
    expect(open.totalCostSi.toFixed(0)).toBe("3954932012");
  });

  it("MA per item reproduces Accurate's DO cost on 30 of 34 actual sales lines (± Rp 1/kg)", () => {
    const rows = led.saleCosts.filter((s) => s.hppPerKg !== null);
    expect(rows.length).toBe(34);
    const ok = rows.filter((s) => s.maPerKg.minus(s.hppPerKg!).abs().lte(1));
    expect(ok.length).toBe(30);
    // the 4 others: karkas fresh of batches 125/126 on 26 Aug (GRN unit cost from ops ≠ Accurate re-costed value)
    expect(rows.filter((s) => !ok.includes(s)).map((s) => s.item_code).sort()).toEqual(["JLB0790", "JLB0856", "JLB0922", "JLB0988"]);
  });

  // O13 (PRD v5.2-A §6): the ≥ 95% target of PRD v3 §8 M2 is not reached on the August fixture. The exception is written
  // (docs/open-questions.md, row M2 "MA per key = hpp_actual") and this test locks what is reproducible: 30 of 34 lines
  // (88,2%) and the four lines that differ with their gap in Rp/kg (MA − Accurate). A change in the ledger that moves
  // any of these numbers must update the exception, not slip by.
  it("O13 exception: MA = hpp_actual ± Rp 1/kg on 88,2% (30 of 34) of the lines, not the 95% target; the four others and their gap per kg are locked", () => {
    const rows = led.saleCosts.filter((s) => s.hppPerKg !== null);
    const ok = rows.filter((s) => s.maPerKg.minus(s.hppPerKg!).abs().lte(1));
    const share = ok.length / rows.length;
    expect((share * 100).toFixed(1)).toBe("88.2");
    expect(share).toBeLessThan(0.95);
    const gap = rows.filter((s) => !ok.includes(s)).map((s) => [s.item_code, s.maPerKg.minus(s.hppPerKg!).toFixed(2)]).sort(([a], [b]) => String(a).localeCompare(String(b)));
    expect(gap).toEqual([["JLB0790", "17.25"], ["JLB0856", "180.28"], ["JLB0922", "259.38"], ["JLB0988", "196.32"]]);
  });

  it("C25: every outflow without a lot on the DO is assumed (FIFO)", () => {
    const r = reconcile({ ledger: led, balance: balanceAt(led, "2026-08-26", li.keys, li.params), stockCard: null, bsInventory: null });
    expect(r.assumedPct!.toFixed(4)).toBe("1.0000");
    expect(r.outKg.toFixed(2)).toBe("23587.97");
  });

  it("C27: MA value at 23 Aug vs the balance sheet, with the D3 reconciling item, closes to 0", () => {
    const open = balanceAt(computeLedger({ ...li, receipts: [], sales: [] }), "2026-08-24", li.keys, li.params);
    const bs = v1.statements.bs.get("Inventory - Product").values.lastWeekEnd.plus(v1.statements.bs.get("Inventory - Trading").values.lastWeekEnd);
    const r = reconcile({ ledger: led, balance: open, stockCard: null, bsInventory: bs, reconcilingItems: [{ label: "D3", amount: "174325606.86" }] });
    expect(r.bsDiff!.abs().lte(1)).toBe(true);
    const r0 = reconcile({ ledger: led, balance: open, stockCard: null, bsInventory: bs });
    expect(r0.bsDiff!.toFixed(2)).toBe("174325606.86");
  });
});

describe("ledger rules", () => {
  const keys = [{ key: "RPA|Karkas|Fresh", form: "fresh" as const }, { key: "RPA|Karkas|Frozen", form: "frozen" as const }];
  const base: LedgerInputs = {
    startDate: "2026-09-01", today: "2026-09-10",
    opening: [{ ref: "o1", item_code: "A", key: "RPA|Karkas|Fresh", kg: "100", value: "3000000", avg_age_days: "1" }],
    receipts: [
      { ref: "r1", date: "2026-09-02", status: "Aktual", source: "Produksi RPA", item_code: "A", key: "RPA|Karkas|Fresh", kg: "100", unit_cost: "36000", document_ref: "B1" },
      { ref: "r2", date: "2026-09-11", status: "Rencana", source: "Produksi RPA", item_code: "A", key: "RPA|Karkas|Fresh", kg: "50", unit_cost: "35000" },
    ],
    sales: [
      { ref: "s1", date: "2026-09-03", status: "Aktual", item_code: "A", key: "RPA|Karkas|Fresh", kg: "150", hpp_actual: "4950000" },
      { ref: "s2", date: "2026-09-12", status: "Order", item_code: "A", key: "RPA|Karkas|Fresh", kg: "40" },
      { ref: "s3", date: "2026-09-05", status: "Order", item_code: "A", key: "RPA|Karkas|Fresh", kg: "999" },
    ],
    keys, params: { blastCostPerKg: "500", defaultFreshWindowHours: 48, defaultFrozenAgeLimitDays: 30 },
  };

  it("FIFO for SI, moving average for MA; past-dated orders are ignored", () => {
    const r = computeLedger(base);
    const out = r.movements.filter((m) => m.ref_id === "s1");
    expect(out.map((m) => [m.lot_ref, m.kg.toFixed(0), m.cost_si.toFixed(0)])).toEqual([["opening:o1", "-100", "-3000000"], ["receipt:r1", "-50", "-1800000"]]);
    // MA = (3.000.000 + 3.600.000) / 200 = 33.000 → 150 kg = 4.950.000 = Accurate HPP
    expect(out.reduce((a, m) => a.plus(m.cost_ma), D(0)).toFixed(0)).toBe("-4950000");
    expect(r.saleCosts[0].maPerKg.toFixed(0)).toBe("33000");
    expect(r.movements.some((m) => m.ref_id === "s3")).toBe(false);
  });

  it("balances: actual before today, plans from today; future orders are reserved", () => {
    const r = computeLedger(base);
    const b5 = balanceAt(r, "2026-09-05", keys, base.params);
    expect(b5.totalKg.toFixed(0)).toBe("50");
    expect(b5.perKey[0].cost_per_kg_ma!.toFixed(0)).toBe("33000");
    expect(b5.perKey[0].cost_per_kg_si!.toFixed(0)).toBe("36000");
    expect(b5.perLot[0].reserved_kg.toFixed(0)).toBe("40");
    expect(b5.perKey[0].free_kg.toFixed(0)).toBe("10");
    expect(b5.perLot[0].age_days).toBe(3);
    expect(b5.perLot[0].hours_to_cutoff).toBe(48 - 72);
    expect(b5.perLot[0].over_age).toBe(true);
    const b12 = balanceAt(r, "2026-09-12", keys, base.params);
    expect(b12.totalKg.toFixed(0)).toBe("60");
  });

  it("selling more than stock books the excess on a deficit lot (negative stock, assumed)", () => {
    const r = computeLedger({ ...base, sales: [{ ref: "s9", date: "2026-09-03", status: "Aktual", item_code: "A", key: "RPA|Karkas|Fresh", kg: "250" }] });
    const b = balanceAt(r, "2026-09-03", keys, base.params);
    expect(b.totalKg.toFixed(0)).toBe("-50");
    expect(r.issues.some((i) => i.includes("melebihi stok"))).toBe(true);
  });

  it("explicit allocation (M3) replaces FIFO and is not assumed", () => {
    const r = computeLedger({ ...base, allocations: [{ sales_ref: "s1", lot_ref: "receipt:r1", kg: "100" }] });
    const out = r.movements.filter((m) => m.ref_id === "s1");
    expect(out[0].lot_ref).toBe("receipt:r1");
    expect(out[0].assumed).toBe(false);
    expect(out[1].assumed).toBe(true);
  });

  it("blast: out of the fresh lot + a frozen lot (parent) at SI + blast cost", () => {
    const r = computeLedger({ ...base, sales: [], blasts: [{ ref: "b1", date: "2026-09-04", lot_ref: "receipt:r1", kg: "60" }] });
    const lot = r.lots.find((l) => l.ref === "blast:b1")!;
    expect(lot.key).toBe("RPA|Karkas|Frozen");
    expect(lot.parent_ref).toBe("receipt:r1");
    expect(lot.cost_per_kg_si.toFixed(0)).toBe("36500");
    const b = balanceAt(r, "2026-09-04", keys, base.params);
    expect(b.perKey.find((k) => k.key === "RPA|Karkas|Fresh")!.kg.toFixed(0)).toBe("140");
    expect(b.perKey.find((k) => k.key === "RPA|Karkas|Frozen")!.kg.toFixed(0)).toBe("60");
    expect(b.totalKg.toFixed(0)).toBe("200");
    expect(frozenKeyOf("Trading|BLD|Frozen")).toBe("Trading|BLD|Frozen");
  });

  it("adjustment (opname) changes kg at the lot cost; C26 compares with the stock card", () => {
    const r = computeLedger({ ...base, sales: [], adjustments: [{ ref: "a1", date: "2026-09-04", key: "RPA|Karkas|Fresh", item_code: "A", kg: "-5" }] });
    const b = balanceAt(r, "2026-09-04", keys, base.params);
    expect(b.totalKg.toFixed(0)).toBe("195");
    const rec = reconcile({ ledger: r, balance: b, stockCard: [{ item_code: "A", key: "RPA|Karkas|Fresh", kg: "195" }], bsInventory: null });
    expect(rec.cardDiffs.map((c) => c.diff.toFixed(2))).toEqual(["0.00"]);
    expect(rec.assumedPct).toBeNull();
  });
});

describe("ledger: book cost vs specific cost", () => {
  it("MA uses the GRN (book) cost, SI the M1 allocation cost", () => {
    const keys = [{ key: "RPA|Karkas|Fresh", form: "fresh" as const }];
    const r = computeLedger({
      startDate: "2026-09-01", today: "2026-09-30", opening: [], keys, params: { blastCostPerKg: "0", defaultFreshWindowHours: 48, defaultFrozenAgeLimitDays: 30 },
      receipts: [{ ref: "r1", date: "2026-09-02", status: "Aktual", source: "Produksi RPA", item_code: "A", key: "RPA|Karkas|Fresh", kg: "100", unit_cost: "36000", cost_per_kg_si: "38000", document_ref: "B1" }],
      sales: [{ ref: "s1", date: "2026-09-03", status: "Aktual", item_code: "A", key: "RPA|Karkas|Fresh", kg: "10" }],
    });
    const out = r.movements.find((m) => m.ref_id === "s1")!;
    expect(out.cost_ma.toFixed(0)).toBe("-360000");
    expect(out.cost_si.toFixed(0)).toBe("-380000");
    expect(out.ref).toBe("out_sale:sales_line:s1:receipt:r1");
    const b = balanceAt(r, "2026-09-03", keys, { blastCostPerKg: "0", defaultFreshWindowHours: 48, defaultFrozenAgeLimitDays: 30 });
    expect(b.perKey[0].cost_per_kg_ma!.toFixed(0)).toBe("36000");
    expect(b.perKey[0].cost_per_kg_si!.toFixed(0)).toBe("38000");
  });
});

import { prepare } from "../src/prepare";
import { keyResolver } from "../src/ledger";

describe("keyResolver = v1 key rule", () => {
  it("resolves every sales, receipt and opening row of the example week like prepare()", () => {
    const p = prepare(week);
    const k = keyResolver(week.item_map);
    for (const s of p.sales) expect(k(s.src.key_manual, s.src.item_code), `sales ${s.src.row}`).toBe(s.key);
    for (const r of p.receipts) expect(k(r.src.key_manual, r.src.item_code), `receipt ${r.src.row}`).toBe(r.key);
    for (const o of p.opening) expect(k(o.src.key_manual, o.src.item_code), `opening ${o.src.row}`).toBe(o.key);
  });
});
