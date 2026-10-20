/**
 * PRD v6 R154 / R155 (flag v6_pages): every text a tile shows goes through the glossary (`plain`); the "cara hitung" drawer
 * (`cara`) keeps the codes and the table names, it is where they belong. Pure; strings only — numbers and links are untouched.
 */
import { isValidElement, type ReactNode } from "react";
import type { TileModel } from "../v4/minggu-ini";
import { plain } from "./glossary";

const txt = (v: string | undefined) => (v === undefined ? v : plain(v));
const node = (v: ReactNode): ReactNode => (typeof v === "string" ? plain(v) : isValidElement(v) ? v : v);

export function plainTiles(tiles: TileModel[]): TileModel[] {
  return tiles.map((t) => {
    const c = t.content;
    const out: TileModel = { ...t, title: txt(t.title), note: txt(t.note), source: t.source ? { ...t.source, text: plain(t.source.text) } : t.source };
    switch (c.type) {
      case "headline": out.content = { ...c, text: plain(c.text) }; break;
      case "card": out.content = { ...c, missing: txt(c.missing), compare: c.compare.map((x) => ({ ...x, label: plain(x.label), value: plain(x.value) })) }; break;
      case "list": out.content = { ...c, items: c.items.map(plain), empty: txt(c.empty) }; break;
      case "table": out.content = {
        ...c,
        cols: c.cols.map((k) => ({ ...k, label: plain(k.label) })),
        rows: c.rows.map((r) => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, node(v)])) })),
        sections: c.sections?.map((s) => ({ ...s, title: plain(s.title), rows: s.rows.map((r) => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, node(v)])) })) })),
      }; break;
      case "kpis": out.content = { ...c, foot: txt(c.foot), items: c.items.map((i) => ({ ...i, label: plain(i.label), sub: typeof i.sub === "string" ? plain(i.sub) : i.sub })) }; break;
      case "stepper": out.content = { ...c, steps: c.steps.map((s) => ({ ...s, label: plain(s.label), status: plain(s.status), locked: s.locked ? plain(s.locked) : s.locked })) }; break;
      default: break;
    }
    return out;
  });
}
