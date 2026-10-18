/**
 * Q-v5.2-50 (A5 finding): C42 ("Yield matrix bukan placeholder") judges only the effective yield rows (the latest effective date per
 * class × pattern × key) of the patterns the plan uses — karkas (O33 (b)). The old `boneless` placeholder rows of the workbook
 * (BLD, BLP: the upload cannot replace them) no longer hold "Salin ke batch"; a row a newer effective date has replaced does not count.
 */
import { describe, expect, it, vi } from "vitest";
import { ppicControls, type WeekDemandResult } from "@kgr/engine";
import { memSb } from "../../test-support/mem-sb";

vi.mock("server-only", () => ({}));
const { c42Notes, loadPlanning } = await import("./planning");

const PH = "Placeholder: yield v1 × (1 − 0,03)";
const KEYS = ["Karkas", "Kepala", "Ceker", "Usus", "HJA (Hati/Jantung/Ampela)", "Lemak"];
const row = (cut_pattern: string, key: string, effective_from: string, note: string | null, weight_class = "STD") =>
  ({ id: `${weight_class}|${cut_pattern}|${key}|${effective_from}`, weight_class, cut_pattern, key, yield_pct: "0.1", effective_from, effective_to: null, note, deleted_at: null });
const week = { id: "w1", week_start: "2026-08-24", week_end: "2026-08-30", update_date: "2026-08-27", status: "open", tb_opening_date: "2026-08-23" } as never;

const c42 = (notes: (string | null)[]) => {
  const demand = { shortfalls: [] } as unknown as WeekDemandResult;
  const c = ppicControls({ weekStart: "2026-08-24", demand, buyPrice: () => null, yieldNotes: notes, surplus: [], planDates: [], capacity: () => null, historyDays: new Map(), forecastKeys: new Set() })
    .find((x) => x.code === "C42")!;
  return c.status;
};
const src = (yield_matrix: ReturnType<typeof row>[]) => loadPlanning(memSb({ parameter: [{ week_id: "w1" }], yield_matrix }) as never, week);

describe("Q-v5.2-50: C42 hanya baris yield efektif dari pola yang dipakai rencana", () => {
  const placeholders = [...KEYS.map((k) => row("karkas", k, "2026-01-01", PH)), row("boneless", "BLD", "2026-01-01", "Placeholder: I_Yield"), row("boneless", "BLP", "2026-01-01", "Placeholder: I_Yield")];

  it("masih placeholder di karkas: BELUM DIISI (perilaku lama)", async () => {
    const p = await src(placeholders);
    expect(c42(c42Notes(p.yieldRows, "STD", ["karkas"]))).toBe("BELUM DIISI");
  });
  it("PPIC mengganti semua baris karkas (berlaku mulai sama atau lebih baru); boneless placeholder tersisa: LULUS", async () => {
    const replaced = [
      ...KEYS.slice(0, 3).map((k) => row("karkas", k, "2026-01-01", null)), // replaced in place (same effective date)
      ...KEYS.slice(3).map((k) => row("karkas", k, "2026-08-01", null)), // replaced by a newer effective date; the old placeholder row stays in the table
      ...KEYS.slice(3).map((k) => row("karkas", k, "2026-01-01", PH)),
      row("boneless", "BLD", "2026-01-01", "Placeholder: I_Yield"), row("boneless", "BLP", "2026-01-01", "Placeholder: I_Yield"),
    ];
    const p = await src(replaced);
    // loadPlanning keeps one row per class × pattern × key: the newer effective date wins over the placeholder it replaced
    expect(p.yieldRows.filter((y) => y.cut_pattern === "karkas").every((y) => y.note === null)).toBe(true);
    expect(p.yieldRows.filter((y) => y.cut_pattern === "karkas").length).toBe(6);
    expect(c42(c42Notes(p.yieldRows, "STD", ["karkas"]))).toBe("LULUS");
    // the old rule (every pattern of the class) would have kept it BELUM DIISI
    expect(c42(p.yieldRows.filter((y) => y.weight_class === "STD").map((y) => y.note))).toBe("BELUM DIISI");
  });
  it("rencana tanpa campuran pola (belum ada rencana) dibaca sebagai karkas", async () => {
    const p = await src(placeholders.map((r) => (r.cut_pattern === "karkas" ? { ...r, note: null } : r)));
    expect(c42(c42Notes(p.yieldRows, "STD", []))).toBe("LULUS");
  });
  it("rencana yang memakai boneless: placeholder boneless tetap menahan (yang dipakai rencana yang dinilai)", async () => {
    const p = await src(placeholders.map((r) => (r.cut_pattern === "karkas" ? { ...r, note: null } : r)));
    expect(c42(c42Notes(p.yieldRows, "STD", ["karkas", "boneless"]))).toBe("BELUM DIISI");
  });
  it("kelas lain tidak dihitung; baris yield efektif di masa depan tidak dibaca", async () => {
    const p = await src([...KEYS.map((k) => row("karkas", k, "2026-01-01", null)), row("karkas", "Karkas", "2026-01-01", PH, "K"), row("karkas", "Karkas", "2026-09-07", PH)]);
    expect(p.yieldRows.find((y) => y.weight_class === "STD" && y.key === "Karkas")?.note).toBeNull();
    expect(c42(c42Notes(p.yieldRows, "STD", ["karkas"]))).toBe("LULUS");
  });
  it("tanpa baris sama sekali: BELUM DIISI", () => {
    expect(c42(c42Notes([], "STD", ["karkas"]))).toBe("BELUM DIISI");
  });
});
