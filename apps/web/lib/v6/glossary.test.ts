import { describe, expect, it } from "vitest";
import { hasCode, plain } from "./glossary";

describe("plain() (R154, R155)", () => {
  it("drops code references and names a rule by its words", () => {
    expect(plain("NIBT Rp 79,2 jt menurut jurnal; beban tetap bulan ini belum ada (C55).")).toBe("NIBT Rp 79,2 jt menurut jurnal; beban tetap bulan ini belum ada.");
    expect(plain("C50: baris PO tanpa ukuran")).toBe("baris PO tanpa ukuran");
    expect(plain("Rilis butuh K35 override")).toBe("Rilis butuh rilis dengan pengecualian");
    expect(plain("lolos C38")).toBe("lolos order di bawah harga lantai");
    expect(plain("status committed, grid kelengkapan hijau")).toBe("status tersimpan, kelengkapan data harian hijau");
    expect(hasCode(plain("(K35, C59) catatan O8"))).toBe(false);
  });
  it("leaves numbers and ordinary words alone", () => {
    expect(plain("GP Rp 289,8 jt (14,4%)")).toBe("GP Rp 289,8 jt (14,4%)");
    expect(plain("Kelas C (besar)")).toBe("Kelas C (besar)");
  });
});
