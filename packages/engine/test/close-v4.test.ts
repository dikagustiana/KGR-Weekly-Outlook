/** Finance close of PRD v4 (§3.5, §3.6, §7.1, §7.2). */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { c48, calibrationV4, finalTotalsV4, monthMandatory, reconcileSplit, releaseVerdict, unbilledRevaluation, v1Codes, worstByCode } from "../src/close-v4";
import { augustPlan } from "./month-v4-fixture";
import { allocateBatch } from "../src/costing";
import { loadFixtureWeek } from "../src/fixtures";
import { balanceAt, computeLedger, ledgerInputsFromWeek } from "../src/ledger";
import { computeWeek } from "../src/week";

describe("§7.2 release verdict (same rule as public.release_rejections)", () => {
  const w = computeWeek(loadFixtureWeek("2026-08-24", "2026-08-27"));
  const controls = v1Codes(w.controls.controls);
  it("v1 rule (flag v4_release off): the example week releases — 18 LULUS, 2 BELUM DIISI, no GAGAL", () => {
    expect(controls.filter((c) => c.status === "BELUM DIISI").map((c) => c.code)).toEqual(["C8", "C9"]);
    expect(releaseVerdict({ controls, mandatory: null, overrides: [], strict: false }).ok).toBe(true);
  });
  it("§7.2 rule: BELUM DIISI rejects per control; an override by an allowed role lifts exactly that control", () => {
    const policy = { C8: ["finance"], C9: ["finance"] };
    const v = releaseVerdict({ controls, mandatory: null, overrides: [], strict: true, policy });
    expect(v.rejections.map((r) => `${r.code} ${r.status}`)).toEqual(["C8 BELUM DIISI", "C9 BELUM DIISI"]);
    expect(v.rejections.every((r) => r.overridable)).toBe(true);
    expect(releaseVerdict({ controls, mandatory: null, overrides: ["C8"], strict: true, policy }).rejections.map((r) => r.code)).toEqual(["C9"]);
  });
  it("pending rebuild dates reject as STALE (no override); GAGAL rejects in both rules", () => {
    expect(releaseVerdict({ controls: [], mandatory: null, overrides: [], strict: true, staleDates: ["2026-08-26"] }).rejections).toEqual([{ code: "STALE", status: "STALE", overridable: false }]);
    expect(releaseVerdict({ controls: [{ code: "C11", status: "GAGAL" }], mandatory: null, overrides: [], strict: false }).ok).toBe(false);
  });
  it("the v1 rule has no overrides: an override row does not lift a GAGAL while the flag is off", () => {
    const v = releaseVerdict({ controls: [{ code: "C11", status: "GAGAL" }], mandatory: null, overrides: ["C11"], strict: false, policy: { C11: ["finance"] } });
    expect(v.rejections).toEqual([{ code: "C11", status: "GAGAL", overridable: false }]);
    expect(releaseVerdict({ controls: [{ code: "C11", status: "GAGAL" }], mandatory: null, overrides: ["C11"], strict: true, policy: { C11: ["finance"] } }).ok).toBe(true);
  });
  it("monthly versions: V1 needs C33 C34 C49, V2 needs C32, FINAL the monthly release set with C48", () => {
    expect(monthMandatory("V1")).toEqual(["C33", "C34", "C49"]);
    expect(monthMandatory("V2")).toEqual(["C32"]);
    expect(monthMandatory("FINAL")).toContain("C48");
    const v = releaseVerdict({ controls: [{ code: "C43", status: "PERIKSA" }, { code: "C49", status: "BELUM DIISI" }], mandatory: monthMandatory("V1"), overrides: [], strict: true });
    expect(v.rejections.map((r) => r.code)).toEqual(["C49"]);
  });
});

describe("C48 (§3.5): an Aktual batch without SKU output", () => {
  it("AGRO28–30 (DI-03: LB transport 12 jt parked, kg 9.822 / 9.061,9 / 8.960,2) have no output: GAGAL", () => {
    const c = c48({
      batches: [{ ref: "AGRO27", status: "Aktual", date: "2026-09-14" }, { ref: "AGRO28", status: "Aktual", date: "2026-09-15" }, { ref: "AGRO29", status: "Aktual", date: "2026-09-16" }, { ref: "AGRO30", status: "Aktual", date: "2026-09-17" }, { ref: "PLAN-1", status: "Rencana", date: "2026-09-18" }],
      outputs: [{ batch_ref: "AGRO27", kg: "6500" }, { batch_ref: "AGRO28", kg: "0" }],
    });
    expect(c.status).toBe("GAGAL");
    expect(c.detail).toEqual(["AGRO28 (2026-09-15)", "AGRO29 (2026-09-16)", "AGRO30 (2026-09-17)"]);
  });
});

describe("M1 own-RPA mode (§3.5): overhead per head", () => {
  it("per head when the rate has one and the batch a head count; per kg LB otherwise", () => {
    const base = { outputs: [{ ref: "o1", kg: "1000", price_ref: "30000" }], costLines: [{ component: "LB" as const, amount: "20000000" }], options: { byProductMethod: "joint" as const } };
    const head = allocateBatch({ ...base, batch: { ref: "B1", mode: "own", lb_kg: "2000", head_count: "1000", avg_lb_kg: "2" }, overheadRate: { rate_per_kg_lb: "500", rate_per_head: "900" } });
    expect(head.overheadCost.toFixed(0)).toBe("900000");
    const kg = allocateBatch({ ...base, batch: { ref: "B1", mode: "own", lb_kg: "2000", head_count: null, avg_lb_kg: null }, overheadRate: { rate_per_kg_lb: "500", rate_per_head: "900" } });
    expect(kg.overheadCost.toFixed(0)).toBe("1000000");
    const maklon = allocateBatch({ ...base, batch: { ref: "B1", mode: "maklon", lb_kg: "2000" }, overheadRate: { rate_per_kg_lb: "500" } });
    expect(maklon.overheadCost.toFixed(0)).toBe("0");
  });
});

