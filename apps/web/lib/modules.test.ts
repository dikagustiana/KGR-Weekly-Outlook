import { describe, expect, it } from "vitest";
import { anyModuleOn, isModuleOn, navModules, parseSetting, type ModuleSettings } from "./modules-core";

describe("module flags (PRD v3 rule 5)", () => {
  it("missing or malformed flag is off", () => {
    expect(isModuleOn(undefined, "admin")).toBe(false);
    expect(isModuleOn(parseSetting(null), "admin")).toBe(false);
    expect(isModuleOn(parseSetting({ enabled: "true" }), "admin")).toBe(false);
  });
  it("enabled without roles = every role; with roles = only those", () => {
    expect(isModuleOn(parseSetting({ enabled: true }), "sales")).toBe(true);
    const s = parseSetting({ enabled: true, roles: ["admin", "cost_accounting"] });
    expect(isModuleOn(s, "admin")).toBe(true);
    expect(isModuleOn(s, "cost_accounting")).toBe(true);
    expect(isModuleOn(s, "sales")).toBe(false);
  });
  it("nav shows only modules that are on and allowed for the role", () => {
    const st: ModuleSettings = { m1_costing: { enabled: true }, m6_cash: { enabled: false } };
    const admin = navModules(st, "admin", { week: "2026-08-24" });
    expect(admin.map((n) => n.label)).toEqual(["Costing", "Input costing"]);
    expect(navModules(st, "finance", { week: "2026-08-24" }).map((n) => n.label)).toEqual(["Costing"]);
    // cost per batch is finance detail (PRD v3 Q17): sales gets no costing page
    expect(navModules(st, "sales", { week: "2026-08-24" })).toEqual([]);
    expect(navModules({}, "admin", { week: "2026-08-24" })).toEqual([]);
  });
  it("no module on (or no app_setting table) = no rebuild work, so v1 uploads skip the v3 queue", () => {
    expect(anyModuleOn({})).toBe(false);
    expect(anyModuleOn({ m1_costing: { enabled: false }, m7_approval: { enabled: false } })).toBe(false);
    expect(anyModuleOn({ m6_cash: { enabled: true, roles: ["finance"] } })).toBe(true);
  });
  it("management view lists read pages only", () => {
    const st: ModuleSettings = { m1_costing: { enabled: true } };
    expect(navModules(st, "admin", { week: "2026-08-24" }, true).map((n) => n.label)).toEqual(["Costing"]);
  });
});

describe("rebuild mode (PRD v4 S1: only the server's service role writes the data mart)", () => {
  it("no module on = skip; module on without the server key = no_key (queue waits); with the key = run", async () => {
    const { rebuildMode } = await import("./modules-core");
    expect(rebuildMode({}, false)).toBe("skip");
    expect(rebuildMode({}, true)).toBe("skip");
    expect(rebuildMode({ m2_ledger: { enabled: true } }, false)).toBe("no_key");
    expect(rebuildMode({ m2_ledger: { enabled: true } }, true)).toBe("run");
  });
});
