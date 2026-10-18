/**
 * PRD v5.2-A irisan A2 (R48–R58), the engine half of the evidence: the weighted open kg (R49), forecast per date with
 * the K2 rule, netting after the weighting, STD as a class of C58 and "n kg tanpa kelas" (R50), the LB decision per class
 * (R51), the due dates of the task rules (R54), the assignment scope O21(b) and C22 over the output that will be saved (R58).
 * Probes of the review: DEMAND_tentative_70pct, DEMAND_confirmed_fulfilled60, forecast-only, C58_UNSIZED, WP_HELD_MASS.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../src/fixtures";
import { D } from "../src/decimal";
import { assignmentCovers, inAssignmentScope } from "../src/commercial-v5";
import { c57, lbDecisionFor } from "../src/costing";
import { effectiveForecasts, weeklyDemand, type ForecastLine } from "../src/demand";
import { dueDatesFor } from "../src/input-tasks";
import { c50, c58, dailyClassPlan, forecastLinesByDate, needByCutDate, splitClassPlan, toClassLB, weightedOpenKg, type SizedLine } from "../src/ppic-class";
import { validateUpload, type Grid, type UploadContext } from "../src/upload-validate";

const W = { tentative: "0.7", forecast: "0.5" };
const setup = {
  classOf: (s: ReturnType<typeof D>) => (s.eq("1.30") ? "S" : null), yieldKarkas: () => "0.7146", avgKg: (c: string) => (c === "STD" ? "2.0" : null), midOffset: "0.05", fallback: "STD",
};

describe("R49 — the open kg × status weight, then the netting", () => {
  it("DEMAND_tentative_70pct: Tentative 100 kg at weight 0,7 → 70", () => {
    expect(weightedOpenKg({ kg: "100", demand_status: "Tentative" }, W).toFixed(2)).toBe("70.00");
  });
  it("DEMAND_confirmed_fulfilled60: Confirmed 100 kg with 60 kg delivered → 40", () => {
    expect(weightedOpenKg({ kg: "100", fulfilled_kg: "60", demand_status: "Confirmed" }, W).toFixed(2)).toBe("40.00");
  });
  it("cancelled kg leaves too, a line delivered beyond its kg is never negative, a Forecast PO line takes forecast_weight", () => {
    expect(weightedOpenKg({ kg: "100", fulfilled_kg: "30", cancelled_kg: "20", demand_status: "Confirmed" }, W).toFixed(2)).toBe("50.00");
    expect(weightedOpenKg({ kg: "100", fulfilled_kg: "130", demand_status: "Confirmed" }, W).toFixed(2)).toBe("0.00");
    expect(weightedOpenKg({ kg: "100", demand_status: "Forecast" }, W).toFixed(2)).toBe("50.00");
  });
  it("the stock netting comes after the weighting: 70 kg Tentative with half of the key covered by stock → 35 kg net", () => {
    const line: SizedLine = { ship_date: "2026-08-27", key: "RPA|Karkas|Fresh", size_kg: "1.30", kg: weightedOpenKg({ kg: "100", demand_status: "Tentative" }, W).toFixed(2) };
    const cd = toClassLB({ lines: [line], netShare: () => "0.5", setup });
    expect(cd.total.po_kg.toFixed(2)).toBe("70.00");
    expect(cd.total.net_kg.toFixed(2)).toBe("35.00");
    // "Stok layak" of the screen = po − net: no longer always 0
    expect(cd.bySize[0].po_kg.minus(cd.bySize[0].net_kg).toFixed(2)).toBe("35.00");
  });
  it("forecast-only week: the need is above 0, per date (seven days), at forecast_weight", () => {
    const lines = forecastLinesByDate({ forecasts: [{ week_start: "2026-08-24", key: "RPA|Karkas|Fresh", kg: "1400", source: "sales" }], weekStart: "2026-08-24", weight: W.forecast, keys: (k) => k.startsWith("RPA|Karkas") });
    expect(lines.map((l) => l.ship_date)).toEqual(["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"]);
    expect(lines.reduce((a, l) => a.plus(D(l.kg)), D(0)).toFixed(2)).toBe("700.00");
    expect(lines.every((l) => l.size_kg === null && l.forecast === true)).toBe(true);
    const cd = toClassLB({ lines, setup });
    expect(cd.total.net_kg.gt(0)).toBe(true);
    expect(cd.total.kg_lb.gt(0)).toBe(true);
    expect(cd.byClass.map((c) => c.weight_class)).toEqual(["STD"]);
    // a forecast has no size by nature: it is need, not a PO line missing its size (C50 stays LULUS)
    expect(c50(cd).status).toBe("LULUS");
    expect(cd.unsized).toEqual([]);
  });
  it("K2: a key with a Sales forecast ignores the statistical one (the rule of weeklyDemand), for the class demand too", () => {
    const f: ForecastLine[] = [
      { week_start: "2026-08-24", key: "A", kg: "100", source: "sales" }, { week_start: "2026-08-24", key: "A", kg: "999", source: "stat" },
      { week_start: "2026-08-24", key: "B", kg: "50", source: "stat" }, { week_start: "2026-08-31", key: "A", kg: "7", source: "sales" },
    ];
    expect(effectiveForecasts(f, "2026-08-24").map((x) => `${x.key}:${x.kg}:${x.source}`)).toEqual(["A:100:sales", "B:50:stat"]);
    const wd = weeklyDemand({ orders: [], forecasts: f, weights: W, weekStart: "2026-08-24" });
    expect(wd.map((r) => [r.key, r.forecast_kg.toFixed(0)])).toEqual([["A", "100"], ["B", "50"]]);
    const byDate = forecastLinesByDate({ forecasts: f, weekStart: "2026-08-24", weight: "1", keys: () => true });
    expect(byDate.filter((l) => l.key === "A").reduce((a, l) => a.plus(D(l.kg)), D(0)).toFixed(2)).toBe("100.00");
  });
});

describe("R50 — STD is a class of C58; supply without a class is ignored and reported in kg", () => {
  const unsized: SizedLine[] = [{ ship_date: "2026-08-27", key: "RPA|Karkas|n/a", size_kg: null, kg: "1000" }];
  const cd = toClassLB({ lines: unsized, setup });
  const days = dailyClassPlan({ demand: cd, leadTimeDays: 1 });
  const need = needByCutDate(days);
  it("the need of a cut date includes STD (the lines without a size)", () => {
    expect(need.map((n) => `${n.cut_date} ${n.weight_class}`)).toEqual(["2026-08-26 STD"]);
    expect(need[0].kg_lb.gt(0)).toBe(true);
  });
  it("C58_UNSIZED: STD need with only supply of other classes → PERIKSA", () => {
    const c = c58({ need, supply: [{ date: "2026-08-26", weight_class: "K", kg_lb: "5000" }] });
    expect(c.status).toBe("PERIKSA");
    expect(c.detail[0]).toMatch(/^2026-08-26 STD: supply 0 < kebutuhan \d+ kg LB$/);
  });
  it("C58_UNSIZED: supply without a class does not cover it (O20) → PERIKSA, and the message says 'n kg tanpa kelas' (kg, not rows)", () => {
    const c = c58({ need, supply: [{ date: "2026-08-26", weight_class: null, kg_lb: "4000" }, { date: "2026-08-26", weight_class: null, kg_lb: "1500" }] });
    expect(c.status).toBe("PERIKSA");
    expect(c.detail).toContain("5500 kg tanpa kelas (supply tanpa kelas diabaikan, O20)");
  });
  it("nothing entered at all → BELUM DIISI; STD supplied for the date in full → LULUS", () => {
    expect(c58({ need, supply: [] }).status).toBe("BELUM DIISI");
    expect(c58({ need, supply: [{ date: "2026-08-26", weight_class: "STD", kg_lb: need[0].kg_lb.plus(1).toFixed(0) }] }).status).toBe("LULUS");
  });
  it("a cut date with supply of other classes only is short for the class that has none (not 'belum diisi')", () => {
    const sized = toClassLB({ lines: [{ ship_date: "2026-08-27", key: "RPA|Karkas|Fresh", size_kg: "1.30", kg: "1000" }], setup });
    const n = needByCutDate(dailyClassPlan({ demand: sized, leadTimeDays: 1 }));
    expect(c58({ need: n, supply: [{ date: "2026-08-26", weight_class: "B", kg_lb: "9999" }] }).status).toBe("PERIKSA");
  });
});

describe("R51 — LB price: the decision of the class, else of all classes, else none (C57)", () => {
  const decisions = [
    { date: "2026-08-28", weight_class: null, price: "24000" },
    { date: "2026-08-28", weight_class: "K", price: "25500" },
    { date: "2026-08-29", weight_class: "S", price: "26000" },
  ];
  it("class decision first, then the one for all classes, then nothing", () => {
    expect(lbDecisionFor(decisions, "2026-08-28", "K")?.price).toBe("25500");
    expect(lbDecisionFor(decisions, "2026-08-28", "S")?.price).toBe("24000");
    expect(lbDecisionFor(decisions, "2026-08-29", "S")?.price).toBe("26000");
    expect(lbDecisionFor(decisions, "2026-08-29", "K")).toBeNull();
    expect(lbDecisionFor(decisions, "2026-08-30", null)).toBeNull();
  });
  it("C57 per cut date × class of the batches to be created", () => {
    const c = c57({ cutDates: [], decisions, cuts: [{ date: "2026-08-28", weight_class: "K" }, { date: "2026-08-29", weight_class: "K" }, { date: "2026-08-29", weight_class: "S" }] });
    expect(c.status).toBe("BELUM DIISI");
    expect(c.detail).toEqual(["2026-08-29 K"]);
    expect(c.dates).toEqual(["2026-08-29"]);
    expect(c57({ cutDates: [], decisions, cuts: [{ date: "2026-08-28", weight_class: "K" }, { date: "2026-08-29", weight_class: "S" }] }).status).toBe("LULUS");
  });
  it("without cuts C57 is what it was: a decision on the date covers it", () => {
    expect(c57({ cutDates: ["2026-08-28", "2026-08-30"], decisions }).detail).toEqual(["2026-08-30"]);
  });
});

describe("R54 — the due dates a task rule queues", () => {
  it("lock → the Friday before the week; WP → the day after the batch (H+1); the plan → its Monday; an event has none", () => {
    expect(dueDatesFor({ due_rule: "week_start - 3 days 17:00" }, "2026-08-31")).toEqual(["2026-08-28"]);
    expect(dueDatesFor({ due_rule: "batch.date + 1 day 12:00" }, "2026-08-26")).toEqual(["2026-08-27"]);
    expect(dueDatesFor({ due_rule: "week_start + 0 days 10:00" }, "2026-08-24")).toEqual(["2026-08-24"]);
    expect(dueDatesFor({ due_rule: "event" }, "2026-08-26")).toEqual([]);
    expect(dueDatesFor({ due_rule: "kapan-kapan" }, "2026-08-26")).toEqual([]);
  });
});

describe("O21(b) — what an assignment key covers", () => {
  it("with a form suffix: that exact key; without: both forms; null: all", () => {
    expect(assignmentCovers("RPA|Karkas|Fresh", "RPA|Karkas|Fresh")).toBe(true);
    expect(assignmentCovers("RPA|Karkas|Fresh", "RPA|Karkas|Frozen")).toBe(false);
    expect(assignmentCovers("RPA|Karkas|Fresh", "RPA|Karkas|n/a")).toBe(false);
    expect(assignmentCovers("RPA|Karkas", "RPA|Karkas|Fresh")).toBe(true);
    expect(assignmentCovers("RPA|Karkas", "RPA|Karkas|Frozen")).toBe(true);
    expect(assignmentCovers("RPA|Karkas", "RPA|Sayap|Fresh")).toBe(false);
    expect(assignmentCovers(null, "RPA|Sayap|Fresh")).toBe(true);
    expect(assignmentCovers("RPA|Karkas", null)).toBe(false);
  });
  it("one assignment row must cover customer and key together", () => {
    const a = [{ customer: "PT A", key: "RPA|Karkas" }, { customer: "PT B", key: "RPA|Sayap|Fresh" }];
    expect(inAssignmentScope(a, { customer: "pt a", key: "RPA|Karkas|Frozen" })).toBe(true);
    expect(inAssignmentScope(a, { customer: "PT A", key: "RPA|Sayap|Fresh" })).toBe(false);
    expect(inAssignmentScope(a, { customer: "PT B", key: "RPA|Sayap|Frozen" })).toBe(false);
    expect(inAssignmentScope(a, { customer: "PT B", key: "RPA|Sayap|Fresh" })).toBe(true);
    expect(inAssignmentScope(a, { customer: null, key: "RPA|Karkas|Fresh" })).toBe(true);
    expect(inAssignmentScope([{ customer: null, key: null }], { customer: "PT Z", key: "Trading|BLP|Frozen" })).toBe(true);
  });
});

describe("R58 — C22 over the output that will be saved", () => {
  const dir = join(repoRoot(), "fixtures");
  const ctx0 = JSON.parse(readFileSync(join(dir, "upload-samples/context.json"), "utf8")) as Omit<UploadContext, "items">;
  const items = (JSON.parse(readFileSync(join(dir, "week-2026-08-24/item_map.json"), "utf8")) as { item_code: string; item_name: string | null; key: string }[]).map((i) => ({ code: i.item_code, name: i.item_name, key: i.key }));
  const ctx: UploadContext = { ...ctx0, items };
  const c22 = (r: ReturnType<typeof validateUpload>) => r.checks.find((c) => c.code === "C22")!;
  // 10.000 kg LB → 9.700 kg expected after the 3 % shrink
  const grid = (valid: number, held: number): Grid => [
    ["batch", "kg_lb", "ekor", "kode_item", "kg"],
    ["B260826", 10000, 5000, "JLB0763", valid], ["B260826", "", "", "X-HATI", held],
  ];
  const ctxB = { ...ctx, batches: [{ ref: "B260826", date: "2026-08-26", lb_kg: null, heads: null }] };

  it("WP_HELD_MASS: the held rows no longer make a short file look complete — 6.000 saved of 9.700 → GAGAL C22", () => {
    const r = validateUpload("costing_wp", grid(6000, 3600), ctxB);
    expect(r.ok_count).toBe(1);
    expect(c22(r)).toMatchObject({ level: "fail", result: "perlu penjelasan", detail: "6.000,0 vs 9.700,0 kg (LB − susut 3%), selisih 38,1% (batas 2%)" });
    expect(r.needsReason).toEqual(["B260826"]);
  });
  it("the same file with everything passing is LULUS", () => {
    const r = validateUpload("costing_wp", grid(9650, 0).slice(0, 2), ctxB);
    expect(c22(r)).toMatchObject({ level: "ok", result: "lolos" });
    expect(r.needsReason).toEqual([]);
  });
  it("a held line keeps the old row of its code: that old output counts with the rows that pass", () => {
    const withOld = { ...ctxB, batches: [{ ...ctxB.batches[0], output: [{ key: "RPA|Hati|Fresh", item_code: "X-HATI", kg: "3600" }, { key: "RPA|Ceker|Fresh", item_code: "JLB-OTHER", kg: "500" }] }] };
    const r = validateUpload("costing_wp", grid(6000, 3600), withOld);
    // the X-HATI row is held, so the commit keeps its old 3.600 kg; the unrelated old row is retired by the commit and does not count
    expect(c22(r)).toMatchObject({ level: "ok", detail: "9.600,0 vs 9.700,0 kg (LB − susut 3%), selisih 1,0% (batas 2%); termasuk 3.600,0 kg output lama yang dipertahankan" });
    // a passing row of the same key|code replaces the old one: it is not counted twice
    const replaced = { ...ctxB, batches: [{ ...ctxB.batches[0], output: [{ key: "RPA|Karkas|Fresh", item_code: "JLB0763", kg: "6000" }] }] };
    expect(c22(validateUpload("costing_wp", grid(6000, 0).slice(0, 2), replaced)).detail).toMatch(/^6\.000,0 vs 9\.700,0 kg/);
  });
});

describe("R52 — the saved plan_week_class split over the cut dates (splitClassPlan)", () => {
  const profile = [
    { cut_date: "2026-08-26", weight_class: "K", kg_lb: "600" }, { cut_date: "2026-08-27", weight_class: "K", kg_lb: "400" },
    { cut_date: "2026-08-26", weight_class: "S", kg_lb: "1000" }, { cut_date: "2026-08-27", weight_class: "S", kg_lb: "500" },
    { cut_date: "2026-08-26", weight_class: "B", kg_lb: "300" }, { cut_date: "2026-08-27", weight_class: "B", kg_lb: "300" },
  ];
  const saved = [{ weight_class: "K", kg_lb: "230.00", heads: 120 }, { weight_class: "S", kg_lb: "1389.00", heads: 801 }, { weight_class: "B", kg_lb: "811.00", heads: 407 }];
  it("K / S / B on two dates: the batches add up exactly to the saved heads and kg LB of every class", () => {
    const r = splitClassPlan({ saved, profile });
    expect(r.unplaced).toEqual([]);
    expect(r.cuts.map((c) => `${c.cut_date} ${c.weight_class}`)).toEqual(["2026-08-26 B", "2026-08-26 K", "2026-08-26 S", "2026-08-27 B", "2026-08-27 K", "2026-08-27 S"]);
    for (const sv of saved) {
      const mine = r.cuts.filter((c) => c.weight_class === sv.weight_class);
      expect(mine.reduce((a, c) => a + c.heads, 0)).toBe(sv.heads);
      expect(mine.reduce((a, c) => a.plus(c.kg_lb), D(0)).toFixed(2)).toBe(sv.kg_lb);
    }
  });
  it("heads follow the profile (largest remainder): K 120 heads on 600 : 400 → 72 and 48; kg LB = heads × the saved kg per head", () => {
    const k = splitClassPlan({ saved: [saved[0]], profile }).cuts;
    expect(k.map((c) => c.heads)).toEqual([72, 48]);
    expect(k.map((c) => c.kg_lb.toFixed(2))).toEqual(["138.00", "92.00"]);
  });
  it("a class with 1 head goes to the date with the larger need, the other date gets no batch (no kg without heads)", () => {
    const r = splitClassPlan({ saved: [{ weight_class: "K", kg_lb: "2.00", heads: 1 }], profile });
    expect(r.cuts).toHaveLength(1);
    expect(r.cuts[0]).toMatchObject({ cut_date: "2026-08-26", heads: 1 });
    expect(r.cuts[0].kg_lb.toFixed(2)).toBe("2.00");
  });
  it("a saved class with no need left in the profile is returned unplaced — nothing is invented; an empty saved row is skipped", () => {
    const r = splitClassPlan({ saved: [{ weight_class: "STD", kg_lb: "100.00", heads: 50 }, { weight_class: "K", kg_lb: null, heads: 0 }], profile });
    expect(r.unplaced).toEqual(["STD"]);
    expect(r.cuts).toEqual([]);
  });
});
