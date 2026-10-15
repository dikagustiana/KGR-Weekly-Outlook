/** M1 golden (PRD v3 §8): allocation per SKU = column L of every Pot_* sheet of 202609_Data_COGS_LB.xlsx, ± Rp 1. */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { allocateBatch, computeCostPool, costComponentOf, groupCostPerKg, idleCapacity, overheadBasisKg, poolsOfItemName, yieldGap } from "../src/costing";
import { costingControls } from "../src/controls-v3";
import { costingBatches, costingGolden, toAllocateInput } from "./costing-fixture";

const batches = costingBatches();
const golden = costingGolden();

describe("costing golden — 202609_Data_COGS_LB.xlsx column L (relative sales value)", () => {
  it("fixture covers Pot_ISA and Pot_AGRO sheets", () => {
    expect(batches.some((b) => b.sheet.startsWith("Pot_ISA"))).toBe(true);
    expect(batches.some((b) => b.sheet.startsWith("Pot_AGRO"))).toBe(true);
    expect(batches.length).toBeGreaterThanOrEqual(20);
  });

  for (const b of batches) {
    it(`${b.sheet}: COGS/kg per SKU = L ± Rp 1, COGS/item = M ± Rp 1`, () => {
      const r = allocateBatch(toAllocateInput(b));
      let checked = 0;
      for (const row of b.rows) {
        const line = r.lines.find((l) => l.ref === `${b.sheet}!${row.row}`)!;
        const L = golden[`${b.sheet}!L${row.row}`];
        const M = golden[`${b.sheet}!M${row.row}`];
        expect(line.costPerKg.minus(D(L ?? 0)).abs().toNumber(), `${b.sheet}!L${row.row} ${row.product}`).toBeLessThanOrEqual(1);
        expect(line.allocatedCost.minus(D(M ?? 0)).abs().toNumber(), `${b.sheet}!M${row.row}`).toBeLessThanOrEqual(1);
        checked++;
      }
      expect(checked).toBe(b.rows.length);
      // totals: Σ allocated (M total) and the cost pool (F total + Biaya BL when it has members)
      const Mtot = D(golden[`${b.sheet}!M${b.total_row}`] ?? 0);
      expect(r.totalAllocated.minus(Mtot).abs().toNumber()).toBeLessThanOrEqual(1);
    });
  }

  it("where Biaya BL is allocated, its rows are exactly the items named Boneless (Excel SUMIF)", () => {
    const agro22 = batches.find((b) => b.sheet === "Pot_AGRO22")!;
    for (const row of agro22.rows) expect(poolsOfItemName(row.item_name).includes("boneless")).toBe(row.boneless_pool);
  });

  it("C21 is green for every batch with output; batches without output (D2) are flagged", () => {
    const allocs = batches.map((b) => allocateBatch(toAllocateInput(b)));
    const withOut = allocs.filter((a) => a.lines.length > 0);
    expect(withOut.every((a) => a.diff.abs().lte(1))).toBe(true);
    const c = costingControls({ allocations: withOut, batches: [], pools: [], yieldGapTolerance: "0.02" });
    expect(c.find((x) => x.code === "C21")!.status).toBe("LULUS");
    const empty = allocs.filter((a) => a.lines.length === 0).map((a) => a.batchRef).sort();
    expect(empty).toEqual(["Pot_AGRO28", "Pot_AGRO29", "Pot_AGRO30"]);
  });

  it("D1: Σ SKU kg vs hasil potong is 8–10% short on the September ISA batches → C22 GAGAL at 2%", () => {
    const states = batches.filter((b) => b.processed_kg).map((b) => ({
      ref: b.sheet, status: "Aktual", processed_kg: b.processed_kg, allocation_status: null,
      output_kg: b.rows.reduce((a, r) => a + Number(r.kg ?? 0) + Number(r.kg_non_blasting ?? 0), 0).toFixed(2),
    }));
    const isa30 = states.find((s) => s.ref === "Pot_ISA30")!;
    const g = yieldGap(isa30.processed_kg, isa30.output_kg).gapPct!.toNumber();
    expect(g).toBeGreaterThan(0.08);
    expect(g).toBeLessThan(0.10);
    const c = costingControls({ allocations: [], batches: states, pools: [], yieldGapTolerance: "0.02" });
    expect(c.find((x) => x.code === "C22")!.status).toBe("GAGAL");
  });
});

