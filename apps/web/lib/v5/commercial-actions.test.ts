/**
 * PRD v5.2-A R54 (an input queues the due dates of its tasks and the queue is processed inline), R55 (commitments: only what
 * changed, all drafts in one request) and R56 (the surplus answer carries the SKU of the surplus row), through the actions with
 * the in-memory client. What the database does with the request (the trigger, the partial unique indexes, RLS) is proved on
 * PostgreSQL + PostgREST in docs/v5.2/a2.md, not here.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { memSb, type MemRow, type MemSb } from "../../test-support/mem-sb";
import { WEEK } from "../../test-support/plan-seed";
import { rowDirty } from "@/components/v5/CommitmentRows";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let sb: MemSb = memSb();
vi.mock("@/lib/supabase", () => ({ supabaseServer: async () => sb }));
vi.mock("@/lib/modules", () => ({ requireModuleAction: async () => ({ email: "lead@x.test", role: "commercial_lead" }), moduleSettings: async () => ({}) }));
const processed = vi.fn(async () => ({ done: 1, failed: 0, notes: [] as string[] }));
vi.mock("@/lib/rebuild", async (orig) => ({ ...(await orig<typeof import("@/lib/rebuild")>()), processRebuildQueue: processed }));
const { saveCommitmentsAction, lockCommitmentsAction, answerSurplusAction } = await import("@/app/komersial/actions-v5");

beforeAll(() => { process.env.KGR_TEST_NOW = "2026-08-27T09:00:00+07:00"; });
afterEach(() => { sb = memSb(); processed.mockClear(); vi.restoreAllMocks(); });
const form = (f: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(f)) d.append(k, v); return d; };
const NEXT = "2026-08-31";
const rules: MemRow[] = [
  { kind: "commitment_lock", due_rule: "week_start - 3 days 17:00", active: true }, { kind: "price_list_lock", due_rule: "week_start - 3 days 17:00", active: true },
  { kind: "plan_week", due_rule: "week_start + 0 days 10:00", active: true },
];
const queued = () => (sb.calls("rebuild_queue:insert")[0]?.payload as MemRow[] | undefined)?.map((r) => r.date);

describe("R54 — the lock queues the Friday before the week and the queue is processed", () => {
  it("lock → rebuild_queue holds 2026-08-28 (the Friday before 31 Aug), once for both lock tasks, and the queue is processed inline", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, rebuild_queue: [] }, { rpc: { lock_commitments: () => ({ data: 5 }) } });
    const r = await lockCommitmentsAction({}, form({ week_start: NEXT, "price_frozen|RPA|Sayap": "28.000" }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe("5 draft komitmen dikunci bersama price list minggu depan; harga frozen dari form untuk 1 SKU");
    expect(sb.rpcCalls).toEqual([{ name: "lock_commitments", args: { p_week_start: NEXT, p_price_frozen: { "RPA|Sayap": "28000" } } }]);
    expect(queued()).toEqual(["2026-08-28"]);
    expect(sb.calls("rebuild_queue:insert")[0].payload).toEqual([{ date: "2026-08-28", reason: "komitmen dikunci" }]);
    expect(processed).toHaveBeenCalledTimes(1);
    // no table write of its own on the commitment tables: the RPC is the one transaction
    expect(sb.log.filter((l) => l.op !== "select" && l.op !== "rpc" && (l.table === "sales_commitment" || l.table === "price_list_week"))).toEqual([]);
  });
  it("the rule read is not swallowed: a failing read of input_task_rule is told in the message, and the lock is still reported as saved", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sb = memSb({ week: [WEEK] }, { rpc: { lock_commitments: () => ({ data: 2 }) }, fail: { input_task_rule: "permission denied for table input_task_rule" } });
    const r = await lockCommitmentsAction({}, form({ week_start: NEXT }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toContain("2 draft komitmen dikunci");
    expect(r.ok).toContain("Status tugas belum diperbarui (input_task_rule: permission denied for table input_task_rule)");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
    expect(sb.calls("rebuild_queue:insert")).toHaveLength(0);
  });
  it("a queue that cannot be written after the RPC succeeded does not turn the lock into a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sb = memSb({ week: [WEEK], input_task_rule: rules }, { rpc: { lock_commitments: () => ({ data: 3 }) }, fail: { "rebuild_queue:insert": "canceling statement due to statement timeout" } });
    const r = await lockCommitmentsAction({}, form({ week_start: NEXT }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toContain("3 draft komitmen dikunci");
    expect(r.ok).toContain("Status tugas belum diperbarui");
  });
  it("the RPC refuses: the message of the database, nothing queued", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules }, { fail: { "rpc:lock_commitments": "Versi baru setelah kunci wajib alasan: RPA|Sayap" } });
    const r = await lockCommitmentsAction({}, form({ week_start: NEXT }));
    expect(r.error).toBe("Versi baru setelah kunci wajib alasan: RPA|Sayap");
    expect(sb.calls("rebuild_queue:insert")).toHaveLength(0);
    expect(processed).not.toHaveBeenCalled();
  });
  it("saving commitments queues the same Friday; answering a surplus queues the date of the plan", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, sales_commitment: [] });
    await saveCommitmentsAction({}, form({ week_start: NEXT, n: "1", key_0: "RPA|Karkas", fresh_0: "100", frozen_0: "0" })); // R64: a commitment names both kg (0 typed on purpose)
    expect(queued()).toEqual(["2026-08-28"]);
    sb = memSb({ week: [WEEK], input_task_rule: rules, plan_week: [{ id: "P1", week_start: "2026-08-24", version: 1, deleted_at: null, surplus_kg_by_key: { Karkas: "6332.00" } }] });
    await answerSurplusAction({}, form({ week_start: "2026-08-24", response: "absorb", key: "RPA|Karkas" }));
    // the plan's date is on or before the data date (27 Aug): K40 closes it up to the data date
    expect(queued()).toEqual(["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"]);
    expect(processed).toHaveBeenCalledTimes(2);
  });
});

describe("R55 — only what changed, in one request", () => {
  const locked = (key: string, fresh: string, extra: MemRow = {}): MemRow => ({ id: `l-${key}`, week_start: NEXT, key, size_kg: null, fresh_kg: fresh, frozen_kg: "0", price: "30000", status: "locked", version: 1, reason: null, deleted_at: null, ...extra });
  const five = ["A", "B", "C", "D", "E"].map((k) => locked(`RPA|${k}`, "100.00"));
  // the browser's FormData with all five rows as rendered (before hydration / without scripts), row C changed
  const all = (changed: Record<number, string> = {}) => {
    const f: Record<string, string> = { week_start: NEXT, n: "5", reason: "naik permintaan" };
    ["A", "B", "C", "D", "E"].forEach((k, i) => { Object.assign(f, { [`key_${i}`]: `RPA|${k}`, [`fresh_${i}`]: changed[i] ?? "100", [`frozen_${i}`]: "0", [`price_${i}`]: "30000" }); });
    return form(f);
  };
  it("the lead changes 1 of 5 locked SKUs → exactly 1 new version, in one request", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, sales_commitment: five });
    const r = await saveCommitmentsAction({}, all({ 2: "250" }));
    expect(r.error).toBeUndefined();
    expect(r.ok).toContain("1 SKU komitmen disimpan sebagai draft (0 draft diperbarui, 1 versi baru); 4 SKU tidak berubah");
    const ups = sb.calls("sales_commitment:upsert");
    expect(ups).toHaveLength(1);
    expect(ups[0].payload).toEqual([{ week_start: NEXT, key: "RPA|C", fresh_kg: "250", frozen_kg: "0", price: "30000", reason: "naik permintaan" }]);
    expect(ups[0].options).toEqual({ onConflict: "id", defaultToNull: false });
    expect(sb.tables.sales_commitment).toHaveLength(6); // the five locked rows and exactly one new version
  });
  it("nothing changed → no request at all (no new versions)", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, sales_commitment: five });
    const r = await saveCommitmentsAction({}, all());
    expect(r.ok).toBe("Tidak ada perubahan: 5 SKU sama dengan yang tersimpan, tidak ada draft atau versi baru dibuat");
    expect(sb.log.filter((l) => l.op === "upsert" || l.op === "insert" || l.op === "update")).toEqual([]);
    expect(processed).not.toHaveBeenCalled();
  });
  it("the form sends only the changed row: the same result", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, sales_commitment: five });
    await saveCommitmentsAction({}, form({ week_start: NEXT, n: "5", reason: "naik", key_2: "RPA|C", fresh_2: "250", frozen_2: "0", price_2: "30000", fresh_0: "100", frozen_0: "0", price_0: "30000" }));
    expect((sb.calls("sales_commitment:upsert")[0].payload as MemRow[]).map((r) => r.key)).toEqual(["RPA|C"]);
  });
  it("a draft that exists is updated by its id (it keeps its reason); a new version is inserted without one; all in the same request", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, sales_commitment: [...five, locked("RPA|C", "260.00", { id: "d-C", status: "draft", version: 2, reason: "alasan lama" })] });
    await saveCommitmentsAction({}, form({ week_start: NEXT, n: "2", key_0: "RPA|C", fresh_0: "270", frozen_0: "0", price_0: "30000", key_1: "RPA|D", fresh_1: "120", frozen_1: "0", price_1: "30000", reason: "" }));
    const ups = sb.calls("sales_commitment:upsert");
    expect(ups).toHaveLength(1);
    expect(ups[0].payload).toEqual([
      { id: "d-C", week_start: NEXT, key: "RPA|C", fresh_kg: "270", frozen_kg: "0", price: "30000", reason: "alasan lama" },
      { week_start: NEXT, key: "RPA|D", fresh_kg: "120", frozen_kg: "0", price: "30000", reason: null },
    ]);
  });
  it("a row equal to the current draft is not written again; numbers compare as numbers (100 = 100,00)", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, sales_commitment: [locked("RPA|C", "260.00", { id: "d-C", status: "draft", version: 2 })] });
    const r = await saveCommitmentsAction({}, form({ week_start: NEXT, n: "1", key_0: "RPA|C", fresh_0: "260", frozen_0: "0,00", price_0: "30.000" }));
    expect(r.ok).toContain("Tidak ada perubahan");
  });
  it("the database refuses the request (a new version without a reason): the whole request failed, and the message says nothing was saved", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, sales_commitment: five }, { fail: { "sales_commitment:upsert": { message: "Komitmen sudah dikunci: versi baru wajib alasan", code: "23514" } } });
    const r = await saveCommitmentsAction({}, form({ week_start: NEXT, n: "2", key_0: "RPA|A", fresh_0: "500", frozen_0: "0", price_0: "30000", key_1: "RPA|B", fresh_1: "500", frozen_1: "0", price_1: "30000" }));
    expect(r.error).toBe("Tidak ada komitmen yang disimpan: Komitmen sudah dikunci: versi baru wajib alasan");
    expect(sb.calls("rebuild_queue:insert")).toHaveLength(0);
  });
  it("rowDirty: a row is changed when an input differs from the value it was rendered with", () => {
    expect(rowDirty([{ value: "15.000", initial: "15.000" }, { value: " 2.000 ", initial: "2.000" }])).toBe(false);
    expect(rowDirty([{ value: "15.000", initial: "15.000" }, { value: "2.500", initial: "2.000" }])).toBe(true);
    expect(rowDirty([{ value: "", initial: "" }])).toBe(false);
  });
});

describe("R56 — the surplus answer carries the SKU of the surplus row", () => {
  const plan = (surplus: Record<string, string>): MemRow => ({ id: "P1", week_start: "2026-08-24", version: 1, deleted_at: null, surplus_kg_by_key: surplus });
  const answer = (f: Record<string, string>) => answerSurplusAction({}, form({ week_start: "2026-08-24", response: "partial", absorb_kg: "50", price: "30000", ...f }));
  it("a key of the plan's surplus list is saved as sent (Trading|BLP|Frozen), with the plan's surplus kg", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, plan_week: [plan({ "Trading|BLP|Frozen": "120.00", Karkas: "6332.00" })] });
    const r = await answer({ key: "Trading|BLP|Frozen", surplus_kg: "999" });
    expect(r.error).toBeUndefined();
    expect(sb.tables.surplus_response).toHaveLength(1);
    expect(sb.tables.surplus_response[0]).toMatchObject({ plan_week_id: "P1", key: "Trading|BLP|Frozen", surplus_kg: "120.00", response: "partial", absorb_kg: "50", price: "30000" });
  });
  it("a production unit of the plan is the base key of its RPA SKU — not the old hard-coded RPA|Karkas for every answer", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, plan_week: [plan({ Karkas: "6332.00", Sayap: "40.00" })] });
    await answer({ key: "RPA|Sayap" });
    expect(sb.tables.surplus_response[0]).toMatchObject({ key: "RPA|Sayap", surplus_kg: "40.00" });
  });
  it("a key that is not in the plan's surplus list, or no key at all, is refused and nothing is written", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, plan_week: [plan({ Karkas: "6332.00" })] });
    expect((await answer({ key: "RPA|Sayap" })).error).toBe("SKU RPA|Sayap tidak ada di daftar surplus rencana");
    expect((await answer({})).error).toBe("Pilih SKU surplus yang dijawab");
    expect((await answer({ key: "RPA|Karkas|Fresh" })).error).toContain("tidak ada di daftar surplus");
    expect(sb.tables.surplus_response ?? []).toHaveLength(0);
  });
});

describe("R64 — a blank kg is not a commitment of 0", () => {
  it("fresh filled and frozen blank: nothing is written, the message names the SKU and says to type 0 when there is none", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, sales_commitment: [] });
    const r = await saveCommitmentsAction({}, form({ week_start: NEXT, n: "2", key_0: "RPA|Karkas", fresh_0: "100", frozen_0: "", key_1: "RPA|Usus", fresh_1: "50", frozen_1: "0" }));
    expect(r.error).toBe("Isi kg fresh dan kg frozen (tulis 0 bila memang tidak ada komitmen): RPA|Karkas");
    expect(sb.calls("sales_commitment:upsert")).toHaveLength(0);
    expect(sb.calls("rebuild_queue:insert")).toHaveLength(0);
  });
  it("0 typed on purpose is a commitment of 0", async () => {
    sb = memSb({ week: [WEEK], input_task_rule: rules, sales_commitment: [] });
    const r = await saveCommitmentsAction({}, form({ week_start: NEXT, n: "1", key_0: "RPA|Usus", fresh_0: "50", frozen_0: "0" }));
    expect(r.error).toBeUndefined();
    expect((sb.calls("sales_commitment:upsert")[0].payload as MemRow[])[0]).toMatchObject({ key: "RPA|Usus", fresh_kg: "50", frozen_kg: "0" });
  });
});
