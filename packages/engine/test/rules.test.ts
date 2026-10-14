/** Unit tests for every rule in PRD §5, on small synthetic weeks plus mutations of the example week. */
import { describe, expect, it } from "vitest";
import { Decimal } from "../src/decimal";
import { addDays, assertISODate, isISODate, mondayOf, daysInMonth } from "../src/dates";
import { computeWeek } from "../src/week";
import { loadFixtureWeek } from "../src/fixtures";
import { fixed, pct } from "../src/format";
import type { WeekInputs } from "../src/types";

const base = (): WeekInputs => loadFixtureWeek("2026-08-24");

/** A minimal synthetic week: one RPA fresh key, one Trading key, no GL. */
function tiny(over: Partial<WeekInputs> = {}): WeekInputs {
  const w: WeekInputs = {
    week: { week_start: "2026-09-07", update_date: "2026-09-09", tb_opening_date: "2026-08-31" },
    parameters: {
      horizon_fresh_days: 3, target_shrink: "0.03", freight_plan_per_kg_lb: 1000, maklon_per_kg_processed: 1600,
      lb_price_today: 20000, min_trading_spread: 2000, stock_age_limit_days: 30, terms_lb_days: 7, terms_trading_days: 14,
      terms_freight_maklon_days: 30,
      yield_default: { karkas: "0.7367", kepala: "0.0467", ceker: "0.0294", usus: "0.0436", hja: "0.056", lemak: "0.0034" },
      last_week: { RPA: { kg: 0, revenue: 0, gp: 0 }, Trading: { kg: 0, revenue: 0, gp: 0 } },
      accurate_sales_kg: null, accurate_opening_stock_value: null,
    },
    sku_keys: [
      { key: "RPA|Karkas|Fresh", segment: "RPA", sku: "Karkas", form: "Fresh", decision_group: "Karkas fresh", ref_sell_price: 36705, replacement_buy_price: null },
      { key: "RPA|Karkas|Frozen", segment: "RPA", sku: "Karkas", form: "Frozen", decision_group: "Karkas frozen", ref_sell_price: 31658, replacement_buy_price: null },
      { key: "Trading|BLP|Frozen", segment: "Trading", sku: "BLP", form: "Frozen", decision_group: "BLP", ref_sell_price: 45000, replacement_buy_price: 40000 },
    ],
    item_map: [
      { item_code: "K1", key: "RPA|Karkas|Fresh" },
      { item_code: "T1", key: "Trading|BLP|Frozen" },
    ],
    coa_map: [], opening_stock: [], sales_lines: [], receipt_lines: [], batches: [], gl_lines: [], tb_opening: [], runrate: [], cash_plan: [],
  };
  return { ...w, ...over };
}

describe("dates", () => {
  it("Monday of a week and days in month", () => {
    expect(mondayOf("2026-08-27")).toBe("2026-08-24");
    expect(mondayOf("2026-08-30")).toBe("2026-08-24");
    expect(mondayOf("2026-08-24")).toBe("2026-08-24");
    expect(addDays("2026-08-30", 1)).toBe("2026-08-31");
    expect(daysInMonth("2026-02-10")).toBe(28);
    expect(daysInMonth("2026-08-27")).toBe(31);
  });
  it("only real calendar days are ISO dates", () => {
    expect(isISODate("2026-08-31")).toBe(true);
    expect(isISODate("2028-02-29")).toBe(true);
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2026-02-31")).toBe(false);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("26-08-31")).toBe(false);
    expect(() => assertISODate("2026-09-31")).toThrow(/Tanggal tidak valid/);
    expect(() => computeWeek({ ...base(), week: { ...base().week, update_date: "2026-08-32" } })).toThrow(/Tanggal tidak valid/);
  });
  it("house number format", () => {
    expect(fixed(new Decimal(24600))).toBe("24.600");
    expect(fixed(new Decimal("-3874.34"))).toBe("-3.874");
    expect(fixed(new Decimal("2.5"))).toBe("3");
    expect(fixed(new Decimal("-2.5"))).toBe("-3");
    expect(pct(new Decimal("0.0630874"))).toBe("6,3%");
    expect(fixed(new Decimal("1234567.891"), 2)).toBe("1.234.567,89");
  });
});

