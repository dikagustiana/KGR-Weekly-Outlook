import { describe, expect, it } from "vitest";
import { releaseReadiness } from "./readiness";

const grid = (late: boolean, override: { reason: string; by: string | null } | null = null) => ({
  weekStart: "2026-08-24", days: ["2026-08-24"], override,
  rows: [{ kind: "gl_daily", title: "Jurnal Accurate", owner: "inventory_accounting" as const, cells: [{ date: "2026-08-24", status: late ? ("late" as const) : ("passed" as const), note: null }] }],
});

describe("releaseReadiness (R151)", () => {
  it("a late cell holds the release, with the input named", () => {
    expect(releaseReadiness({ grid: grid(true), tasks: [] })).toEqual({ ready: false, reasons: ["Jurnal Accurate lewat tenggat"], exception: null });
  });
  it("the K35 exception makes it ready and is said", () => {
    expect(releaseReadiness({ grid: grid(true, { reason: "jurnal susulan", by: "fin" }), tasks: [] })).toEqual({ ready: true, reasons: [], exception: "jurnal susulan" });
  });
  it("no grid is not ready (never 'ya' by default)", () => {
    expect(releaseReadiness({ grid: null, tasks: [] }).ready).toBe(false);
  });
});
