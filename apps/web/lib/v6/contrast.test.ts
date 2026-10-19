/** PRD v6 R164 / R165 (WCAG 1.4.3, 1.4.11): the token pairs the v6 grammar uses, computed from the CSS. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const css = readFileSync(join(__dirname, "../../app/v4.css"), "utf8") + readFileSync(join(__dirname, "../../app/v6.css"), "utf8");
const tok = (name: string) => { const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i")); if (!m) throw new Error(name); return m[1]; };

describe("v6 contrast", () => {
  const white = tok("surface"), bg = tok("bg");
  it.each([
    ["muted on surface", "muted", "surface", 4.5], ["muted on bg", "muted", "bg", 4.5], ["accent on surface", "accent", "surface", 4.5],
    ["bad on surface", "bad", "surface", 4.5], ["good on surface", "good", "surface", 4.5], ["warn on surface", "warn", "surface", 4.5],
    ["warn on bg", "warn", "bg", 4.5], ["text on bg", "text", "bg", 4.5],
  ])("%s ≥ %s:1", (_n, fg, back, min) => { expect(ratio(tok(fg), tok(back))).toBeGreaterThanOrEqual(min as number); });
  it("input border (--line-input) ≥ 3:1 on white (1.4.11)", () => { expect(ratio(tok("line-input"), white)).toBeGreaterThanOrEqual(3); });
  it("status icons ≥ 3:1 on the tile", () => { for (const t of ["good", "warn", "bad", "muted"]) expect(ratio(tok(t), white)).toBeGreaterThanOrEqual(3); });
  it("bg is not white (the pairs above are not the same test twice)", () => { expect(bg).not.toBe(white); });
});
