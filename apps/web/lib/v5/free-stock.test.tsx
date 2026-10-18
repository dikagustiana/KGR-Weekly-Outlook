/**
 * PRD v5.2 O16 (decided 17 Okt 2026, PRD v5 §4.6): the free stock of Commercial is less the locked commitments of next week that no PO line
 * covers yet. The arithmetic (partial PO coverage, no locked commitment, a commitment the stock cannot carry, one locked version per SKU),
 * the note with both numbers, missing as "belum ada" (R64), and the loader of the Commercial screen on an in-memory database. vitest only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { D, stockSummary, type Commitment } from "@kgr/engine";
import { memSb, type MemRow, type MemSb } from "../../test-support/mem-sb";
import { freeStockNote, netFreeKg, reserveForCommitments } from "./free-stock";
import { komersialV5Model } from "./komersial";
import { loopLines, type LoopFacts } from "./management";
import { TilePage } from "@/components/v4/TilePage";

vi.mock("server-only", () => ({}));
const { loadKomersialV5 } = await import("./komersial-data");

const NEXT = "2026-08-31";
const lock = (key: string, fresh: number, frozen: number, version = 1, status: Commitment["status"] = "locked"): Commitment => ({ key, fresh_kg: fresh, frozen_kg: frozen, price: null, status, version });
const free = [{ key: "RPA|Karkas|Fresh", kg: 20000 }, { key: "RPA|Karkas|Frozen", kg: 5000 }, { key: "RPA|Ceker|Fresh", kg: 300 }];
const run = (commitments: Commitment[], orders: { key: string; kg: number | null }[] = [], f = free) => reserveForCommitments({ free: f, commitments, orders, weekStart: NEXT });
const k = (r: ReturnType<typeof run>) => [r.grossKg, r.deductedKg, r.netKg, r.shortKg].map((v) => v.toString());

describe("O16: the arithmetic", () => {
  it("no commitment, or only drafts: nothing is taken off, and the note says so", () => {
    for (const r of [run([]), run([lock("RPA|Karkas", 15000, 2000, 1, "draft")])]) {
      expect(k(r)).toEqual(["25300", "0", "25300", "0"]);
      expect(r.lockedSkus).toBe(0);
      expect(freeStockNote(r)).toBe("Tidak ada komitmen terkunci minggu depan; stok bebas tidak dikurangi.");
    }
  });
  it("locked 15.000 fresh + 2.000 frozen, no PO yet: 17.000 off (fresh from the fresh row, frozen from the frozen row)", () => {
    const r = run([lock("RPA|Karkas", 15000, 2000)]);
    expect(k(r)).toEqual(["25300", "17000", "8300", "0"]);
    expect([...r.byKey].map(([key, v]) => [key, v.uncovered.toString(), v.deducted.toString()])).toEqual([["RPA|Karkas|Fresh", "15000", "15000"], ["RPA|Karkas|Frozen", "2000", "2000"]]);
    expect(netFreeKg(r, "RPA|Karkas|Fresh", 20000).toString()).toBe("5000");
    expect(netFreeKg(r, "RPA|Karkas|Frozen", 5000).toString()).toBe("3000");
    expect(netFreeKg(r, "RPA|Ceker|Fresh", 300).toString()).toBe("300");
    expect(freeStockNote(r)).toBe("Stok bebas 25.300 kg dikurangi komitmen terkunci minggu depan yang belum tertutup PO 17.000 kg = 8.300 kg.");
  });
  it("partial PO coverage: only what the POs of the week do not cover is taken off (6.000 of the 15.000 fresh are covered)", () => {
    const r = run([lock("RPA|Karkas", 15000, 2000)], [{ key: "RPA|Karkas|Fresh", kg: 4000 }, { key: "RPA|Karkas|Fresh", kg: 2000 }]);
    expect(k(r)).toEqual(["25300", "11000", "14300", "0"]);
    expect(r.byKey.get("RPA|Karkas|Fresh")!.uncovered.toString()).toBe("9000");
    expect(r.byKey.get("RPA|Karkas|Frozen")!.uncovered.toString()).toBe("2000");
    expect(freeStockNote(r)).toBe("Stok bebas 25.300 kg dikurangi komitmen terkunci minggu depan yang belum tertutup PO 11.000 kg = 14.300 kg.");
  });
  it("fully covered by POs (or more): nothing is taken off; the PO of another form does not cover", () => {
    const covered = run([lock("RPA|Karkas", 15000, 2000)], [{ key: "RPA|Karkas|Fresh", kg: 15000 }, { key: "RPA|Karkas|Frozen", kg: 2500 }]);
    expect(k(covered)).toEqual(["25300", "0", "25300", "0"]);
    expect(freeStockNote(covered)).toBe("Komitmen terkunci minggu depan (1 SKU) sudah tertutup PO; stok bebas tidak dikurangi.");
    const otherForm = run([lock("RPA|Karkas", 0, 2000)], [{ key: "RPA|Karkas|Fresh", kg: 9000 }]);
    expect(otherForm.deductedKg.toString()).toBe("2000");
  });
  it("a commitment larger than the free stock of its SKU: the stock goes to 0, the rest is production need (short), never a negative stock", () => {
    const r = run([lock("RPA|Karkas", 26000, 0)]);
    expect(k(r)).toEqual(["25300", "20000", "5300", "6000"]);
    expect(netFreeKg(r, "RPA|Karkas|Fresh", 20000).toString()).toBe("0");
    expect(freeStockNote(r)).toBe("Stok bebas 25.300 kg dikurangi komitmen terkunci minggu depan yang belum tertutup PO 20.000 kg = 5.300 kg. 6.000 kg komitmen melebihi stok bebas SKU-nya: itu kebutuhan produksi, bukan stok.");
  });
  it("a locked SKU without any free stock: nothing to take off, all of it is short", () => {
    const r = run([lock("RPA|Karkas", 3000, 0)], [], [{ key: "RPA|Ceker|Fresh", kg: 300 }]);
    expect(k(r)).toEqual(["300", "0", "300", "3000"]);
    expect(freeStockNote(r)).toContain("tidak punya stok bebas di SKU-nya");
  });
  it("one locked version per SKU counts (the highest), as K26/K46: v1 10.000 and v2 12.000 are 12.000, not 22.000", () => {
    const r = run([lock("RPA|Karkas", 10000, 0, 1), lock("RPA|Karkas", 12000, 0, 2)]);
    expect(r.deductedKg.toString()).toBe("12000");
    expect(r.lockedSkus).toBe(1);
  });
  it("a PO line without kg covers nothing and is not counted as 0: it is named in the note", () => {
    const r = run([lock("RPA|Karkas", 15000, 0)], [{ key: "RPA|Karkas|Fresh", kg: null }]);
    expect(r.deductedKg.toString()).toBe("15000");
    expect(r.poWithoutKg).toBe(1);
    expect(freeStockNote(r)).toBe("Stok bebas 25.300 kg dikurangi komitmen terkunci minggu depan yang belum tertutup PO 15.000 kg = 10.300 kg. 1 baris PO minggu depan tanpa kg tidak dihitung menutup komitmen.");
  });
  it("the viewer's scope (Sales: assigned SKUs) limits which commitments count", () => {
    const both = [lock("RPA|Karkas", 1000, 0), lock("RPA|Ceker", 200, 0)];
    expect(reserveForCommitments({ free, commitments: both, orders: [], weekStart: NEXT, inScope: (b) => b === "RPA|Ceker" }).deductedKg.toString()).toBe("200");
  });
  it("not known (could not be read): 'belum ada', and the stock is as it is", () => {
    expect(freeStockNote(null)).toBe("Komitmen terkunci minggu depan: belum ada (belum bisa dibaca), jadi stok bebas belum dikurangi.");
    expect(netFreeKg(null, "RPA|Karkas|Fresh", 20000).toString()).toBe("20000");
  });
});

describe("O16: the Commercial screen", () => {
  const tiles = (r: ReturnType<typeof run> | null | undefined) => komersialV5Model({
    today: "2026-08-27", spotToday: true, roleLabel: "Kepala Sales", sales: false, base: "/komersial", filter: "all", stockDate: "2026-08-27", rows: [], summary: stockSummary([]), holdingRate: null, approvalsWaiting: 0, cutOffTime: "14.00",
    commitment: { weekStart: NEXT, weekEnd: "2026-09-06", deadline: "Jum 28/08 17.00", rows: [], canEdit: true, canLock: true, priceListLocked: false }, ppic: null, spot: [], controls: [], freeStock: r,
  } as never).tiles;
  const note = (r: ReturnType<typeof run> | null | undefined) => tiles(r).find((t) => t.id === "c-stok")!.note;
  it("the card 'Stok bebas belum ke PO' carries the subtraction with both numbers in its note", () => {
    expect(note(run([lock("RPA|Karkas", 15000, 2000)], [{ key: "RPA|Karkas|Fresh", kg: 6000 }]))).toBe("Stok bebas 25.300 kg dikurangi komitmen terkunci minggu depan yang belum tertutup PO 11.000 kg = 14.300 kg.");
    const html = renderToStaticMarkup(<TilePage tiles={tiles(run([lock("RPA|Karkas", 15000, 2000)]))} label="x" />);
    expect(html).toContain("dikurangi komitmen terkunci minggu depan yang belum tertutup PO 17.000 kg = 8.300 kg");
  });
  it("without locked commitments the note says so; unknown is 'belum ada'; not applicable (undefined) has no note", () => {
    expect(note(run([]))).toBe("Tidak ada komitmen terkunci minggu depan; stok bebas tidak dikurangi.");
    expect(note(null)).toMatch(/^Komitmen terkunci minggu depan: belum ada/);
    expect(note(undefined)).toBeUndefined();
  });
});

describe("O16: the loader of the Commercial screen (Sales session, in-memory database)", () => {
  let sb: MemSb = memSb();
  beforeAll(() => { process.env.KGR_TEST_NOW = "2026-08-27T09:00:00+07:00"; });
  afterEach(() => { sb = memSb(); });
  const WEEK = { id: "w1", week_start: "2026-08-24", week_end: "2026-08-30", update_date: "2026-08-27", tb_opening_date: "2026-08-23", status: "open" };
  const mart = (key: string, form: string, fresh: string, frozen: string): MemRow => ({
    date: "2026-08-27", key, form, free_fresh_kg: fresh, free_frozen_kg: frozen, oldest_age_days: 1, urgency: "aman", rank: 1, ordered_today_kg: "0", cost_per_kg_ma: "30000", price_list: "36000",
  });
  const seed = (extra: Record<string, MemRow[]> = {}): Record<string, MemRow[]> => ({
    week: [WEEK], parameter: [{ week_id: "w1", sales_sees_cost: true, cut_off_time: "14:00", commitment_lock_dow: 5, commitment_lock_time: "17:00" }],
    sales_assignment: [{ email: "sales@x.test", key: "RPA|Karkas", active: true }],
    commercial_daily_sales: [mart("RPA|Karkas|Fresh", "Fresh", "20000", "0"), mart("RPA|Karkas|Frozen", "Frozen", "0", "5000")],
    item_map: [{ item_code: "JLB0922", key: "RPA|Karkas|Fresh", deleted_at: null }],
    sales_commitment: [{ week_start: NEXT, key: "RPA|Karkas", size_kg: null, fresh_kg: "15000", frozen_kg: "2000", price: "36000", status: "locked", version: 1, deleted_at: null }],
    sales_line: [
      { item_code: "JLB0922", key_manual: null, kg: "6000", status: "Order", demand_status: "Confirmed", delivery_date: "2026-09-01", date: "2026-09-01", deleted_at: null, superseded_at: null },
      { item_code: "JLB0922", key_manual: null, kg: "9999", status: "Order", demand_status: "Tentative", delivery_date: "2026-09-02", date: "2026-09-02", deleted_at: null, superseded_at: null },
      { item_code: "JLB0922", key_manual: null, kg: "7777", status: "Order", demand_status: "Confirmed", delivery_date: "2026-09-09", date: "2026-09-09", deleted_at: null, superseded_at: null },
    ],
    ...extra,
  });
  const viewer = { email: "sales@x.test", role: "sales", fullName: null } as never;

  it("the stock rows are net: 20.000 fresh − (15.000 − 6.000 confirmed PO) = 11.000; frozen 5.000 − 2.000 = 3.000; the tentative PO and the PO of the week after do not cover", async () => {
    sb = memSb(seed());
    const input = await loadKomersialV5(sb as never, viewer, "all");
    expect(input.failed ?? {}).toEqual({});
    expect(input.rows.map((r) => [r.key, r.free_kg.toString()])).toEqual([["RPA|Karkas|Fresh", "11000"], ["RPA|Karkas|Frozen", "3000"]]);
    expect(input.summary.kg.toString()).toBe("14000");
    expect(input.freeStock).toMatchObject({ lockedSkus: 1 });
    expect(input.freeStock!.grossKg.toString()).toBe("25000");
    expect(input.freeStock!.deductedKg.toString()).toBe("11000");
    expect(freeStockNote(input.freeStock!)).toBe("Stok bebas 25.000 kg dikurangi komitmen terkunci minggu depan yang belum tertutup PO 11.000 kg = 14.000 kg.");
    // it asks for next week's commitments and PO lines of next week only
    expect(sb.log.some((l) => l.table === "sales_commitment" && l.filters.includes(`eq week_start ${NEXT}`))).toBe(true);
  });
  it("no locked commitment (a draft only): the rows are the stock as it is", async () => {
    sb = memSb(seed({ sales_commitment: [{ week_start: NEXT, key: "RPA|Karkas", size_kg: null, fresh_kg: "15000", frozen_kg: "2000", price: null, status: "draft", version: 1, deleted_at: null }] }));
    const input = await loadKomersialV5(sb as never, viewer, "all");
    expect(input.rows.map((r) => r.free_kg.toString())).toEqual(["20000", "5000"]);
    expect(freeStockNote(input.freeStock!)).toBe("Tidak ada komitmen terkunci minggu depan; stok bebas tidak dikurangi.");
  });
  it("the commitments cannot be read: every stock tile says so (K41), nothing is shown as if no commitment existed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sb = memSb(seed(), { fail: { sales_commitment: "permission denied for table sales_commitment" } });
    const input = await loadKomersialV5(sb as never, viewer, "all");
    for (const id of ["headline", "c-stok", "t-ranking", "t-spot", "t-komitmen"]) expect(input.failed?.[id], id).toContain("sales_commitment");
    expect(input.freeStock).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("O16: the same number on the Manajemen status line", () => {
  const base: LoopFacts = { commitment: { locked: true, drafts: 0, deadline: "Jum 28/08 17.00", late: false }, planNext: { version: null }, costing: { sementara: 0, final: 0, wpLate: [] }, lb: { cutDate: "2026-08-28", price: null }, freeStock: null };
  it("names what was taken off for locked commitments; unchanged when nothing was", () => {
    const line = (fs: LoopFacts["freeStock"]) => loopLines({ ...base, freeStock: fs }).find((l) => l.label === "Stok bebas belum ke PO")!.value;
    expect(line({ kg: D(14000), value: D("420000000"), reservedKg: D(11000) })).toBe("14.000 kg · Rp 420,0 jt · setelah komitmen terkunci 11.000 kg");
    expect(line({ kg: D(25000), value: D("750000000") })).toBe("25.000 kg · Rp 750,0 jt");
    expect(line({ kg: D(25000), value: D("750000000"), reservedKg: D(0) })).toBe("25.000 kg · Rp 750,0 jt");
  });
});