describe("§5.1 stock projection", () => {
  it("past days use Aktual only; today onwards Aktual + Order/Rencana; stock today = closing of yesterday", () => {
    const w = tiny({
      opening_stock: [{ item_code: "T1", kg: 100, value: 4_000_000, avg_age_days: 10, kg_over_age_limit: 0 }],
      sales_lines: [
        { date: "2026-09-07", status: "Aktual", item_code: "T1", kg: 10, price: 45000 },
        { date: "2026-09-08", status: "Order", item_code: "T1", kg: 5, price: 45000 }, // past-dated order: ignored
        { date: "2026-09-10", status: "Order", item_code: "T1", kg: 20, price: 46000 },
      ],
      receipt_lines: [
        { date: "2026-09-08", status: "Rencana", receipt_source: "Beli Trading", item_code: "T1", kg: 50, unit_cost: 38000 }, // past plan: ignored
        { date: "2026-09-11", status: "Rencana", receipt_source: "Beli Trading", item_code: "T1", kg: 30, unit_cost: 41000 },
      ],
    });
    const r = computeWeek(w);
    const s = r.stock.byKey.get("TRADING|BLP|FROZEN")!;
    expect(s.closing.map((x) => x.toNumber())).toEqual([90, 90, 90, 70, 100, 100, 100]);
    expect(s.stockToday.toNumber()).toBe(90);
    expect(s.ordersRestOfWeek.toNumber()).toBe(20);
    // weekly average cost = (opening value + counted receipts value) ÷ (opening kg + counted receipts kg)
    expect(s.avgCost.toFixed(4)).toBe(new Decimal(4_000_000 + 30 * 41000).div(130).toFixed(4));
    expect(r.controls.controls.find((c) => c.no === 7)!.status).toBe("PERIKSA");
  });

  it("status first match: KURANG > JUAL (age) > JUAL > PERHATIAN > cek harga > -", () => {
    const mk = (over: Partial<WeekInputs>) => computeWeek(tiny(over)).stock.byKey.get("TRADING|BLP|FROZEN")!;
    expect(mk({ sales_lines: [{ date: "2026-09-10", status: "Order", item_code: "T1", kg: 5, price: 1 }] }).status).toBe("KURANG");
    expect(mk({ opening_stock: [{ item_code: "T1", kg: 10, value: 1, avg_age_days: 40, kg_over_age_limit: 10 }] }).statusText)
      .toBe("JUAL: 10 kg tanpa order, sebagian > batas umur");
    expect(mk({ opening_stock: [{ item_code: "T1", kg: 10, value: 1, avg_age_days: 4, kg_over_age_limit: 0 }] }).statusText)
      .toBe("JUAL: 10 kg tanpa order minggu ini");
    expect(mk({
      opening_stock: [{ item_code: "T1", kg: 10, value: 1, avg_age_days: 40, kg_over_age_limit: 3 }],
      sales_lines: [{ date: "2026-09-10", status: "Order", item_code: "T1", kg: 2, price: 1 }],
    }).status).toBe("PERHATIAN");
    expect(mk({
      opening_stock: [{ item_code: "T1", kg: 10, value: 600_000, avg_age_days: 4, kg_over_age_limit: 0 }],
      sales_lines: [{ date: "2026-09-10", status: "Order", item_code: "T1", kg: 2, price: 1 }],
    }).status).toBe("CEK HARGA");
    expect(mk({}).status).toBe("-");
  });

  it("HPP of a sale = HPP aktual when given, else kg × weekly average cost", () => {
    const r = computeWeek(tiny({
      opening_stock: [{ item_code: "T1", kg: 100, value: 4_000_000, avg_age_days: 1, kg_over_age_limit: 0 }],
      sales_lines: [
        { date: "2026-09-07", status: "Aktual", item_code: "T1", kg: 10, price: 45000, hpp_actual: 333 },
        { date: "2026-09-10", status: "Order", item_code: "T1", kg: 10, price: 45000 },
      ],
    }));
    expect(r.sales[0].hpp.toNumber()).toBe(333);
    expect(r.sales[1].hpp.toNumber()).toBe(400_000);
  });
});

