/**
 * PRD v6 R158 (flag v6_pages): Outlook bulan in the v6 grammar, as a transform of the finished tiles (v4 + v5_pl), pure.
 * Actual, forecast and outlook cards carry GP as the number with revenue and NIBT as comparisons (the same as Minggu ini);
 * "vs Budget" is left out while there is no budget; the daily chart prints a value on every bar (Dika's standing rule).
 */
import type { TileModel } from "../v4/minggu-ini";

const GP = /^GP( P&L)?$/;

export function outlookBulanV6(tiles: TileModel[]): TileModel[] {
  const out: TileModel[] = [];
  for (const t of tiles) {
    const c = t.content;
    if (t.id === "c-budget" && c.type === "card" && c.value === null) continue;
    if ((t.id === "c-actual" || t.id === "c-forecast" || t.id === "c-outlook") && c.type === "card" && c.value !== null) {
      const gp = c.compare.find((x) => GP.test(x.label));
      if (gp) {
        const [num, pct] = gp.value.replace(/ jt/, "").split(" (");
        const rest = c.compare.filter((x) => x !== gp);
        out.push({
          ...t,
          content: {
            ...c, value: num.trim(), unit: "Rp jt", negative: num.trim().startsWith("−"),
            compare: [...(pct ? [{ label: "GP %", value: pct.replace(/\)$/, "") }] : []), { label: "Revenue", value: `${c.value} jt` }, ...rest].slice(0, 4),
            maxCompare: 4,
          },
        });
        continue;
      }
    }
    if (c.type === "combo" && t.id.startsWith("ch-")) { out.push({ ...t, content: { ...c, labelMax: Math.max(c.labelMax ?? 0, c.points.length) } }); continue; }
    out.push(t);
  }
  return out;
}
