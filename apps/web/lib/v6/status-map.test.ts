import { describe, expect, it } from "vitest";
import { statusOf } from "./status-map";

describe("status vocabulary (K90)", () => {
  it("maps the stored words to four", () => {
    expect(statusOf("committed")).toBe("lolos");
    expect(statusOf("LULUS")).toBe("lolos");
    expect(statusOf("masuk, ada catatan")).toBe("catatan");
    expect(statusOf("PERIKSA")).toBe("catatan");
    expect(statusOf("GAGAL")).toBe("terlambat");
    expect(statusOf("BELUM DIISI")).toBe("belum");
    expect(statusOf(null)).toBe("belum");
  });
  it("an unknown word is shown as catatan, never lolos", () => {
    expect(statusOf("something")).toBe("catatan");
  });
});