describe("§5.3 RPA recommendation branches", () => {
  const withPlan = (lbPrice: number, plannedKg: number, freshOrderKg: number) =>
    computeWeek(tiny({
      parameters: { ...tiny().parameters, lb_price_today: lbPrice },
      sales_lines: freshOrderKg ? [{ date: "2026-09-10", status: "Order", item_code: "K1", kg: freshOrderKg, price: 36705 }] : [],
      batches: plannedKg
        ? [{ date: "2026-09-10", status: "Rencana", lb_kg: plannedKg, lb_price: lbPrice, freight: 0, maklon: 0, processed_kg: null,
            output: { karkas_fresh: null, karkas_frozen: null, kepala: null, ceker: null, usus: null, hja: null, lemak: null, other: null } }]
        : [],
    })).block2;

  it("TUNDA when LB price > breakeven at 100% fresh", () => {
    const b = withPlan(30000, 1000, 0);
    expect(b.recommendation).toBe("TUNDA / NEGOSIASI");
  });
  it("KURANGI when planned > LB max + 0,5", () => {
    const b = withPlan(18000, 10000, 1000);
    expect(b.recommendation).toBe("KURANGI");
    // LB max = net need ÷ ((1 − s) × y_k) with default yields (no Aktual batches)
    expect(b.lbMaxWithoutFrozen.toFixed(6)).toBe(new Decimal(1000).div(new Decimal("0.97").times("0.7367")).toFixed(6));
    expect(b.recommendationText).toContain("KURANGI potong ke maksimum 1.399 kg LB (rencana 10.000 kg)");
  });
  it("POTONG HANYA SESUAI ORDER when price ≤ breakeven(1) but margin at plan share < 0", () => {
    // net need 1 kg → LB max 1,399 kg; plan 1,8 kg (≤ max + 0,5) → fresh share 0,777 < 1
    const probe = withPlan(10000, 1.8, 1);
    expect(probe.freshShareOfPlan.lessThan(1)).toBe(true);
    const lb = probe.breakevenAt100Fresh.minus(100).toDecimalPlaces(0).toNumber();
    const b = withPlan(lb, 1.8, 1);
    expect(b.marginPerKgLb.lessThan(0)).toBe(true);
    expect(b.recommendation).toBe("POTONG HANYA SESUAI ORDER");
  });
  it("LANJUT when price below breakeven and the plan fits the fresh need", () => {
    const b = withPlan(15000, 1000, 100_000);
    expect(b.freshShareOfPlan.toNumber()).toBe(1);
    expect(b.recommendation).toBe("LANJUT");
  });
  it("V(f) and breakeven formula", () => {
    const b = withPlan(20000, 0, 0);
    expect(b.freshShareOfPlan.toNumber()).toBe(1); // no plan → f = 1
    const s = new Decimal("0.97");
    const v = s.times(new Decimal("0.7367").times(36705)); // by-product prices absent in tiny master → 0
    expect(b.valuePerKgLbAtPlanShare.toFixed(6)).toBe(v.toFixed(6));
    expect(b.breakevenAt100Fresh.toFixed(6)).toBe(v.minus(1000).minus(new Decimal(1600).times(s)).toFixed(6));
  });
});

describe("§5.4 Trading recommendation branches", () => {
  const trade = (over: Partial<WeekInputs>, buy: number | null = 40000) => {
    const w = tiny(over);
    w.sku_keys = w.sku_keys.map((k) => (k.key === "Trading|BLP|Frozen" ? { ...k, replacement_buy_price: buy } : k));
    return computeWeek(w).block3[0];
  };
  const order = (kg: number, price = 45000) => [{ date: "2026-09-10", status: "Order", item_code: "T1", kg, price }];
  it("BELI when net need > 0,5 and spread ≥ minimum", () => {
    const t = trade({ sales_lines: order(100) });
    expect(t.recommendation).toBe("BELI");
    expect(t.recommendationText).toBe("BELI 100 kg (spread 5.000/kg)");
  });
  it("BELI — isi harga beli when no buy price", () => {
    expect(trade({ sales_lines: order(100) }, null).recommendation).toBe("BELI (isi harga)");
  });
  it("TAHAN when spread below minimum", () => {
    expect(trade({ sales_lines: order(100, 41000) }).recommendation).toBe("TAHAN");
  });
  it("JUAL STOK when stock and no orders", () => {
    expect(trade({ opening_stock: [{ item_code: "T1", kg: 50, value: 1, avg_age_days: 1, kg_over_age_limit: 0 }] }).recommendation).toBe("JUAL STOK");
  });
  it("CEK HARGA when order price below average stock cost", () => {
    const t = trade({
      opening_stock: [{ item_code: "T1", kg: 500, value: 25_000_000, avg_age_days: 1, kg_over_age_limit: 0 }],
      sales_lines: order(100, 45000),
    });
    expect(t.recommendation).toBe("CEK HARGA");
  });
  it("Cukup otherwise; '-' when nothing", () => {
    const t = trade({
      opening_stock: [{ item_code: "T1", kg: 500, value: 1_000_000, avg_age_days: 1, kg_over_age_limit: 0 }],
      sales_lines: order(100, 45000),
    });
    expect(t.recommendationText).toBe("Cukup — sisa 400 kg setelah order");
    expect(trade({}).recommendation).toBe("-");
  });
  it("sell price = kg-weighted order price, else reference price", () => {
    const t = trade({ sales_lines: [...order(100, 45000), ...order(300, 49000)] });
    expect(t.sellPrice.toNumber()).toBe(48000);
    expect(trade({}).sellPrice.toNumber()).toBe(45000);
  });
});

