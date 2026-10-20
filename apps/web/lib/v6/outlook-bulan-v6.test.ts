import { describe, expect, it } from "vitest";
import { outlookBulanV6 } from "./outlook-bulan-v6";
import type { TileModel } from "../v4/minggu-ini";

const card = (id: string, value: string | null, compare: { label: string; value: string }[]): TileModel => ({ id, pos: { x: 0, y: 0, w: 2, h: 2 }, kind: "card", title: id, content: { type: "card", value, unit: "Rp jt", compare } });

describe("Outlook bulan v6 (R158)", () => {
  it("GP is the number, revenue and NIBT compare; no vs Budget without a budget", () => {
    const t = outlookBulanV6([
      card("c-outlook", "7.764,1", [{ label: "rentang", value: "7.700–7.800" }, { label: "GP P&L", value: "296,4 jt (3,8%)" }, { label: "NIBT jurnal", value: "79,2 jt" }]),
      card("c-budget", null, []),
    ]);
    expect(t.map((x) => x.id)).toEqual(["c-outlook"]);
    const c = t[0].content;
    expect(c.type === "card" && c.value).toBe("296,4");
    expect(c.type === "card" && c.compare.map((x) => x.label)).toEqual(["GP %", "Revenue", "rentang", "NIBT jurnal"]);
  });
});
