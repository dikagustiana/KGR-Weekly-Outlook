/** PRD v5 §4.9, §3.1 (K35): task instances from the registry, status from the data, the completeness grid and K35. */
import { describe, expect, it } from "vitest";
import { completenessCells, dueOf, effectiveCell, effectiveStatus, instancesDue, k35, parseDueRule, taskOf, type TaskRule } from "../src/input-tasks";

// the registry seeded by v5/0 (§3.1)
const rules: TaskRule[] = [
  { kind: "commitment_lock", title: "Kunci komitmen minggu depan", owner_role: "commercial_lead", due_rule: "week_start - 3 days 17:00", impact_text: "" },
  { kind: "plan_week", title: "Rencana mingguan per kelas", owner_role: "ppic", due_rule: "week_start + 0 days 10:00", impact_text: "" },
  { kind: "lb_price_decision", title: "Putuskan harga LB", owner_role: "operations_director", due_rule: "cut_date - 1 day 12:00", impact_text: "" },
  { kind: "costing_wp", title: "WP potong per batch", owner_role: "cost_accounting", due_rule: "batch.date + 1 day 12:00", impact_text: "" },
  { kind: "supplier_invoice", title: "Faktur pemasok", owner_role: "cost_accounting", due_rule: "event", impact_text: "" },
  { kind: "gl_daily", title: "Jurnal Accurate harian", owner_role: "inventory_accounting", due_rule: "date + 0 days 16:00", impact_text: "" },
  { kind: "fixed_cost", title: "Jadwal beban tetap", owner_role: "finance", due_rule: "month_start + 0 days 17:00", impact_text: "" },
  { kind: "budget", title: "Budget", owner_role: "finance", due_rule: "month_start + 0 days 17:00", impact_text: "", active: false },
];

describe("aturan tenggat", () => {
  it("parse dan tenggat WIB", () => {
    expect(parseDueRule("batch.date + 1 day 12:00")).toEqual({ event: false, anchor: "batch.date", days: 1, time: "12:00" });
    expect(parseDueRule("week_start - 3 days 17:00")).toEqual({ event: false, anchor: "week_start", days: -3, time: "17:00" });
    expect(parseDueRule("event")).toEqual({ event: true });
    expect(parseDueRule("kapan-kapan")).toBeNull();
    const p = parseDueRule("week_start - 3 days 17:00");
    if (!p || p.event) throw new Error("rule");
    // commitments of the week of Mon 31 Aug are due Friday 28 Aug 17.00
    expect(dueOf(p, "2026-08-31")).toEqual({ date: "2026-08-28", at: "2026-08-28T17:00:00+07:00" });
  });

  it("instance yang jatuh tempo per tanggal", () => {
    const x = { cutDates: ["2026-08-28"], batches: [{ ref: "B260826", date: "2026-08-26" }, { ref: "B260827", date: "2026-08-27" }] };
    const at = (d: string) => instancesDue(rules, d, x).map((i) => `${i.kind}:${i.ref}`);
    expect(at("2026-08-27")).toEqual(["lb_price_decision:2026-08-28", "costing_wp:B260826", "supplier_invoice:B260827", "gl_daily:2026-08-27"]);
    expect(at("2026-08-28")).toEqual(["commitment_lock:2026-08-31", "costing_wp:B260827", "gl_daily:2026-08-28"]);
    expect(at("2026-08-24")).toEqual(["plan_week:2026-08-24", "gl_daily:2026-08-24"]);
    expect(at("2026-08-30")).toEqual([]); // Sunday
    expect(at("2026-09-01")).toEqual(["gl_daily:2026-09-01", "fixed_cost:2026-09"]); // budget rule inactive
  });
});