describe("costing rules", () => {
  const base = {
    batch: { ref: "B1", mode: "maklon" as const, lb_kg: "1000" },
    outputs: [
      { ref: "a", key: "RPA|Karkas|Fresh", kg: "700", price_ref: "30000" },
      { ref: "b", key: "RPA|Kepala|Fresh", kg: "50", price_ref: "10000", by_product: true },
      { ref: "c", key: "RPA|Ceker|Fresh", kg: "30", price_ref: null },
    ],
    costLines: [{ component: "LB" as const, amount: "20000000" }, { component: "freight" as const, amount: "1000000" }],
    options: { byProductMethod: "joint" as const },
  };

  it("joint: share by sales value, every rupiah allocated, unpriced rows get nothing", () => {
    const r = allocateBatch(base);
    expect(r.totalCost.toFixed(0)).toBe("21000000");
    expect(r.diff.abs().lte(0.000001)).toBe(true);
    const a = r.lines.find((l) => l.ref === "a")!;
    expect(a.share.toFixed(6)).toBe(D(21000000).div(21500000).toFixed(6));
    expect(r.lines.find((l) => l.ref === "c")!.allocatedCost.isZero()).toBe(true);
    expect(r.issues.some((i) => i.includes("harga acuan kosong"))).toBe(true);
  });

  it("nrv: by-product at NRV, the rest to the main products", () => {
    const r = allocateBatch({ ...base, options: { byProductMethod: "nrv", sellingCostPerKg: "1000" } });
    const b = r.lines.find((l) => l.ref === "b")!;
    expect(b.allocatedCost.toFixed(0)).toBe(D(9000).times(50).toFixed(0));
    expect(b.byProductMethod).toBe("nrv");
    expect(r.lines.find((l) => l.ref === "a")!.allocatedCost.toFixed(0)).toBe(D(21000000).minus(450000).toFixed(0));
    expect(r.diff.abs().lte(0.000001)).toBe(true);
  });

  it("NRV test: write-down when cost per kg exceeds price − selling cost", () => {
    const r = allocateBatch({ ...base, costLines: [{ component: "LB", amount: "30000000" }] });
    const a = r.lines.find((l) => l.ref === "a")!;
    expect(a.costPerKg.gt(30000)).toBe(true);
    expect(a.nrvWritedown.toFixed(2)).toBe(a.costPerKg.minus(30000).times(700).toFixed(2));
    const cheap = allocateBatch(base).lines.find((l) => l.ref === "a")!;
    expect(cheap.nrvWritedown.isZero()).toBe(true);
  });

  it("own mode: overhead = head_count × avg_lb_kg × rate, else kg LB × rate; idle capacity is a period cost", () => {
    expect(overheadBasisKg({ ref: "x", mode: "own", lb_kg: "1000", head_count: "450", avg_lb_kg: "2" }).toFixed(0)).toBe("900");
    expect(overheadBasisKg({ ref: "x", mode: "own", lb_kg: "1000" }).toFixed(0)).toBe("1000");
    const r = allocateBatch({ ...base, batch: { ref: "B1", mode: "own", lb_kg: "1000" }, overheadRate: { rate_per_kg_lb: "1500", basis_kg: "30000" } });
    expect(r.overheadCost.toFixed(0)).toBe("1500000");
    expect(r.totalCost.toFixed(0)).toBe("22500000");
    expect(allocateBatch({ ...base, batch: { ref: "B1", mode: "own", lb_kg: "1000" } }).issues.some((i) => i.includes("tarif overhead"))).toBe(true);
    const idle = idleCapacity({ rate_per_kg_lb: "1500", basis_kg: "30000" }, "25000");
    expect(idle.idleCost.toFixed(0)).toBe("7500000");
    expect(idleCapacity({ rate_per_kg_lb: "1500", basis_kg: "30000" }, "31000").idleCost.isZero()).toBe(true);
  });

  it("secondary pool without members falls back to the main pool", () => {
    const r = allocateBatch({ ...base, costLines: [...base.costLines, { component: "blast", amount: "500000", pool: "boneless" }] });
    expect(r.diff.abs().lte(0.000001)).toBe(true);
    expect(r.issues.some((i) => i.includes("Pool boneless"))).toBe(true);
  });

  it("batch without outputs allocates nothing (C21 GAGAL)", () => {
    const r = allocateBatch({ ...base, outputs: [] });
    expect(r.totalAllocated.isZero()).toBe(true);
    expect(costingControls({ allocations: [r], batches: [], pools: [], yieldGapTolerance: "0.02" })[0].status).toBe("GAGAL");
  });

  it("cost components from WP / PI labels", () => {
    expect(costComponentOf("Live Bird")).toBe("LB");
    expect(costComponentOf("Biaya Ekspedisi")).toBe("freight");
    expect(costComponentOf("Biaya Potong")).toBe("maklon");
    expect(costComponentOf("Biaya BL")).toBe("blast");
    expect(costComponentOf("Sewa RPA")).toBe("overhead");
    expect(costComponentOf("Lain")).toBe("other");
  });

  it("group cost per kg and cost pool tie-out (C23)", () => {
    const r = allocateBatch(base);
    const g = groupCostPerKg(r.lines, new Map([["RPA|Karkas|Fresh", "KARKAS"], ["RPA|Kepala|Fresh", "BYPRODUCT"]]));
    expect(g.map((x) => x.group)).toEqual(["BYPRODUCT", "KARKAS", "TANPA GRUP"]);
    const p = computeCostPool({ lines: [{ component: "LB", amount: "100", batch_ref: "B1" }, { component: "overhead", amount: "50" }], glTotal: "150.5" });
    expect(p.tied).toBe(true);
    expect(p.direct.toFixed(0)).toBe("100");
    expect(computeCostPool({ lines: [{ component: "LB", amount: "100" }], glTotal: "102" }).tied).toBe(false);
    expect(computeCostPool({ lines: [], glTotal: null }).diff).toBeNull();
    const c23 = costingControls({ allocations: [], batches: [], pools: [computeCostPool({ lines: [{ component: "LB", amount: "100" }], glTotal: "102" })], yieldGapTolerance: "0.02" });
    expect(c23.find((x) => x.code === "C23")!.status).toBe("GAGAL");
  });

  it("C24: an Aktual batch without a posted allocation blocks the monthly release", () => {
    const c = costingControls({ allocations: [], pools: [], yieldGapTolerance: "0.02", batches: [
      { ref: "B1", status: "Aktual", processed_kg: "100", output_kg: "99", allocation_status: "posted" },
      { ref: "B2", status: "Aktual", processed_kg: "100", output_kg: "99", allocation_status: "draft" },
      { ref: "B3", status: "Rencana", processed_kg: null, output_kg: "0", allocation_status: null },
    ] });
    expect(c.find((x) => x.code === "C24")!.status).toBe("GAGAL");
    expect(c.find((x) => x.code === "C24")!.detail).toEqual(["B2: draft"]);
    expect(c.find((x) => x.code === "C22")!.status).toBe("LULUS");
  });
});
