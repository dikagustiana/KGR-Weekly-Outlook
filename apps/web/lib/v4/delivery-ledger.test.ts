/** K7 in the ledger (PRD v4 P3.8, G4): PO 1.800 kg delivered 600 kg leaves 1.200 kg open, stock leaves once. */
import { describe, expect, it } from "vitest";
import { computeLedger, type LedgerInputs } from "@kgr/engine";
import { salesWithDeliveries } from "./delivery-ledger";

const keyOf = (_km: string | null, ic: string | null) => (ic === "JLB0593" ? "RPA|Karkas|Fresh" : "x");
const line = { id: "L1", date: "2030-06-05", status: "Order", item_code: "JLB0593", key_manual: null, kg: "1800", cancelled_kg: "0", hpp_actual: null, document_ref: null };

describe("salesWithDeliveries", () => {
  it("an open line with a 600 kg delivery: 600 actual on the delivery date with its DO, 1.200 still planned", () => {
    const out = salesWithDeliveries([line], [{ id: "D1", sales_line_id: "L1", date: "2030-06-04", kg: "600", document_ref: "DO-1" }], keyOf);
    expect(out.map((x) => [x.ref, x.status, x.date, x.kg, x.document_ref])).toEqual([["L1", "Aktual", "2030-06-04", "600", "DO-1"], ["L1", "Order", "2030-06-05", "1200.00", null]]);
  });
  it("cancelled kg are not planned; a fully delivered line has no planned rest", () => {
    const out = salesWithDeliveries([{ ...line, cancelled_kg: "200" }], [{ id: "D1", sales_line_id: "L1", date: "2030-06-04", kg: "600", document_ref: "DO-1" }, { id: "D2", sales_line_id: "L1", date: "2030-06-05", kg: "1000", document_ref: "DO-2" }], keyOf);
    expect(out.map((x) => [x.status, x.kg])).toEqual([["Aktual", "600"], ["Aktual", "1000"]]);
  });
  it("a delivery whose DO arrived as an Aktual line of the same item is that line, not a second outflow; an Aktual line keeps its own kg", () => {
    const accurate = { id: "A1", date: "2030-06-04", status: "Aktual", item_code: "JLB0593", key_manual: null, kg: "600", cancelled_kg: "0", hpp_actual: "18000000", document_ref: "DO-1" };
    const out = salesWithDeliveries([accurate, line], [{ id: "D1", sales_line_id: "L1", date: "2030-06-04", kg: "600", document_ref: "DO-1" }], keyOf);
    expect(out.map((x) => [x.ref, x.status, x.kg])).toEqual([["A1", "Aktual", "600"], ["L1", "Order", "1200.00"]]);
    const closed = salesWithDeliveries([{ ...line, status: "Aktual" }], [{ id: "D1", sales_line_id: "L1", date: "2030-06-04", kg: "1800", document_ref: "DO-9" }], keyOf);
    expect(closed.map((x) => [x.status, x.kg])).toEqual([["Aktual", "1800"]]);
  });
  it("through the ledger: the allocated lot gives 600 at delivery and is not used twice; stock 2.000 → 1.400 after the delivery", () => {
    const inputs: LedgerInputs = {
      startDate: "2030-06-03", today: "2030-06-05",
      opening: [{ ref: "O1", item_code: "JLB0593", key: "RPA|Karkas|Fresh", kg: "2000", value: "60000000", avg_age_days: "0" }],
      receipts: [], sales: salesWithDeliveries([line], [{ id: "D1", sales_line_id: "L1", date: "2030-06-04", kg: "600", document_ref: "DO-1" }], keyOf),
      allocations: [{ sales_ref: "L1", lot_ref: "opening:O1", kg: "800" }],
      keys: [{ key: "RPA|Karkas|Fresh", form: "fresh", group_code: null, fresh_window_hours: 480, frozen_age_limit_days: 30 }],
      params: { blastCostPerKg: "0", defaultFreshWindowHours: 48, defaultFrozenAgeLimitDays: 30 },
    };
    const led = computeLedger(inputs);
    const outs = led.movements.filter((m) => m.type === "out_sale");
    const actual = outs.filter((m) => !m.planned).reduce((a, m) => a + Number(m.kg), 0);
    const planned = outs.filter((m) => m.planned).reduce((a, m) => a + Number(m.kg), 0);
    expect(actual).toBe(-600);
    expect(planned).toBe(-1200);
    // 800 kg allocated: 600 by the delivery, 200 by the planned rest, the other 1.000 FEFO (assumed)
    expect(outs.filter((m) => !m.assumed).reduce((a, m) => a + Number(m.kg), 0)).toBe(-800);
  });
});
