/**
 * PRD v5.2-A R64 "missing ≠ 0": per place of the PRD list (and the ones the sweep found), a value that is not there reads
 * "belum ada" / "belum diisi" / "tidak tersedia" or leaves the total unknown — never 0, never the sum of the others.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { calibrationV4 } from "@kgr/engine";
import { augustPlan } from "../../../../packages/engine/test/month-v4-fixture";
import { kasFixtureProjection, outlookBulanFixture } from "../../test-support/month-fixture";
import { TilePage } from "@/components/v4/TilePage";
import { fakeSb } from "../fake-sb";
import { kasModel } from "./kas";
import { dailyTotal } from "./close";
import type { TileModel } from "./minggu-ini";
import { outlookBulanModel } from "./outlook-bulan";
import { runrateRowsFromForm } from "../runrate-form";
import { commitmentEntries } from "../v5/commitment-form";
import { sumAllOrNull } from "../known-sum";

vi.mock("server-only", () => ({}));
const { loadOutlookBulan } = await import("./outlook-bulan-data");
const { releaseLastWeek } = await import("./minggu-ini-data");
const { dayPlanFlows } = await import("../v3/cash");
const { dayControls } = await import("../v3/allocation");
const { idleCostRows } = await import("../v5/costing-pl");
const { knownKg } = await import("../v5/input-data");
const { runrateDbRows } = await import("../write");
const { recordDelivery } = await import("../v3/delivery");

const text = (t: TileModel | undefined) => renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("outlook-bulan-data: accuracy of the last FINAL month (PRD lines 115, 117, 143)", () => {
  const settings = { m6_cash: { enabled: false, roles: null } };
  // the fake answers every query of a table with the same rows: one V1 without GP / NIBT, two PO days of which one has no difference
  const rows = {
    month_outlook_version: [{ month_outlook_id: "m1", version: "V1", revenue: "1000000", gp: null, nibt: null, snapshot: { fixed_estimate: [{ actual: null, forecast: null }] }, month_outlook: { month: "2026-08-01" } }],
    forecast_accuracy_daily: [
      { date: "2026-08-03", day_kind: "po", diff: "100000", version: "V1" },
      { date: "2026-08-04", day_kind: "po", diff: null, version: "V1" },
    ],
  };
  it("GP and NIBT the FINAL / the version does not carry are left out, not shown as 0; a day without difference makes the PO-day total unknown; no fixed estimate = null", async () => {
    const { input } = await loadOutlookBulan(fakeSb({ rows }) as never, { first: "2026-08-01", today: "2026-08-27", role: "finance", settings, selected: null });
    const a = input.accuracy!;
    expect(a.lines.map((l) => l.metric)).toEqual(["revenue"]);
    expect(a.poDays).toEqual({ n: 2, diff: null });
    expect(a.runrateDays).toBeNull();
    expect(a.fixedOfVersion).toBeNull();
    const m = outlookBulanModel({ ...outlookBulanFixture(), accuracy: a });
    const v = text(m.tiles.find((t) => t.id === "akurasi"));
    expect(v).toContain("belum lengkap / belum ada");
    expect(v).not.toMatch(/Laba kotor|GROSS PROFIT|NIBT/i);
  });
  it("every day with its difference: the total is the sum", async () => {
    const full = { ...rows, forecast_accuracy_daily: [{ date: "2026-08-03", day_kind: "po", diff: "100000", version: "V1" }, { date: "2026-08-04", day_kind: "po", diff: "-30000", version: "V1" }] };
    const { input } = await loadOutlookBulan(fakeSb({ rows: full }) as never, { first: "2026-08-01", today: "2026-08-27", role: "finance", settings, selected: null });
    expect(input.accuracy!.poDays).toEqual({ n: 2, diff: "70000.00" });
  });
});

describe("close.ts (line 217): totals over days", () => {
  it("one day without the value makes the total unknown; all days: the sum; no days: unknown", () => {
    expect(dailyTotal([{ diff: "10" }, { diff: null }], "diff")).toBeNull();
    expect(dailyTotal([{ diff: "10" }, { diff: "-4.5" }], "diff")).toBe("5.50");
    expect(dailyTotal([], "diff")).toBeNull();
  });
});

describe("calibration of the next month (close.ts): a V1 without GP has no GP bias", () => {
  it("the revenue bias is proposed, the GP bias is left out", () => {
    const plan = augustPlan().plan;
    const codes = (v1Bias: { revenue: string; gp: string | null } | null) => calibrationV4({ month: "2026-08-01", plan, v1Bias }).map((r) => r.code);
    expect(codes({ revenue: "-100", gp: null })).toContain("kal_bias_v1_revenue");
    expect(codes({ revenue: "-100", gp: null })).not.toContain("kal_bias_v1_gp");
    expect(codes({ revenue: "-100", gp: "-5" })).toContain("kal_bias_v1_gp");
    expect(codes(null)).not.toContain("kal_bias_v1_revenue");
  });
});

describe("minggu-ini-data (lines 56, 101): last week's base", () => {
  const snap = (lines: { line: string; v: string }[]) => ({ pnl: { lines: lines.map((l) => ({ line: l.line, values: { projection: l.v } })) } });
  it("a release with revenue, GP and NIBT is the base (basis rilis)", () => {
    const w = releaseLastWeek(snap([{ line: "TOTAL REVENUE", v: "100" }, { line: "GROSS PROFIT", v: "10" }, { line: "NET INCOME", v: "-3" }]))!;
    expect([w.basis, w.revenue.toFixed(0), w.gp.toFixed(0), w.nibt.toFixed(0)]).toEqual(["rilis", "100", "10", "-3"]);
  });
  it("a release without NIBT (or revenue) is not a base with 0: null, the caller takes the journal", () => {
    expect(releaseLastWeek(snap([{ line: "TOTAL REVENUE", v: "100" }, { line: "GROSS PROFIT", v: "10" }]))).toBeNull();
    expect(releaseLastWeek(snap([{ line: "GROSS PROFIT", v: "10" }, { line: "NET INCOME", v: "1" }]))).toBeNull();
    expect(releaseLastWeek(undefined)).toBeNull();
    expect(releaseLastWeek({})).toBeNull();
  });
});

describe("kas (kas-data, cash.ts lines 108, 147-153)", () => {
  it("planned flows of a day: with no cash plan row at all they are null, not 0; with plans a day with nothing planned is 0", () => {
    expect(dayPlanFlows([], "2026-08-27")).toEqual({ operating_in: null, operating_out: null, affiliate_net: null });
    const plans = [
      { date: "2026-08-28", amount: "500", status: "plan", cf_category: "Penjualan" },
      { date: "2026-08-28", amount: "-200", status: "plan", cf_category: "Pembelian" },
      { date: "2026-08-28", amount: "900", status: "plan", cf_category: "Pinjaman afiliasi (net)" },
      { date: "2026-08-28", amount: "-50", status: "plan", cf_category: "Transfer antar rekening" },
      { date: "2026-08-28", amount: "70", status: "done", cf_category: "Penjualan" },
    ];
    expect(dayPlanFlows(plans, "2026-08-28")).toEqual({ operating_in: "500.00", operating_out: "-200.00", affiliate_net: "900.00" });
    expect(dayPlanFlows(plans, "2026-08-29")).toEqual({ operating_in: "0.00", operating_out: "0.00", affiliate_net: "0.00" });
  });
  it("the weekly table says 'belum diisi' for flows the mart has not (null), and the interest card for no interest row", () => {
    const base = kasFixtureProjection();
    const weeks = base.row!.horizon!.weeks.map((w, i) => (i === 0 ? { ...w, operating_in: null, operating_out: null, affiliate_net: null } : w));
    const m = kasModel({ ...base, row: { ...base.row!, horizon: { ...base.row!.horizon!, weeks } }, solvency: { ...base.solvency!, interestRows: [{ actual: null, forecast: null }] } });
    const arus = text(m.tiles.find((t) => t.id === "t-arus"));
    expect(arus).toContain("belum diisi");
    expect(arus).not.toMatch(/(^|\s)0\s/);
    expect(text(m.tiles.find((t) => t.id === "c-afiliasi"))).toContain("belum diisi");
  });
});

describe("kas-data.ts (line 41): the related-party payable that is not there", () => {
  it("affiliate null: the card says 'belum ada', and no 'naik / turun dari bulan lalu' against a payable read as 0", () => {
    const base = kasFixtureProjection();
    const m = kasModel({ ...base, solvency: { ...base.solvency!, affiliate: null, prevAffiliate: "1500000000" } });
    const v = text(m.tiles.find((t) => t.id === "c-afiliasi"));
    expect(v).toContain("belum ada");
    expect(v).not.toMatch(/dari bulan lalu/);
    const known = text(kasModel({ ...base, solvency: { ...base.solvency!, affiliate: "1700000000", prevAffiliate: "1500000000" } }).tiles.find((t) => t.id === "c-afiliasi"));
    expect(known).toContain("naik dari bulan lalu");
  });
});

describe("allocation (allocation.ts lines 81, 100): an order line without kg", () => {
  it("is reported by C29 as BELUM DIISI naming the line, not allocated as 0 kg", () => {
    const d = { date: "2026-08-27", orders: [], allocations: [], cutoffDone: [], led: { lots: [] }, noKg: [{ id: "L9", po_ref: "PO-9", key: "RPA|Karkas|Fresh" }] };
    const c = dayControls(d as never).find((x) => x.code === "C29")!;
    expect(c.status).toBe("BELUM DIISI");
    expect(c.detail).toEqual(["PO-9 RPA|Karkas|Fresh"]);
    expect(dayControls(d as never).filter((x) => x.code === "C29")).toHaveLength(1);
    expect(dayControls({ ...d, noKg: [] } as never).some((x) => x.status === "BELUM DIISI")).toBe(false);
  });
});

describe("idle capacity (costing-pl.ts line 28): a batch without kg LB", () => {
  const rate = [{ period_start: "2026-08-01", period_end: "2026-08-31", basis_kg: "310000", rate_per_kg_lb: "100" }];
  const idle = (batches: Record<string, unknown>[]) => idleCostRows(fakeSb({ rows: { overhead_rate: rate, batch: batches } }) as never, "2026-08-01", "2026-08-31");
  it("every batch with kg: the idle capacity is computed", async () => {
    expect((await idle([{ date: "2026-08-03", status: "Aktual", lb_kg: "5000" }])).length).toBeGreaterThan(0);
  });
  it("a batch of the period without kg LB: the day is unknown, the rate's idle capacity is not computed (never a day of 0 kg)", async () => {
    expect(await idle([{ date: "2026-08-03", status: "Aktual", lb_kg: "5000" }, { date: "2026-08-04", status: "Aktual", lb_kg: null }])).toEqual([]);
  });
  it("a plan batch without kg on a day that has an Aktual batch does not matter: the day is the Aktual", async () => {
    expect((await idle([{ date: "2026-08-03", status: "Aktual", lb_kg: "5000" }, { date: "2026-08-03", status: "Rencana", lb_kg: null }])).length).toBeGreaterThan(0);
  });
});

describe("cards of the input page (input-data.ts lines 111, 330, 332, 354)", () => {
  it("kg of rows: the sum of the filled ones and the number of blank rows", () => {
    const k = knownKg([{ kg: "100" }, { kg: null }, { kg: "50.5" }], "kg");
    expect(k.kg.toFixed(2)).toBe("150.50");
    expect(k.blank).toBe(1);
    expect(knownKg([], "kg").blank).toBe(0);
  });
  it("a total over rows (SKU page): one blank row = unknown", () => {
    expect(sumAllOrNull([{ c: "1" }, { c: null }], "c")).toBeNull();
    expect(sumAllOrNull([{ c: "1" }, { c: "2.5" }], "c")!.toFixed(1)).toBe("3.5");
  });
});

describe("run-rate (write.ts line 117, month.ts line 143, run-rate form)", () => {
  it("workbook: a line without a monthly amount is not written; a blank adjustment is no adjustment", () => {
    const rows = runrateDbRows("w1", [
      { pl_line: "Salaries", monthly_amount: "100", week_adjustment: null, basis: null },
      { pl_line: "Rent", monthly_amount: null, week_adjustment: "5", basis: null },
    ] as never);
    expect(rows).toEqual([{ week_id: "w1", pl_line: "Salaries", monthly_amount: "100", week_adjustment: 0, basis: null, seq: 1 }]);
  });
  it("form: the blank line is reported, not stored as 0; an explicit 0 is kept", () => {
    const f = new FormData();
    for (const l of ["Salaries", "Rent", "Fuel"]) f.append("pl_line", l);
    f.set("m:Salaries", "1.000"); f.set("m:Rent", ""); f.set("m:Fuel", "0");
    const { rows, empty } = runrateRowsFromForm(f, "w1");
    expect(empty).toEqual(["Rent"]);
    expect(rows.map((r) => [r.pl_line, r.monthly_amount])).toEqual([["Salaries", "1000"], ["Fuel", "0"]]);
  });
});

describe("commitments (actions-v5.ts line 32)", () => {
  const form = (o: Record<string, string>) => { const f = new FormData(); f.set("n", "2"); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  it("a SKU with one kg field blank is incomplete: nothing saved, not a commitment of 0 kg", () => {
    const r = commitmentEntries(form({ key_0: "RPA|Karkas", fresh_0: "1000", frozen_0: "", price_0: "", key_1: "RPA|Paha", fresh_1: "5", frozen_1: "0", price_1: "30000" }));
    expect(r.incomplete).toEqual(["RPA|Karkas"]);
    expect(r.entries).toEqual([{ key: "RPA|Paha", rec: { fresh_kg: "5", frozen_kg: "0", price: "30000" } }]);
  });
  it("a SKU with nothing filled is skipped; a price alone is incomplete", () => {
    const r = commitmentEntries(form({ key_0: "A", fresh_0: "", frozen_0: "", price_0: "", key_1: "B", fresh_1: "", frozen_1: "", price_1: "100" }));
    expect(r.entries).toEqual([]);
    expect(r.incomplete).toEqual(["B"]);
  });
});

describe("delivery (delivery.ts line 21)", () => {
  it("an order line without kg: the delivery is refused naming the reason, not checked against 0 kg", async () => {
    const sb = fakeSb({ rows: { sales_line: [{ id: "L1", status: "Order", kg: null, fulfilled_kg: "0", cancelled_kg: "0", week_id: "w35" }] } });
    await expect(recordDelivery(sb as never, { role: "admin", email: "a@b.c" } as never, { id: "L1", date: "2026-08-27", kg: "5", documentRef: null })).rejects.toThrow("kg order belum diisi");
    expect(sb.calls).not.toContain("delivery:insert");
  });
});