describe("§5.5 batches, cash out, alerts", () => {
  it("batch KPIs", () => {
    const r = computeWeek(base());
    const b = r.prepared.batches[0];
    expect(b.lbValue.toFixed(3)).toBe("288925356.956");
    expect(b.shrink!.toFixed(10)).toBe(new Decimal(1).minus(new Decimal("11666.8").div("12211.6")).toFixed(10));
    expect(b.outputKg.toFixed(1)).toBe("10495.9");
  });
  it("cash out: batch LB value due d − terms_lb", () => {
    const w = tiny({
      batches: [{ date: "2026-09-01", status: "Aktual", lb_kg: 100, lb_price: 20000, freight: 0, maklon: 0, processed_kg: 97,
        output: { karkas_fresh: 70, karkas_frozen: 0, kepala: 0, ceker: 0, usus: 0, hja: 0, lemak: 0, other: 0 } }],
    });
    const r = computeWeek(w);
    const row = r.block5.rows.find((x) => x.date === "2026-09-08")!;
    expect(row.liveBird.toNumber()).toBe(2_000_000);
    expect(row.basis).toBe("aktual");
    expect(r.block5.total.total.toNumber()).toBe(2_000_000);
  });
  it("alerts: past orders, new code, negative stock, TAHAN", () => {
    const r = computeWeek(tiny({
      sales_lines: [
        { date: "2026-09-08", status: "Order", item_code: "T1", kg: 5, price: 1 },
        { date: "2026-09-10", status: "Order", item_code: "NEW", kg: 5, price: 1 },
        { date: "2026-09-10", status: "Order", item_code: "T1", kg: 5, price: 41000 },
      ],
    }));
    const codes = r.block7.map((a) => a.code);
    expect(codes).toContain("ORDER_LEWAT");
    expect(codes).toContain("KODE_BARU");
    expect(codes).toContain("STOK_MINUS");
    expect(codes).toContain("TAHAN");
    expect(r.controls.controls.find((c) => c.no === 1)!.status).toBe("GAGAL");
    expect(r.controls.releasable).toBe(false);
  });
});

describe("PRD §10 functional checks on the example week", () => {
  it("changing the update date to 28 Aug moves 27-Aug orders to past-dated (control 7) and shifts the split", () => {
    const w = base();
    w.week.update_date = "2026-08-28";
    const r = computeWeek(w);
    const c7 = r.controls.controls.find((c) => c.no === 7)!;
    const orders27 = w.sales_lines.filter((s) => s.date === "2026-08-27" && s.status === "Order").length;
    expect(orders27).toBe(28);
    expect(c7.value.toNumber()).toBe(orders27);
    expect(c7.status).toBe("PERIKSA");
    const r27 = computeWeek(base());
    expect(r.block1[2].kgOrder.lessThan(r27.block1[2].kgOrder)).toBe(true);
    expect(r.block2.horizonFrom).toBe("2026-08-28");
    expect(r.statements.pnl.ranges.remainingDays).toBe(3);
  });
  it("an unmapped GL account blocks release (control 14) until mapped", () => {
    const w = base();
    w.gl_lines = [...w.gl_lines,
      { date: "2026-08-25", voucher_no: "X1", account: "9999999", debit: 100, credit: null },
      { date: "2026-08-25", voucher_no: "X1", account: "9999998", debit: null, credit: 100 }];
    const r = computeWeek(w);
    expect(r.controls.controls.find((c) => c.no === 14)!.status).toBe("GAGAL");
    w.coa_map = [...w.coa_map,
      { account: "9999999", name: "x", type: "LabaRugi", pl_line: "Other Expense", bs_line: null, cf_category_as_counter: "Bayar biaya operasional lain", is_cash: false },
      { account: "9999998", name: "y", type: "LabaRugi", pl_line: "Other Income", bs_line: null, cf_category_as_counter: "Penerimaan lain", is_cash: false }];
    expect(computeWeek(w).controls.controls.find((c) => c.no === 14)!.status).toBe("LULUS");
  });
  it("Accurate totals entered → controls 8 and 9 LULUS / GAGAL", () => {
    const w = base();
    w.parameters = { ...w.parameters, accurate_sales_kg: "23587.97", accurate_opening_stock_value: "3954932000" };
    const r = computeWeek(w);
    expect(r.controls.controls.find((c) => c.no === 8)!.status).toBe("LULUS");
    expect(r.controls.controls.find((c) => c.no === 9)!.status).toBe("GAGAL");
  });
  it("Monday update: stock today = opening stock; no actual columns", () => {
    const w = base();
    w.week.update_date = "2026-08-24";
    const r = computeWeek(w);
    for (const s of r.stock.rows) expect(s.stockToday.equals(s.openingKg)).toBe(true);
    expect(r.statements.pnl.get("TOTAL REVENUE").values.actual.toNumber()).toBe(0);
  });
});

