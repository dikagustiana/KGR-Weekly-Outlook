/** K92: an input's starting value (numInput) is read back by parseNumber as the same number; num ("2.000") is not. */
import { describe, expect, it } from "vitest";
import { parseNumber } from "@kgr/parsers";
import { num, numInput } from "./fmt";

describe("numInput", () => {
  it.each([[2000, 0, "2000"], [16000, 0, "16000"], [36705, 0, "36705"], [1234.5, 2, "1234,50"], [0, 0, "0"], [-4000, 0, "-4000"]])(
    "%s → %s round-trips", (v, dp, shown) => {
      expect(numInput(v, dp)).toBe(shown);
      expect(Number(parseNumber(numInput(v, dp)))).toBe(v);
    });
  it("num keeps the thousands dots that K92 refuses in an input", () => {
    expect(num(2000)).toBe("2.000");
    expect(() => parseNumber(num(2000))).toThrow(/ambigu/);
  });
  it("empty stays empty", () => expect(numInput(null)).toBe(""));
});
