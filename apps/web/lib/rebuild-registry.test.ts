/** R45 (K60): builders run in topological order (`after`), independent of import order; a cycle errors at startup. */
import { describe, expect, it } from "vitest";
import { BUILDERS, orderedBuilders, registerBuilder } from "./rebuild-registry";

const noop = async () => "ok";

describe("orderedBuilders (R45 K60)", () => {
  it("cash (m6_cash) runs after the m4_monthly builders, whatever the registration order", () => {
    BUILDERS.length = 0;
    // registered in reverse order of dependency
    registerBuilder({ module: "m6_cash", name: "cash", after: ["m4_monthly"], build: noop });
    registerBuilder({ module: "m4_monthly", name: "monthly v4", build: noop });
    registerBuilder({ module: "m4_monthly", name: "accuracy v4", build: noop });
    const names = orderedBuilders().map((b) => b.name);
    expect(names.indexOf("monthly v4")).toBeLessThan(names.indexOf("cash"));
    expect(names.indexOf("accuracy v4")).toBeLessThan(names.indexOf("cash"));
  });
  it("a cycle is an error at startup", () => {
    BUILDERS.length = 0;
    registerBuilder({ module: "m6_cash", name: "cash", after: ["m4_monthly"], build: noop });
    registerBuilder({ module: "m4_monthly", name: "monthly v4", after: ["m6_cash"], build: noop });
    expect(() => orderedBuilders()).toThrow(/siklus/);
  });
});
