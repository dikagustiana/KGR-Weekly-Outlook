/**
 * Q-v5.2-36 (A3 finding): a tariff period that holds a batch without kg LB has no idle capacity computed — an unknown day is not a
 * day of 0 kg — and the costing screen says so ("kapasitas idle belum dihitung: batch tanpa kg LB") instead of staying silent.
 * No control of its own. In-memory client that applies the filters (test-support/mem-sb.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { memSb } from "../../test-support/mem-sb";

vi.mock("server-only", () => ({}));
vi.mock("../v3/ledger", () => ({ v5SelisihCosting: async () => [] }));
vi.mock("./costing", () => ({ v5CostingOn: async () => true }));
const { idleSkipped, idleSkippedNote, idleCostRows } = await import("./costing-pl");

const rate = (period_start: string, period_end: string) => ({ id: period_start, period_start, period_end, basis_kg: "100000", rate_per_kg_lb: "150", deleted_at: null });
const batch = (date: string, status: string, lb_kg: string | null, batch_ref: string, cost_mode = "own") => ({ id: batch_ref, date, status, lb_kg, batch_ref, cost_mode, deleted_at: null, superseded_at: null });
const rates = [rate("2026-08-01", "2026-08-31"), rate("2026-09-01", "2026-09-30")];

describe("Q-v5.2-36: periode tarif yang dilewati karena batch tanpa kg LB", () => {
  it("batch Aktual tanpa kg LB di Agustus: periode Agustus dilewati dan batch itu disebut; September tidak", async () => {
    const sb = memSb({ overhead_rate: rates, batch: [batch("2026-08-26", "Aktual", null, "126/PO/KGR/08/2026"), batch("2026-08-27", "Aktual", "12000", "127/PO/KGR/08/2026"), batch("2026-09-02", "Aktual", "9000", "130/PO/KGR/09/2026")] }) as never;
    const sk = await idleSkipped(sb, "2026-08-24", "2026-09-06");
    expect(sk).toEqual([{ period_start: "2026-08-01", period_end: "2026-08-31", batches: ["126/PO/KGR/08/2026"] }]);
    expect(idleSkippedNote(sk[0])).toBe("kapasitas idle belum dihitung: batch tanpa kg LB (126/PO/KGR/08/2026)");
    // the P&L rows follow the same rule: no idle row for August, September is computed
    const rows = await idleCostRows(sb, "2026-08-24", "2026-09-06");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.date >= "2026-09-01")).toBe(true);
  });
  it("hari dengan batch Aktual yang berisi kg LB dinilai dari yang Aktual; batch Rencana tanpa kg LB tidak membuat hari itu tak dikenal", async () => {
    const sb = memSb({ overhead_rate: rates, batch: [batch("2026-08-26", "Aktual", "12000", "A"), batch("2026-08-26", "Rencana", null, "R")] }) as never;
    expect(await idleSkipped(sb, "2026-08-24", "2026-08-30")).toEqual([]);
  });
  it("hari tanpa Aktual: batch Rencana tanpa kg LB membuatnya tak dikenal", async () => {
    const sb = memSb({ overhead_rate: rates, batch: [batch("2026-08-28", "Rencana", null, "R-128")] }) as never;
    expect((await idleSkipped(sb, "2026-08-24", "2026-08-30"))[0].batches).toEqual(["R-128"]);
  });
  it("batch maklon tidak dihitung (hanya mode RPA sendiri punya idle); tanpa tarif berbasis tidak ada yang dilewati", async () => {
    expect(await idleSkipped(memSb({ overhead_rate: rates, batch: [batch("2026-08-26", "Aktual", null, "M", "maklon")] }) as never, "2026-08-24", "2026-08-30")).toEqual([]);
    expect(await idleSkipped(memSb({ overhead_rate: [{ ...rate("2026-08-01", "2026-08-31"), basis_kg: null }], batch: [batch("2026-08-26", "Aktual", null, "X")] }) as never, "2026-08-24", "2026-08-30")).toEqual([]);
  });
  it("lebih dari tiga batch: tiga pertama dan jumlah sisanya", () => {
    expect(idleSkippedNote({ period_start: "a", period_end: "b", batches: ["1", "2", "3", "4", "5"] })).toBe("kapasitas idle belum dihitung: batch tanpa kg LB (1, 2, 3, +2)");
  });
});
