import { describe, expect, it } from "vitest";
import { canToggleView, parseViewMode, viewModeFor } from "./view";
import type { Role } from "./roles";

const PREPARERS: Role[] = ["admin", "inventory_accounting", "finance", "sales", "ppic", "purchasing"];

describe("view mode (Management View v2 R1)", () => {
  it("management always gets the management view, whatever the cookie says", () => {
    expect(canToggleView("management")).toBe(false);
    expect(viewModeFor("management", undefined)).toBe("management");
    expect(viewModeFor("management", "preparer")).toBe("management");
  });
  it("PRD v5 §5.3: the operations director reads like management (no preparer view)", () => {
    expect(canToggleView("operations_director")).toBe(false);
    expect(viewModeFor("operations_director", "preparer")).toBe("management");
  });
  it("preparer roles default to the preparer view and can switch to the management view and back", () => {
    for (const r of PREPARERS) {
      expect(canToggleView(r)).toBe(true);
      expect(viewModeFor(r, undefined)).toBe("preparer");
      expect(viewModeFor(r, "management")).toBe("management");
      expect(viewModeFor(r, "preparer")).toBe("preparer");
      expect(viewModeFor(r, "anything-else")).toBe("preparer");
    }
  });
  it("only the two modes are accepted from a form", () => {
    expect(parseViewMode("management")).toBe("management");
    expect(parseViewMode("preparer")).toBe("preparer");
    expect(parseViewMode("admin")).toBeNull();
    expect(parseViewMode(null)).toBeNull();
  });
});
