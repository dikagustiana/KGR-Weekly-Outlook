import { Tile, TileGrid } from "./Tile";
import { CardBody } from "./Card";
import { ModeToggle, ReleaseLine, Slicer, Stepper } from "./Controls";
import { ComboChart, Legend, LineChart, PairedBars, StackedBars, Waterfall } from "./Chart";
import { V4Table } from "./Table";
import { CaraHitung } from "./CaraHitung";
import type { TileModel } from "@/lib/v4/minggu-ini";
import type { ReactNode } from "react";

/**
 * Inner size of a tile at 1366 px (12 columns, gap 12, rows of 76): the SVG viewBox of a chart. `chrome` is what the
 * tile spends besides the chart: padding and border 26, header 26, and the note under the tile (one line 24, two 40).
 */
export function tileBox(w: number, h: number, chrome = 52): { width: number; height: number } {
  const col = (1366 - 48 - 11 * 12) / 12;
  return { width: Math.round(w * col + (w - 1) * 12 - 32), height: Math.max(60, Math.round(h * 76 + (h - 1) * 12 - chrome)) };
}

const noteH = (t: TileModel) => (t.note ? (t.note.length > 78 ? 42 : 26) : 0);

function legendOf(t: TileModel): ReactNode {
  const c = t.content;
  return "legend" in c && c.legend ? <Legend items={c.legend} /> : null;
}

function body(t: TileModel): ReactNode {
  const c = t.content;
  switch (c.type) {
    case "slicer": return <><Slicer label={c.label} options={c.options} current={c.current} />{c.extra ? <span className="note" data-tile-value="">{c.extra}</span> : null}</>;
    case "mode": return <ModeToggle label={c.label} options={c.options} current={c.current} />;
    case "release": return <ReleaseLine text={c.text} action={c.pdfHref ? <a className="v4b" href={c.pdfHref}>Unduh PDF</a> : null} />;
    case "headline": return <p className="headline" data-headline="" data-tile-value="">{c.text}</p>;
    case "card": return <CardBody value={c.value} unit={c.unit} compare={c.compare} href={c.href} missing={c.missing} negative={c.negative} maxCompare={c.maxCompare} />;
    case "combo": {
      const b = tileBox(t.pos.w, t.pos.h, 52 + noteH(t));
      return <ComboChart width={b.width} height={b.height} points={c.points} label={t.title ?? t.id} labelMax={c.labelMax} />;
    }
    case "line": {
      const b = tileBox(t.pos.w, t.pos.h, 52 + noteH(t));
      return <LineChart width={b.width} height={b.height} plot={c.plot} label={t.title ?? t.id} />;
    }
    case "waterfall": {
      const b = tileBox(t.pos.w, t.pos.h, 52 + noteH(t));
      return <Waterfall width={b.width} height={b.height} steps={c.steps} label={t.title ?? t.id} />;
    }
    case "paired": {
      const b = tileBox(t.pos.w, t.pos.h, 52 + noteH(t));
      return <PairedBars width={b.width} height={b.height} groups={c.groups} label={t.title ?? t.id} />;
    }
    case "stacked": {
      const b = tileBox(t.pos.w, 1);
      const height = c.rows.length * 12 + 6;
      return <><StackedBars width={b.width} height={height} rows={c.rows} label={t.title ?? t.id} rowHeight={12} /><V4Table cols={c.table.cols} rows={c.table.rows} /></>;
    }
    case "chart+table": {
      const b = tileBox(t.pos.w, 1);
      return <><ComboChart width={b.width} height={84} points={c.points} label={t.title ?? t.id} /><V4Table cols={c.cols} rows={c.rows} /></>;
    }
    case "table": return (
      <>
        {c.form ? (
          <form className="tile-form" method={c.form.method} action={c.form.action}>
            {c.form.fields.map((f) => <label key={f.name}>{f.label} <input name={f.name} defaultValue={f.value} size={f.size ?? 4} /></label>)}
            <button className="v4b">{c.form.submit}</button>
          </form>
        ) : null}
        <V4Table cols={c.cols} rows={c.rows} label={t.title} limit={c.limit} />
        {(c.sections ?? []).map((s) => <div key={s.title}><h3 className="tile-t">{s.title}</h3><V4Table cols={s.cols} rows={s.rows} label={s.title} /></div>)}
      </>
    );
    case "stepper": return <Stepper steps={c.steps} current={c.current} />;
    case "slot": return null;
    case "kpis": return (
      <>
        {(c.controls ?? []).map((k) => <Slicer key={k.label} label={k.label} options={k.options} current={k.current} />)}
        <div className="simk">{c.items.map((i) => <div key={i.label} className="simk-i"><span className="simk-l">{i.label}</span><span className={`simk-v${i.negative ? " neg" : ""}`} data-tile-value="">{i.value}</span><span className="note">{i.sub}</span></div>)}</div>
        {c.cols && c.rows ? <V4Table cols={c.cols} rows={c.rows} label={t.title} /> : null}
        {c.foot ? <p className="note">{c.foot}</p> : null}
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
export function TilePage({ tiles, label, extras }: { tiles: TileModel[]; label: string; extras?: Record<string, ReactNode> }) {
  return (
    <TileGrid label={label}>
      {tiles.map((t) => (
        <Tile key={t.id} id={t.id} pos={t.pos} title={t.title} kind={t.kind} note={t.note} source={t.source}
          extra={legendOf(t) || t.cara || t.views ? <span className="tile-x">{(t.views ?? []).map((v) => <Slicer key={v.label} label={v.label} options={v.options} current={v.current} hideLabel />)}{legendOf(t)}{t.cara ? <CaraHitung content={t.cara} /> : null}</span> : undefined}>
          {body(t)}
          {extras?.[t.id] ?? null}
        </Tile>
      ))}
    </TileGrid>
  );
}
