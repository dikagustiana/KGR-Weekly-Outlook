import type { ReactNode } from "react";
import { Tile, TileGrid } from "./Tile";
import { CardBody } from "./Card";
import { ModeToggle, ReleaseLine, Slicer } from "./Controls";
import { ComboChart, Legend, PairedBars, StackedBars, Waterfall } from "./Chart";
import { V4Table } from "./Table";
import { CaraHitung } from "./CaraHitung";
import type { TileModel } from "@/lib/v4/minggu-ini";

/** Approximate inner size of a tile at 1366 px (12 columns, gap 12, tile padding 16): the SVG viewBox of a chart. */
export function tileBox(w: number, h: number, chrome = 70): { width: number; height: number } {
  const col = (1366 - 48 - 11 * 12) / 12;
  return { width: Math.round(w * col + (w - 1) * 12 - 32), height: Math.max(80, Math.round(h * 76 + (h - 1) * 12 - chrome)) };
}

function body(t: TileModel): ReactNode {
  const c = t.content;
  switch (c.type) {
    case "slicer": return <Slicer label={c.label} options={c.options} current={c.current} />;
    case "mode": return <ModeToggle label={c.label} options={c.options} current={c.current} />;
    case "release": return <ReleaseLine text={c.text} action={c.pdfHref ? <a className="v4b" href={c.pdfHref}>Unduh PDF</a> : null} />;
    case "headline": return <p className="headline" data-headline="" data-tile-value="">{c.text}</p>;
    case "card": return <CardBody value={c.value} unit={c.unit} compare={c.compare} href={c.href} missing={c.missing} negative={c.negative} />;
    case "combo": {
      const b = tileBox(t.pos.w, t.pos.h, t.note ? 92 : 74);
      return <><ComboChart width={b.width} height={b.height} points={c.points} label={t.title ?? t.id} /><Legend items={c.legend} /></>;
    }
    case "waterfall": {
      const b = tileBox(t.pos.w, t.pos.h, t.note ? 74 : 56);
      return <Waterfall width={b.width} height={b.height} steps={c.steps} label={t.title ?? t.id} />;
    }
    case "paired": {
      const b = tileBox(t.pos.w, t.pos.h, t.note ? 92 : 74);
      return <><PairedBars width={b.width} height={b.height} groups={c.groups} label={t.title ?? t.id} /><Legend items={c.legend} /></>;
    }
    case "stacked": {
      const b = tileBox(t.pos.w, 1);
      const height = c.rows.length * 18 + 8;
      return <><div style={{ height }}><StackedBars width={b.width} height={height} rows={c.rows} label={t.title ?? t.id} /></div><Legend items={c.legend} /><V4Table cols={c.table.cols} rows={c.table.rows} /></>;
    }
    case "chart+table": {
      const b = tileBox(t.pos.w, 1);
      return <><div style={{ height: 120 }}><ComboChart width={b.width} height={120} points={c.points} label={t.title ?? t.id} /></div><Legend items={c.legend} /><V4Table cols={c.cols} rows={c.rows} /></>;
    }
    case "table": return (
      <>
        <V4Table cols={c.cols} rows={c.rows} label={t.title} />
        {(c.sections ?? []).map((s) => <div key={s.title}><h3 className="tile-t">{s.title}</h3><V4Table cols={s.cols} rows={s.rows} label={s.title} /></div>)}
      </>
    );
    case "list": {
      if (!c.items.length) return <p className="note">{c.empty ?? "tidak ada"}</p>;
      const L = c.ordered ? "ol" : "ul";
      return <L className="note" data-tile-value="">{c.items.map((i) => <li key={i}>{i}</li>)}</L>;
    }
  }
}

/** A page of tiles (PRD v4 §6): one grid, every tile placed at its x, y, w, h. */
export function TilePage({ tiles, label }: { tiles: TileModel[]; label: string }) {
  return (
    <TileGrid label={label}>
      {tiles.map((t) => (
        <Tile key={t.id} id={t.id} pos={t.pos} title={t.title} kind={t.kind} note={t.note} extra={t.cara ? <CaraHitung content={t.cara} /> : undefined}>
          {body(t)}
        </Tile>
      ))}
    </TileGrid>
  );
}