describe("§5.8 cash classification", () => {
  it("counter = largest non-cash line; cash-only voucher = transfer; override wins; unknown account = ?", () => {
    const coa = [
      { account: "1102001", name: "Bank", type: "Neraca", pl_line: null, bs_line: "Cash and cash equivalents", cf_category_as_counter: "Transfer antar rekening", is_cash: true },
      { account: "1102002", name: "Bank 2", type: "Neraca", pl_line: null, bs_line: "Cash and cash equivalents", cf_category_as_counter: "Transfer antar rekening", is_cash: true },
      { account: "1103001", name: "AR", type: "Neraca", pl_line: null, bs_line: "Trade Receivables - Third Parties", cf_category_as_counter: "Penerimaan dari pelanggan", is_cash: false },
      { account: "7200003", name: "Bank charge", type: "LabaRugi", pl_line: "Other Expense", bs_line: null, cf_category_as_counter: "Bunga & biaya bank", is_cash: false },
    ];
    const r = computeWeek(tiny({
      coa_map: coa,
      gl_lines: [
        { date: "2026-09-07", voucher_no: "V1", account: "1102001", debit: 990, credit: null },
        { date: "2026-09-07", voucher_no: "V1", account: "7200003", debit: 10, credit: null },
        { date: "2026-09-07", voucher_no: "V1", account: "1103001", debit: null, credit: 1000 },
        { date: "2026-09-07", voucher_no: "V2", account: "1102001", debit: 50, credit: null },
        { date: "2026-09-07", voucher_no: "V2", account: "1102002", debit: null, credit: 50 },
        { date: "2026-09-08", voucher_no: "V3", account: "1102001", debit: 5, credit: null, cf_override: "Penerimaan lain" },
        { date: "2026-09-08", voucher_no: "V3", account: "1103001", debit: null, credit: 5 },
        { date: "2026-09-08", voucher_no: "V4", account: "1102001", debit: 7, credit: null },
        { date: "2026-09-08", voucher_no: "V4", account: "4999999", debit: null, credit: 7 },
      ],
    }));
    const cats = r.prepared.gl.filter((g) => g.isCash).map((g) => [g.voucher, g.cfCategory]);
    expect(cats).toEqual([
      ["V1", "Penerimaan dari pelanggan"], ["V2", "Transfer antar rekening"], ["V2", "Transfer antar rekening"],
      ["V3", "Penerimaan lain"], ["V4", "?"],
    ]);
    expect(r.controls.controls.find((c) => c.no === 17)!.value.toNumber()).toBe(1);
  });
});

describe("control 20 — Ops vs Accurate", () => {
  it("flags a document whose kg differs by more than 0,5%", () => {
    const w = tiny({
      sales_lines: [{ date: "2026-09-08", status: "Aktual", item_code: "T1", kg: 100, price: 45000, source: "Accurate", document_ref: "SJ-1" }],
      superseded_ops_rows: { sales: [{ date: "2026-09-08", status: "Aktual", item_code: "T1", kg: 98, price: 45000, source: "Ops", document_ref: "SJ-1" }], receipts: [] },
    });
    const c = computeWeek(w).controls.controls.find((x) => x.no === 20)!;
    expect(c.status).toBe("PERIKSA");
    w.superseded_ops_rows!.sales[0].kg = 99.8;
    expect(computeWeek(w).controls.controls.find((x) => x.no === 20)!.status).toBe("LULUS");
  });
  it("still-Ops rows are disclosed on the control without changing its status", () => {
    const w = tiny({
      sales_lines: [{ date: "2026-09-08", status: "Aktual", item_code: "T1", kg: 100, price: 45000, source: "Ops", document_ref: "SJ-2" }],
    });
    const c = computeWeek(w).controls.controls.find((x) => x.no === 20)!;
    expect(c.status).toBe("LULUS");
    expect(c.action).toContain("1 baris penjualan/penerimaan masih bersumber Ops");
  });
});

describe("bundled example week", () => {
  it("equals the fixtures loaded from disk", async () => {
    const { exampleWeekInputs } = await import("../src/example-week");
    const { snapshotJson } = await import("../src/snapshot");
    expect(snapshotJson(computeWeek(exampleWeekInputs()))).toBe(snapshotJson(computeWeek(base())));
  });
});
