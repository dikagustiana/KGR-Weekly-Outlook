/**
 * PRD v5.1 R20 (K52) and R21 on the cash and month pages: the months to negative equity rest on NIBT after fixed costs
 * (August −7,8 jt), an unknown NIBT reads "belum ada" (not "laba"), and a day without any bank balance is no cash
 * position on Outlook bulan ("belum diisi", never Rp 0).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { D, solvency } from "@kgr/engine";
import { kasFixtureProjection, outlookBulanFixture } from "../../test-support/month-fixture";
import { fakeSb } from "../fake-sb";
import { kasModel } from "./kas";
import { monthsToNegative, type TileModel } from "./minggu-ini";
import { outlookBulanModel } from "./outlook-bulan";
import { TilePage } from "@/components/v4/TilePage";

vi.mock("server-only", () => ({}));
const { loadOutlookBulan } = await import("./outlook-bulan-data");

const values = (t: TileModel | undefined) => renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
// NIBT after fixed costs of August (pl-v5.test.ts K52: plTotalsV5 on the mart rows with fixed_estimate)
const NIBT_AFTER_AUG = "-7837813.32";

describe("R20 / K52: months to negative equity", () => {
  const base = kasFixtureProjection();
  const sv = solvency({ equity: base.solvency!.equity, paidInCapital: base.solvency!.paidIn, affiliatePayable: 0, affiliateReceivable: 0, nibtMonth: NIBT_AFTER_AUG });
  it("August on NIBT after fixed costs −7,8 jt: equity 1.612,6 jt ÷ 7,8 jt = 205,75 months (card 205,8)", () => {
    const months = sv.months_to_negative_equity!;
    expect(D(base.solvency!.equity).div(1e6).toFixed(1)).toBe("1612.6");
    expect(months.toFixed(2)).toBe(D(base.solvency!.equity).div(D(NIBT_AFTER_AUG).neg()).toFixed(2));
    expect(months.toFixed(2)).toBe("205.75");
    // the mart keeps 2 decimals; the card rounds that to 1
    const m = kasModel({ ...base, solvency: { ...base.solvency!, months: months.toFixed(2), basis: sv.basis_nibt!.toFixed(2) } });
    expect(values(m.tiles.find((t) => t.id === "c-bulan-negatif"))).toContain("205,8");
  });
  it("NIBT unknown (no fixed nominal): 'belum ada', not 'tidak berlaku (laba)'", () => {
    const m = kasModel({ ...base, solvency: { ...base.solvency!, months: null, basis: null } });
    const v = values(m.tiles.find((t) => t.id === "c-bulan-negatif"));
    expect(v).toContain("belum ada (NIBT bulan ini belum bisa dihitung)");
    expect(v).not.toContain("laba");
  });
  it("profit: 'tidak berlaku (laba)'; the v4 inputs without a basis read as before", () => {
    expect(monthsToNegative(null, "79200000.00")).toBe("tidak berlaku (laba)");
    expect(monthsToNegative(null, undefined)).toBe("tidak berlaku (laba)");
    expect(monthsToNegative("89.64", "-7837813.32")).toBe("89,6");
  });
});

describe("R21: Outlook bulan reads a cash position only from a day with a bank balance", () => {
  const settings = { m6_cash: { enabled: true, roles: null } };
  const sv = { month: "2026-08-01", equity: "702600000", paid_in_capital: "5000000000", affiliate_payable: "0", months_to_negative_equity: null, basis_nibt: null };
  it("no day with a balance: Kas 'belum diisi' (the query filters accounts > 0)", async () => {
    const sb = fakeSb({ rows: { solvency_monthly: [sv], cash_position_daily: [] } });
    const { input } = await loadOutlookBulan(sb as never, { first: "2026-08-01", today: "2026-08-27", role: "finance", settings, selected: null });
    expect(sb.calls).toContain("cash_position_daily:gt");
    expect(input.solvency?.cash).toBeNull();
    const m = outlookBulanModel({ ...outlookBulanFixture(), solvency: input.solvency });
    const v = values(m.tiles.find((t) => t.id === "solvabilitas"));
    expect(v).toContain("Kas belum diisi");
    expect(v).toContain("Bulan sampai ekuitas negatif belum ada (NIBT bulan ini belum bisa dihitung)");
  });
  it("a day with a balance: its closing", async () => {
    const sb = fakeSb({ rows: { solvency_monthly: [sv], cash_position_daily: [{ date: "2026-08-26", total_closing: "1289251345.68" }] } });
    const { input } = await loadOutlookBulan(sb as never, { first: "2026-08-01", today: "2026-08-27", role: "finance", settings, selected: null });
    expect(input.solvency?.cash).toBe("1289251345.68");
  });
});
