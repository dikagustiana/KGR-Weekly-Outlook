/**
 * Backtest COGS LB Aug–Sep 2026 (docs/v5.3/backtest-cogs/REPORT.md), without the workbooks: the parsed inputs and the
 * sheet's own cells of every Pot_* sheet are in fixtures/backtest-cogs-2026-08-09/expected.json (written by
 * `pnpm backtest:cogs --write-fixture`). allocateBatch (path A) and planCost (path S) must give the same verdict per check
 * as the backtest recorded: equal within tolerance where it says equal, and still different where the report names a
 * cause (sheet formula range, BL outside planCost, batch without output). Paths P and W need the parser / web builder and
 * are covered by tests/backtest/cogs-lb/run.ts and packages/parsers/test/backtest-cogs.test.ts.
 */
import { describe, expect, it } from "vitest";
import { allocateBatch, planCost, type AllocateInput } from "../src/costing";
import { D, type Decimal } from "../src/decimal";
import { loadV3Fixture } from "../src/fixtures";

interface CellRef { cell: string; value: number | null }
interface FxBatch {
  month: string; sheet: string; hidden: boolean; rpa: string;
  inputs: { date: string | null; lb_kg: string | null; processed_kg: string | null; cost: { LB: string; freight: string; maklon: string; bl: string | null }; rows: { row: number; item_code: string | null; kg: string; price: string | null; boneless: boolean }[] };
  expected: Record<string, CellRef> & { L: Record<string, number | null> };
  result: Record<string, boolean | null>;
  rows_ok: { A: number; S: number; W: number };
}
const fx = loadV3Fixture<{ tolerance: Record<string, number>; batches: FxBatch[] }>("backtest-cogs-2026-08-09", "expected.json");

function input(b: FxBatch): AllocateInput {
  const c = b.inputs.cost;
  return {
    batch: { ref: b.sheet, date: b.inputs.date, mode: "maklon", lb_kg: b.inputs.lb_kg, processed_kg: b.inputs.processed_kg },
    outputs: b.inputs.rows.map((r) => ({ ref: String(r.row), item_code: r.item_code, kg: r.kg, price_ref: r.price, pools: r.boneless ? ["boneless"] : [] })),
    costLines: [
      { component: "LB", amount: c.LB }, { component: "freight", amount: c.freight }, { component: "maklon", amount: c.maklon },
      ...(c.bl ? [{ component: "blast" as const, amount: c.bl, pool: "boneless" }] : []),
    ],
    options: { byProductMethod: "joint" },
  };
}

const TOL = { total: 1, perkg: 0.01, ratio: 1e-6 };

describe("backtest COGS LB Agu–Sep 2026 (fixture, tanpa berkas asli)", () => {
  it("covers both months", () => {
    expect(fx.batches.filter((b) => b.month === "2026-08").length).toBeGreaterThanOrEqual(15);
    expect(fx.batches.filter((b) => b.month === "2026-09").length).toBeGreaterThanOrEqual(26);
  });

  for (const b of fx.batches) {
    it(`${b.month} ${b.sheet}: allocateBatch and planCost give the recorded verdicts`, () => {
      const A = allocateBatch(input(b));
      const value = A.lines.reduce((a, l) => a.plus(l.salesValue), D(0));
      const lbKg = b.inputs.lb_kg && !D(b.inputs.lb_kg).isZero() ? D(b.inputs.lb_kg) : null;
      const fr = D(b.inputs.cost.freight), mk = D(b.inputs.cost.maklon), bl = D(b.inputs.cost.bl);
      const S = lbKg ? planCost({ status: "final", kgLb: lbKg, lbPrice: D(b.inputs.cost.LB).div(lbKg), directCost: fr.plus(mk).plus(bl), outputs: b.inputs.rows.map((r) => ({ key: String(r.row), kg: r.kg, priceRef: r.price })) }) : null;
      const app: Record<string, [Decimal | null, string, keyof typeof TOL]> = {
        "A:biaya total": [A.totalCost, "total", "total"],
        "A:nilai jual": [value, "value", "total"],
        "A:COGS teralokasi": [A.totalAllocated, "cogs", "total"],
        "A:GP": [value.minus(A.totalAllocated), "gp", "total"],
        "A:GP ÷ biaya (Est. GP Margin)": [A.totalAllocated.isZero() ? null : value.div(A.totalAllocated).minus(1), "gp_margin", "ratio"],
        "S:harga LB Rp/kg": [S ? S.lbPrice : null, "lb_price", "perkg"],
        "S:biaya total": [S ? S.costPool : null, "total", "total"],
        "S:nilai jual": [S ? S.value : null, "value", "total"],
        "S:k": [S ? S.k : null, "k", "ratio"],
        "S:GP": [S ? S.gp : null, "gp", "total"],
        "S:breakeven Rp/kg LB": [S && !S.value.isZero() ? S.value.minus(fr).minus(mk).div(lbKg!) : null, "breakeven", "perkg"],
        "S:breakeven planCost (BL ikut dikurangi)": [S ? S.breakeven : null, "breakeven", "perkg"],
      };
      for (const [name, verdict] of Object.entries(b.result)) {
        if (!(name in app) || verdict === null) continue;
        const [v, key, kind] = app[name];
        const ref = b.expected[key].value;
        const ok = v !== null && ref !== null && Math.abs(v.toNumber() - ref) <= TOL[kind] + 1e-9;
        expect(ok, `${name} (${b.expected[key].cell}): app ${v?.toString() ?? "—"} sheet ${ref ?? "—"}`).toBe(verdict);
      }
      // COGS/kg per output row (column L)
      const rowOk = (got: Decimal | null | undefined, row: number) => got !== null && got !== undefined && b.expected.L[String(row)] !== null && Math.abs(got.toNumber() - b.expected.L[String(row)]!) <= TOL.perkg + 1e-9;
      expect(b.inputs.rows.filter((r) => rowOk(A.lines.find((l) => l.ref === String(r.row))?.costPerKg, r.row)).length, "baris L jalur A").toBe(b.rows_ok.A);
      if (S) expect(b.inputs.rows.filter((r) => rowOk(S.lines.find((l) => l.key === String(r.row))?.costPerKg, r.row)).length, "baris L jalur S").toBe(b.rows_ok.S);
    });
  }

  it("T24 (PRD v5.3) on Pot_ISA30: biaya, nilai jual, GP, COGS/kg premium and grade A, breakeven", () => {
    const b = fx.batches.find((x) => x.sheet === "Pot_ISA30")!;
    const lbKg = D(b.inputs.lb_kg);
    const S = planCost({ status: "final", kgLb: lbKg, lbPrice: D(b.inputs.cost.LB).div(lbKg), directCost: D(b.inputs.cost.freight).plus(D(b.inputs.cost.maklon)), outputs: b.inputs.rows.map((r) => ({ key: String(r.row), kg: r.kg, priceRef: r.price })) });
    expect(S.costPool.toFixed(0)).toBe("500894761");
    expect(S.value.toFixed(0)).toBe("477473300");
    expect(S.gp.toFixed(0)).toBe("-23421461");
    expect(S.lines.find((l) => l.key === "14")!.costPerKg!.toFixed(2)).toBe("38814.96");
    expect(S.lines.find((l) => l.key === "55")!.costPerKg!.toFixed(2)).toBe("35667.80");
    expect(S.breakeven!.toFixed(1)).toBe("23553.8");
  });
});
