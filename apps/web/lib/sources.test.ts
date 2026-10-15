import { describe, expect, it } from "vitest";
import { humanize } from "./sources";

describe("humanize (Management View v2 R5)", () => {
  it("uses the plain names from the PRD", () => {
    expect(humanize("I_Parameter")).toBe("Parameter harian");
    expect(humanize("O_Stok: stok akhir kemarin")).toBe("Stok hari ini: stok akhir kemarin");
    expect(humanize("T_Batch: Rencana")).toBe("Rencana batch: Rencana");
    expect(humanize("I_Parameter minggu lalu: GP ÷ kg")).toBe("Parameter minggu lalu: GP ÷ kg");
  });
  it("leaves no sheet prefix behind", () => {
    const s = humanize("T_Penjualan, I_Master, O_PnL TOTAL REVENUE, O_BS x, O_CF y, Z_Kontrol, T_Foo");
    expect(s).not.toMatch(/(?<![A-Za-z0-9])[IOTBZ]_[A-Za-z]/);
    expect(humanize("1 − shrink")).toBe("1 − shrink");
    expect(humanize(undefined)).toBeUndefined();
  });
});
