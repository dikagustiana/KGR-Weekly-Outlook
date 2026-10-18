/**
 * PRD v5.2-A R57 (A-UI-21): a saved LB price decision is always reported as saved. A cut date more than 62 days behind the data
 * date cannot be queued automatically (K40); that is a sentence in the message (Admin rebuilds the range), not an error that
 * makes the director enter the decision again.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { memSb } from "../../test-support/mem-sb";
import { WEEK } from "../../test-support/plan-seed";

vi.mock("server-only", () => ({}));
const { insertLbDecision } = await import("./lb-decision");
beforeAll(() => { process.env.KGR_TEST_NOW = "2026-08-27T09:00:00+07:00"; });
const form = (f: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(f)) d.append(k, v); return d; };

describe("R57 — the decision is saved; the queue is a note", () => {
  it("a cut date inside the window: saved and queued, no note", async () => {
    const sb = memSb({ week: [WEEK] });
    const msg = await insertLbDecision(sb as never, form({ date: "2026-08-28", price: "24.500" }));
    expect(msg).toContain("Harga LB potong 2026-08-28 diputuskan Rp 24.500/kg");
    expect(msg).not.toContain("Rebuild tidak diantrekan");
    expect(sb.tables.lb_price_decision).toHaveLength(1);
    expect(sb.calls("rebuild_queue:insert")).toHaveLength(1);
  });
  it("a cut date over 62 days behind the data date: the decision is saved and the message names the manual rebuild — no error", async () => {
    const sb = memSb({ week: [WEEK] });
    const msg = await insertLbDecision(sb as never, form({ date: "2026-05-01", price: "24500", weight_class: "K" }));
    expect(sb.tables.lb_price_decision).toHaveLength(1);
    expect(sb.tables.lb_price_decision[0]).toMatchObject({ date: "2026-05-01", weight_class: "K" });
    expect(msg).toContain("Harga LB potong 2026-05-01 kelas K diputuskan");
    expect(msg).toMatch(/Rebuild tidak diantrekan: .*rebuild manual dari Admin/);
    expect(sb.calls("rebuild_queue:insert")).toHaveLength(0);
  });
  it("a database refusal of the decision itself is still an error", async () => {
    const sb = memSb({ week: [WEEK] }, { fail: { "lb_price_decision:insert": "permission denied for table lb_price_decision" } });
    await expect(insertLbDecision(sb as never, form({ date: "2026-08-28", price: "24500" }))).rejects.toThrow("permission denied");
  });
});
