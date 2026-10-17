/** PRD v5.2-A R68 (T15): the pure FS reconciliation and its C59 control. */
import { describe, expect, it } from "vitest";
import { D } from "../src/decimal";
import { fsRecon } from "../src/fs-recon";

describe("fsRecon (R68)", () => {
  const app = [
    { key: "PL b.12", amount: "5039854" }, { key: "PL b.51", amount: "-953903" }, { key: "BS b.14", amount: "103000" },
  ];
  const fs = [
    { key: "PL b.12", amount: "5039854" }, { key: "PL b.51", amount: "-910100" }, { key: "BS b.77", amount: "702600" },
  ];
  it("sama / beda / tidak ada, and C59 GAGAL on a diff beyond tolerance", () => {
    const r = fsRecon({ app, fs, map: [["PL b.12", "PL b.12"], ["PL b.51", "PL b.51"], ["BS b.14", "BS b.14"]] });
    const by = Object.fromEntries(r.lines.map((l) => [l.key, l]));
    expect(by["PL b.12"].status).toBe("sama");
    expect(by["PL b.51"].status).toBe("beda");
    expect(by["BS b.14"].status).toBe("tidak ada di FS");
    expect(by["PL b.51"].selisih!.toFixed(0)).toBe("-43803");
    expect(r.c59.status).toBe("GAGAL");
    expect(r.c59.detail[0]).toContain("PL b.51");
  });
  it("C59 LULUS when every pair is within the tolerance", () => {
    const r = fsRecon({ app: app.slice(0, 2), fs: [{ key: "PL b.12", amount: "5039854" }, { key: "PL b.51", amount: "-953903" }], map: [["PL b.12", "PL b.12"], ["PL b.51", "PL b.51"]] });
    expect(r.c59.status).toBe("LULUS");
    expect(r.lines.every((l) => l.status === "sama")).toBe(true);
  });
  it("an unmapped FS line is 'tidak ada di app'", () => {
    const r = fsRecon({ app, fs, map: [["PL b.12", "PL b.12"]] });
    expect(r.lines.find((l) => l.key === "BS b.77")?.status).toBe("tidak ada di app");
    expect(D(r.lines.find((l) => l.key === "BS b.77")!.fs!).toFixed(0)).toBe("702600");
  });
});
