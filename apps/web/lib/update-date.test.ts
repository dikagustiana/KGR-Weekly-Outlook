/** PRD v5.1 K39 (R11): an upload of journal, stock card or WP moves the update date of its open week (RPC). */
import { describe, expect, it, vi } from "vitest";
import { fakeSb } from "./fake-sb";

vi.mock("server-only", () => ({}));
const { advanceUpdateDate } = await import("./update-date");

const wk = (id: string, start: string, end: string, update: string, status = "open") => ({ id, week_start: start, week_end: end, update_date: update, tb_opening_date: start, status }) as never;
const weeks = [wk("w34", "2026-08-17", "2026-08-23", "2026-08-24", "released"), wk("w35", "2026-08-24", "2026-08-30", "2026-08-27")];

describe("advanceUpdateDate", () => {
  it("journal of 28 Aug: one call for the open week with the last date; the note names the move", async () => {
    const sb = fakeSb({ rpc: { advance_update_date: "2026-08-29" } });
    const note = await advanceUpdateDate(sb as never, weeks, ["2026-08-26", "2026-08-28", null]);
    expect(sb.rpcCalls).toEqual([{ name: "advance_update_date", args: { p_week_id: "w35", p_date: "2026-08-28" } }]);
    expect(note).toBe("tanggal update minggu 2026-08-24: 2026-08-27 → 2026-08-29");
  });
  it("dates of a released week or outside every week: no call", async () => {
    const sb = fakeSb();
    expect(await advanceUpdateDate(sb as never, weeks, ["2026-08-20", "2026-09-05"])).toBe("");
    expect(sb.rpcCalls).toEqual([]);
  });
  it("unchanged (an earlier date): no note", async () => {
    const sb = fakeSb({ rpc: { advance_update_date: "2026-08-27" } });
    expect(await advanceUpdateDate(sb as never, weeks, ["2026-08-25"])).toBe("");
  });
  it("the RPC refused: the upload message says so (K41), it is not dropped", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sb = fakeSb({ fail: { "rpc:advance_update_date": "function public.advance_update_date(uuid, date) does not exist" } });
    expect(await advanceUpdateDate(sb as never, weeks, ["2026-08-28"])).toBe("tanggal update minggu 2026-08-24 TIDAK dimajukan (function public.advance_update_date(uuid, date) does not exist)");
  });
});