describe("§3.6 reconciliation split on the example week (26 Aug)", () => {
  const inputs = loadFixtureWeek("2026-08-24", "2026-08-27");
  const li = ledgerInputsFromWeek(inputs);
  const led = computeLedger(li);
  const bal = balanceAt(led, "2026-08-26", li.keys, li.params);
  const hpp = new Map(li.sales.filter((s) => s.status === "Aktual" && s.hpp_actual).map((s) => [s.ref, s.hpp_actual!]));
  const parts = reconcileSplit({ ledger: led, balance: bal, hppByRef: hpp, stockCard: null, bsInventory: "3780600000", openingBs: "3780600000", openingValue: "3955000000", reasoned: [{ label: "selisih saldo awal D3 (belum beralasan)", amount: "0", part: "e" }] });
  const p = (k: string) => parts.find((x) => x.part === k)!;
  it("five parts; a missing input says so instead of 0", () => {
    expect(parts.map((x) => x.part)).toEqual(["a", "b", "c", "d", "e"]);
    expect(p("a").missing).toBe("kartu stok belum diunggah");
    expect(p("a").kg).toBeNull();
  });
  it("(e) the opening gap of D3 stays a difference (3.955,0 − 3.780,6 = 174,4 jt) until a reasoned adjustment explains it", () => {
    expect(p("e").rp!.div(1e6).toFixed(1)).toBe("174.4");
  });
  it("(b) MA vs HPP Accurate and (d) SI vs MA are computed in Rp only; (c) carries the reasoned items apart", () => {
    expect(p("b").kg).toBeNull();
    expect(p("d").rp).not.toBeNull();
    expect(p("c").rp).not.toBeNull();
    expect(D(p("d").rp!).isFinite()).toBe(true);
  });
});

describe("§6.6 tutup buku: FINAL, worst status per code, calibration", () => {
  const a = augustPlan();
  const actualOnly = a.plan.rows.filter((r) => r.actual !== null);
  it("FINAL = actual rows plus posted adjustments, kept apart (DI-01 revaluation of unbilled COGS lowers GP)", () => {
    const f = finalTotalsV4({ rows: actualOnly, adjustments: [{ pl_line: "COGS LB", amount: "-48400000" }, { pl_line: "Revenue Trading", amount: "10000000" }] });
    expect(f.before.revenue.div(1e6).toFixed(1)).toBe("6385.9");
    expect(f.adjustments.gp.toFixed(0)).toBe("-38400000");
    expect(f.after.gp.minus(f.before.gp).toFixed(0)).toBe("-38400000");
    expect(f.after.nibt.minus(f.before.nibt).toFixed(0)).toBe("-38400000");
  });
  it("a month is as good as its worst week, details joined", () => {
    const mk = (code: string, status: "LULUS" | "GAGAL" | "BELUM DIISI", d: string[]) => ({ code, module: "M1" as const, name: code, value: D(0), comparator: null, difference: null, status, action: "", detail: d });
    const w = worstByCode([mk("C48", "LULUS", []), mk("C21", "BELUM DIISI", []), mk("C48", "GAGAL", ["AGRO28"]), mk("C48", "GAGAL", ["AGRO29"])]);
    expect(w.map((c) => `${c.code} ${c.status}`)).toEqual(["C21 BELUM DIISI", "C48 GAGAL"]);
    expect(w[1].detail).toEqual(["AGRO28", "AGRO29"]);
  });
  it("calibration: run-rate 310,4 jt and margin 5,44% of August go to the register as proposals, never agreed", () => {
    const rows = calibrationV4({ month: "2026-08-01", plan: a.plan, v1Bias: { revenue: "-649360903", gp: "-13309757" } });
    expect(rows.map((r) => r.code)).toEqual(["kal_runrate_revenue", "kal_margin_ref", "kal_runrate_offday", "kal_bias_v1_revenue", "kal_bias_v1_gp"]);
    expect(D(rows[0].value_num!).div(1e6).toFixed(1)).toBe("310.4");
    expect(D(rows[1].value_num!).times(100).toFixed(2)).toBe("5.44");
    expect(rows.every((r) => r.status === "proposed" && r.agreed_at === null)).toBe(true);
  });
});

describe("§3.5 DI-01: cost date vs invoice date", () => {
  it("only DOs delivered in the month and invoiced after it count; the revaluation is invoice − revenue per DO", () => {
    const r = unbilledRevaluation({
      month: "2026-08-01",
      pairs: [
        { document_ref: "SJ-0831-1", key: "LB", kg: "10000", revenue_date: "2026-08-31", invoice_date: "2026-09-02", cogs_revenue: "200000000", cogs_invoice: "248354462" },
        { document_ref: "SJ-0829-1", key: "LB", kg: "500", revenue_date: "2026-08-29", invoice_date: "2026-08-30", cogs_revenue: "10000000", cogs_invoice: "10100000" },
        { document_ref: "SJ-0731-1", key: "LB", kg: "800", revenue_date: "2026-07-31", invoice_date: "2026-08-01", cogs_revenue: "16000000", cogs_invoice: "16500000" },
      ],
    });
    expect(r.rows.map((x) => x.document_ref)).toEqual(["SJ-0831-1"]);
    expect(r.revaluation.toFixed(0)).toBe("48354462");
    expect(r.kg.toFixed(0)).toBe("10000");
  });
});
