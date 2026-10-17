/**
 * PRD v5.1 R14 (K46): the lock of next week's commitments is one RPC call with the frozen prices of the form; R15: one
 * disabled rule for every input of a commitment row; R16: "Dari PPIC" says why Sales does not see it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { D, stockSummary } from "@kgr/engine";
import { fakeSb } from "../fake-sb";
import { CommitmentForm, LOCK_FORM } from "@/components/v5/CommitmentForm";
import { komersialV5Model, type KomersialV5Input } from "./komersial";

vi.mock("server-only", () => ({}));
let sb = fakeSb();
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/modules", () => ({ requireModuleAction: async () => ({ role: "commercial_lead" }) }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: async () => sb }));
const { lockCommitmentsAction } = await import("@/app/komersial/actions-v5");

afterEach(() => { sb = fakeSb(); });

const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };

describe("lockCommitmentsAction calls lock_commitments only (R14)", () => {
  it("the frozen prices of the form go as p_price_frozen; empty ones are left to the RPC (reference price)", async () => {
    sb = fakeSb({ rpc: { lock_commitments: 2 } });
    const r = await lockCommitmentsAction({}, form({ week_start: "2026-08-31", "price_frozen|RPA|Sayap": "28.000", "price_frozen|RPA|Karkas": "" }));
    expect(r.ok).toBe("2 draft komitmen dikunci bersama price list minggu depan; harga frozen dari form untuk 1 SKU");
    expect(sb.rpcCalls).toEqual([{ name: "lock_commitments", args: { p_week_start: "2026-08-31", p_price_frozen: { "RPA|Sayap": "28000" } } }]);
    // R14: no table write of its own on the commitment tables — the RPC is the one transaction (R54 queues the task date after)
    expect(sb.calls.filter((c) => c.includes("sales_commitment") || c.includes("price_list_week"))).toEqual([]);
  });
  it("the RPC refuses (a version 2 without a reason): the message, nothing else", async () => {
    sb = fakeSb({ fail: { "rpc:lock_commitments": "Versi baru setelah kunci wajib alasan: RPA|Sayap" } });
    const r = await lockCommitmentsAction({}, form({ week_start: "2026-08-31" }));
    expect(r.error).toBe("Versi baru setelah kunci wajib alasan: RPA|Sayap");
    expect(sb.calls).toEqual([]);
  });
  it("a frozen price that is not a positive number is refused before the RPC", async () => {
    const r = await lockCommitmentsAction({}, form({ week_start: "2026-08-31", "price_frozen|RPA|Sayap": "-5" }));
    expect(r.error).toBe("Harga frozen RPA|Sayap tidak valid");
    expect(sb.rpcCalls).toEqual([]);
  });
});

const noop = async () => ({});
const commitment = (canLock: boolean): KomersialV5Input["commitment"] => ({
  weekStart: "2026-08-31", weekEnd: "2026-09-06", deadline: "Jum 28/08 17.00", canEdit: true, canLock, priceListLocked: false,
  rows: [
    { key: "RPA|Karkas", thisWeekKg: D("17346"), fresh: "15000", frozen: "2000", price: "36705", status: "locked", version: 1, priceFrozen: "31658", priceFrozenSource: "sku_price", listLocked: true },
    { key: "RPA|Sayap", thisWeekKg: D("900"), fresh: "800", frozen: null, price: "30000", status: "draft", version: 2, priceFrozen: null, priceFrozenSource: null, listLocked: false },
  ],
});
const inputs = (html: string) => [...html.matchAll(/<input ([^>]*)\/?>/g)].map((m) => m[1]).filter((a) => !a.includes('type="hidden"'));
const disabled = (html: string, name: string) => inputs(html).find((a) => a.includes(`name="${name}"`))!.includes("disabled");

describe("one disabled rule per row (R15)", () => {
  it("Sales: a locked row has every input off; a draft row keeps fresh, frozen and price; the frozen price is the lead's", () => {
    const h = renderToStaticMarkup(<CommitmentForm c={commitment(false)} save={noop} lock={noop} />);
    expect(["fresh_0", "frozen_0", "price_0", "price_frozen|RPA|Karkas"].map((n) => disabled(h, n))).toEqual([true, true, true, true]);
    expect(["fresh_1", "frozen_1", "price_1", "price_frozen|RPA|Sayap"].map((n) => disabled(h, n))).toEqual([false, false, false, true]);
    expect(h).toContain("Dikunci Kepala Sales.");
  });
  it("Kepala Sales: every input on, except the frozen price of a price list row already locked; the frozen price belongs to the lock form", () => {
    const h = renderToStaticMarkup(<CommitmentForm c={commitment(true)} save={noop} lock={noop} />);
    expect(["fresh_0", "frozen_0", "price_0", "price_frozen|RPA|Karkas"].map((n) => disabled(h, n))).toEqual([false, false, false, true]);
    expect(disabled(h, "price_frozen|RPA|Sayap")).toBe(false);
    expect(inputs(h).find((a) => a.includes('name="price_frozen|RPA|Sayap"'))).toContain(`form="${LOCK_FORM}"`);
    expect(h).toContain(`id="${LOCK_FORM}"`);
  });
});

describe("table and Sales text (R14, R16)", () => {
  const base = {
    today: "2026-08-27", spotToday: true, roleLabel: "Kepala Sales", sales: false, base: "/komersial", filter: "all", stockDate: "2026-08-26", rows: [], summary: stockSummary([]),
    holdingRate: D(0), approvalsWaiting: 0, cutOffTime: "14.00", commitment: commitment(true), ppic: null, spot: [], controls: [],
  } as unknown as KomersialV5Input;
  const text = (m: ReturnType<typeof komersialV5Model>, id: string) => renderToStaticMarkup(<>{JSON.stringify(m.tiles.find((t) => t.id === id))}</>);
  it("the frozen price of the price list with its source", () => {
    expect(text(komersialV5Model(base), "t-komitmen")).toContain("31.658 (acuan)");
  });
  it("Sales: 'Tidak ditampilkan untuk Sales (data perencanaan)', not 'Belum ada rencana PPIC'", () => {
    const s = text(komersialV5Model({ ...base, sales: true, roleLabel: "Sales" }), "t-ppic");
    expect(s).toContain("Tidak ditampilkan untuk Sales (data perencanaan).");
    expect(s).not.toContain("Belum ada rencana PPIC");
    expect(text(komersialV5Model(base), "t-ppic")).toContain("Belum ada rencana PPIC minggu ini.");
  });
});
