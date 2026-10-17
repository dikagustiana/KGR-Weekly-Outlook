import { describe, expect, it } from "vitest";
import { ROLES } from "../roles";
import { MINGGU_INI_ROLES, NAV_MAX, mingguIniAllowed, v4Home, v4Nav, v4On } from "./nav";

const ctx = { week: "2026-08-24", month: "2026-08", today: "2026-08-27" };
const allOn = Object.fromEntries(["m1_costing", "m2_ledger", "m3_planning", "m4_monthly", "m5_drivers", "m6_cash", "m7_commercial", "m7_approval", "v4_design"].map((k) => [k, { enabled: true }]));

describe("v4 navigation per role (PRD v4 §5.4)", () => {
  it("at most 7 items for every role, with every module on", () => {
    for (const r of ROLES) expect(v4Nav(r, allOn, ctx).length, r).toBeLessThanOrEqual(NAV_MAX);
  });
  it("management: Minggu ini · Outlook bulan · Kas & solvabilitas · Stok · Komersial · Rilis; home = Minggu ini", () => {
    expect(v4Nav("management", allOn, ctx).map((n) => n.label)).toEqual(["Minggu ini", "Outlook bulan", "Kas & solvabilitas", "Stok", "Komersial", "Rilis"]);
    expect(v4Home("management", allOn, ctx)).toBe("/minggu-ini/2026-08-24");
  });
  it("module off = item not rendered (not 'tidak tersedia'); stock falls back to the weekly stock page", () => {
    const nav = v4Nav("management", { v4_design: { enabled: true } }, ctx);
    expect(nav.map((n) => n.label)).toEqual(["Minggu ini", "Stok", "Rilis"]);
    expect(nav.find((n) => n.id === "stok")?.href).toBe("/w/2026-08-24/stok");
  });
  it("PPIC starts at Rencana, finance at Outlook bulan, sales at Komersial", () => {
    expect(v4Home("ppic", allOn, ctx)).toBe("/w/2026-08-24/rencana");
    expect(v4Home("finance", allOn, ctx)).toBe("/m/2026-08");
    expect(v4Home("sales", allOn, ctx)).toBe("/komersial");
  });
  it("sales sees no approval queue; the flag is per role", () => {
    expect(v4Nav("sales", allOn, ctx).map((n) => n.id)).not.toContain("approval");
    expect(v4On({ v4_design: { enabled: true, roles: ["management"] } }, "management")).toBe(true);
    expect(v4On({ v4_design: { enabled: true, roles: ["management"] } }, "ppic")).toBe(false);
    expect(v4On({}, "admin")).toBe(false);
  });
});

describe("v5/5: Input (flag v5_input)", () => {
  const v5 = { ...allOn, v5_input: { enabled: true } };
  it("PRD v5.1 R35: Input has its own item; the v4 wizard Upload stays next to it; at most 7 items; off = Upload as before", () => {
    for (const r of ROLES) expect(v4Nav(r, v5, ctx).length, r).toBeLessThanOrEqual(NAV_MAX);
    expect(v4Nav("cost_accounting", v5, ctx).map((n) => [n.label, n.href])).toEqual([["Costing", "/w/2026-08-24/costing"], ["Kontrol costing", "/w/2026-08-24/kontrol"], ["Input", "/input"], ["Upload", "/w/2026-08-24/upload"]]);
    expect(v4Nav("inventory_accounting", v5, ctx).map((n) => n.id)).toEqual(expect.arrayContaining(["input", "upload"]));
    expect(v4Nav("sales", v5, ctx).map((n) => n.id)).toEqual(expect.arrayContaining(["input", "upload"]));
    expect(v4Nav("ppic", v5, ctx).map((n) => n.id)).toEqual(expect.arrayContaining(["input", "upload"]));
    // R77 (A-UI-19, Q-v5.1-25): the v4 wizard leaves the Finance nav — 7 items with Input, and no Upload in any flag state
    expect(v4Nav("finance", v5, ctx).map((n) => n.label)).toEqual(["Outlook bulan", "Biaya tetap & driver", "Tutup buku", "Kas", "Rilis", "Kontrol", "Input"]);
    expect(v4Nav("finance", allOn, ctx).map((n) => n.id)).not.toContain("upload");
    expect(v4Nav("management", v5, ctx).map((n) => n.label).pop()).toBe("Input");
    expect(v4Nav("operations_director", v5, ctx).map((n) => n.label).pop()).toBe("Input");
  });
  it("PRD v5.1 K48: Minggu ini opens for admin, management, operations director and finance only; no other role links to it", () => {
    expect(ROLES.filter(mingguIniAllowed)).toEqual(expect.arrayContaining([...MINGGU_INI_ROLES]));
    expect(ROLES.filter(mingguIniAllowed).length).toBe(MINGGU_INI_ROLES.length);
    for (const r of ["sales", "commercial_lead", "ppic", "purchasing", "inventory_accounting", "cost_accounting"] as const) expect(mingguIniAllowed(r), r).toBe(false);
    for (const r of ROLES) if (!mingguIniAllowed(r)) expect(v4Nav(r, allOn, ctx).map((n) => n.id), r).not.toContain("minggu-ini");
  });
});