describe("status dari data", () => {
  const wp = instancesDue(rules, "2026-08-27", { cutDates: [], batches: [{ ref: "B260826", date: "2026-08-26" }] }).find((i) => i.kind === "costing_wp")!;
  const inv = instancesDue(rules, "2026-08-26", { cutDates: [], batches: [{ ref: "B260826", date: "2026-08-26" }] }).find((i) => i.kind === "supplier_invoice")!;
  it("belum → terlambat setelah tenggat; masuk dengan catatan; lolos cek", () => {
    expect(taskOf(wp, { done: null }, "2026-08-27T09:30:00+07:00").status).toBe("open");
    expect(taskOf(wp, { done: null }, "2026-08-27T12:00:00+07:00").status).toBe("late");
    expect(taskOf(wp, { done: "noted", done_at: "2026-08-27T08:47:00+07:00" }, "2026-08-27T13:00:00+07:00")).toMatchObject({ status: "received", done_at: "2026-08-27T08:47:00+07:00" });
    expect(taskOf(wp, { done: "passed" }, "2026-08-28T00:00:00+07:00").status).toBe("passed");
    // an event has no deadline: waiting until the invoice is there
    expect(taskOf(inv, { done: null }, "2026-09-30T00:00:00+07:00").status).toBe("waiting");
  });
  it("status efektif: tugas tersimpan 'belum' menjadi terlambat saat dibaca setelah tenggat", () => {
    const t = taskOf(wp, { done: null }, "2026-08-27T09:30:00+07:00");
    expect(effectiveStatus(t, "2026-08-27T09:31:00+07:00")).toBe("open");
    expect(effectiveStatus(t, "2026-08-27T12:01:00+07:00")).toBe("late");
  });
});

describe("grid kelengkapan dan K35", () => {
  const now0 = "2026-08-27T09:30:00+07:00";
  const x = { cutDates: [], batches: [{ ref: "B260825", date: "2026-08-25" }, { ref: "B260826", date: "2026-08-26" }] };
  const tasks = ["2026-08-25", "2026-08-26", "2026-08-27"].flatMap((d) => instancesDue(rules, d, x)).map((i) =>
    taskOf(i, i.kind === "costing_wp" && i.ref === "B260825" ? { done: null } : i.kind === "gl_daily" && i.ref === "2026-08-25" ? { done: "noted" } : i.kind === "gl_daily" && i.ref === "2026-08-27" ? { done: null } : { done: "passed" }, now0));
  const cells = completenessCells(tasks, rules, now0);

  it("sel per tanggal × input: lewat tenggat = merah, catatan = kuning, belum jatuh tempo", () => {
    const at = (d: string, k: string) => cells.find((c) => c.date === d && c.kind === k);
    expect(at("2026-08-26", "costing_wp")).toMatchObject({ status: "late", owner_role: "cost_accounting", note: "B260825" });
    expect(at("2026-08-25", "gl_daily")?.status).toBe("noted");
    expect(at("2026-08-27", "gl_daily")).toMatchObject({ status: "not_due", due_at: "2026-08-27T16:00:00+07:00" });
    expect(at("2026-08-27", "costing_wp")?.status).toBe("passed");
    expect(effectiveCell(at("2026-08-27", "gl_daily")!, "2026-08-27T16:30:00+07:00")).toBe("late");
  });

  it("K35: sel merah menahan rilis kecuali override K35", () => {
    expect(k35({ cells, weekStart: "2026-08-24", now: now0, override: false })).toMatchObject({ ok: false, red: [{ date: "2026-08-26", kind: "costing_wp" }] });
    expect(k35({ cells, weekStart: "2026-08-24", now: now0, override: true }).ok).toBe(true);
    // after 16.00 the journal of the 27th is red too
    expect(k35({ cells, weekStart: "2026-08-24", now: "2026-08-27T16:30:00+07:00", override: false }).red.map((c) => c.kind)).toEqual(["costing_wp", "gl_daily"]);
    // another week: nothing red
    expect(k35({ cells, weekStart: "2026-08-31", now: now0, override: false })).toEqual({ ok: true, red: [] });
  });
});
