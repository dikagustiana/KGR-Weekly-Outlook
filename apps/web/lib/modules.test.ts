import { describe, expect, it } from "vitest";
import { isModuleOn, navModules, parseSetting, type ModuleSettings } from "./modules-core";

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
    expect(navModules(st, "sales", { week: "2026-08-24" }).map((n) => n.label)).toEqual(["Costing"]);
    expect(navModules({}, "admin", { week: "2026-08-24" })).toEqual([]);
  });
  it("management view lists read pages only", () => {
    const st: ModuleSettings = { m1_costing: { enabled: true } };
    expect(navModules(st, "admin", { week: "2026-08-24" }, true).map((n) => n.label)).toEqual(["Costing"]);
  });
});
