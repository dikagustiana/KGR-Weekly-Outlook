import { Tile, TileGrid } from "./Tile";
import { CardBody } from "./Card";
import { ModeToggle, ReleaseLine, Slicer, Stepper } from "./Controls";
import { ComboChart, Legend, LineChart, PairedBars, StackedBars, Waterfall } from "./Chart";
import { V4Table } from "./Table";
import { CaraHitung } from "./CaraHitung";
import type { TileModel } from "@/lib/v4/minggu-ini";
import type { ReactNode } from "react";
import { Card6 } from "../v6/Card";
import { Headline } from "../v6/Headline";
import { TileEmpty, TileError } from "../v6/TileState";
import { Stepper6 } from "../v6/Stepper";
import type { StatusKind } from "@/lib/v6/status-map";

/**
 * Inner size of a tile at 1366 px (12 columns, gap 12, rows of 76): the SVG viewBox of a chart. `chrome` is what the
 * tile spends besides the chart: padding and border 26, header 26, and the note under the tile (one line 24, two 40).
 */
export function tileBox(w: number, h: number, chrome = 52): { width: number; height: number } {
  const col = (1366 - 48 - 11 * 12) / 12;
  return { width: Math.round(w * col + (w - 1) * 12 - 32), height: Math.max(60, Math.round(h * 76 + (h - 1) * 12 - chrome)) };
}

/**
 * PRD v5.1 R40: a chart that fills its tile takes the height the tile body really has (a grid row can grow past 76 px),
 * never less than tileBox at 76 px rows; the SVG keeps its proportions (viewBox, meet).
 */
const Fit = ({ min, children }: { min: number; children: ReactNode }) => <div className="chart-fit" style={{ minHeight: min }}>{children}</div>;

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
      return <Fit min={b.height}><ComboChart width={b.width} height={b.height} points={c.points} label={t.title ?? t.id} labelMax={c.labelMax} /></Fit>;
    }
    case "line": {
      const b = tileBox(t.pos.w, t.pos.h, 52 + noteH(t));
      return <Fit min={b.height}><LineChart width={b.width} height={b.height} plot={c.plot} label={t.title ?? t.id} /></Fit>;
    }
    case "waterfall": {
      const b = tileBox(t.pos.w, t.pos.h, 52 + noteH(t));
      return <Fit min={b.height}><Waterfall width={b.width} height={b.height} steps={c.steps} label={t.title ?? t.id} /></Fit>;
    }
    case "paired": {
      const b = tileBox(t.pos.w, t.pos.h, 52 + noteH(t));
      return <Fit min={b.height}><PairedBars width={b.width} height={b.height} groups={c.groups} label={t.title ?? t.id} /></Fit>;
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

/** PRD v6 R132: a tile whose content is empty (no rows, no items, no points); it shrinks to one 76 px row. */
function emptyText(t: TileModel): string | null {
  const c = t.content;
  if (c.type === "table" && !c.rows.length && !(c.sections ?? []).some((x) => x.rows.length)) return `${t.title ?? "Tabel"}: belum ada data minggu ini`;
  if (c.type === "list" && !c.items.length) return c.empty ?? `${t.title ?? "Daftar"}: tidak ada`;
  if ((c.type === "combo" || c.type === "chart+table") && !c.points.length) return `${t.title ?? "Grafik"}: belum ada titik data`;
  return null;
}

/** v6 body of a tile (flag v6_shell): Card6 for cards, the visible <h1> for the headline, one line for an empty tile. */
function body6(t: TileModel): ReactNode {
  const c = t.content;
  if (c.type === "headline") return <Headline>{c.text}</Headline>;
  if (c.type === "card") return null; // rendered by Card6 in place of the tile header and body
  if (c.type === "stepper") {
    // R147: the step's status as Status (icon + word); the step's own text stays visible as its label
    const kind = (st: { status: string; locked?: string | null }): StatusKind =>
      st.locked ? "belum" : /^(lulus|versi \d+|selesai|disetujui)/i.test(st.status) && !/sementara/i.test(st.status) ? "lolos" : /^buka /i.test(st.status) ? "belum" : "catatan";
    return <Stepper6 current={String(c.current)} steps={c.steps.map((st) => ({ id: String(st.n), name: st.label, status: kind(st), statusText: st.locked ?? st.status, href: st.locked ? undefined : st.href }))} />;
  }
  const empty = emptyText(t);
  if (empty) return <TileEmpty what={empty} />;
  return body(t);
}

/**
 * A page of tiles (PRD v4 §6): one grid, every tile placed at its x, y, w, h. R75: ordered (y, x) before render.
 * PRD v6 (`v6`, flag v6_shell): cards are Card6 (four rows, the value links with "Buka …", ⓘ for source and rule), the
 * headline is the page's visible <h1>, an empty tile is one line at 76 px, a failed tile says which and offers "Muat ulang".
 */
export function TilePage({ tiles, label, extras, v6 }: { tiles: TileModel[]; label: string; extras?: Record<string, ReactNode>; v6?: boolean }) {
  const ordered = [...tiles].sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
  if (v6) {
    // K86 / K88 / R138: the week chips and the release line + PDF live in the shell (WeekPicker, context row, phone menu), not
    // above the headline; the headline comes first in the DOM (a phone shows the tiles in DOM order; the desktop grid keeps
    // every tile at its x, y)
    const shown = ordered.filter((t) => t.content.type !== "release" && !(t.content.type === "slicer" && t.content.label === "Minggu"));
    const v6order = [...shown.filter((t) => t.content.type === "headline"), ...shown.filter((t) => t.content.type !== "headline")];
    return (
      <TileGrid label={label}>
        {v6order.map((t) => {
          const c = t.content;
          const empty = !t.error && emptyText(t) !== null;
          const pos = empty ? { ...t.pos, h: 1 } : t.pos;
          if (c.type === "card" && !t.error) {
            return (
              <Tile key={t.id} id={t.id} pos={pos} kind="card" source={t.source}>
                <Card6 id={t.id} title={t.title ?? t.id} value={c.value} unit={c.unit} missing={c.missing} compare={c.compare.slice(0, c.maxCompare ?? 3)} href={c.href}
                  finding={t.note ? { text: t.note } : null} cara={t.cara} />
                {extras?.[t.id] ?? null}
              </Tile>
            );
          }
          return (
            <Tile key={t.id} id={t.id} pos={pos} title={c.type === "headline" ? undefined : t.title} kind={t.kind} note={t.error || empty ? undefined : t.note} source={t.error ? undefined : t.source} collapse={t.error || empty ? undefined : t.collapse?.label}
              extra={!empty && (legendOf(t) || t.cara || t.views) ? <span className="tile-x">{(t.views ?? []).map((v) => <Slicer key={v.label} label={v.label} options={v.options} current={v.current} hideLabel />)}{legendOf(t)}{t.cara ? <CaraHitung content={t.cara} /> : null}</span> : undefined}>
              {t.error ? <TileError tile={t.title ?? t.id} message={t.error} /> : <>{body6(t)}{extras?.[t.id] ?? null}</>}
            </Tile>
          );
        })}
      </TileGrid>
    );
  }
  return (
    <TileGrid label={label}>
      {ordered.map((t) => (
        <Tile key={t.id} id={t.id} pos={t.pos} title={t.title} kind={t.kind} note={t.error ? undefined : t.note} source={t.error ? undefined : t.source} collapse={t.error ? undefined : t.collapse?.label}
          extra={legendOf(t) || t.cara || t.views ? <span className="tile-x">{(t.views ?? []).map((v) => <Slicer key={v.label} label={v.label} options={v.options} current={v.current} hideLabel />)}{legendOf(t)}{t.cara ? <CaraHitung content={t.cara} /> : null}</span> : undefined}>
          {t.error ? <p className="tile-err" role="alert" data-tile-error="">Gagal memuat data tile ini: {t.error}</p> : <>{body(t)}{extras?.[t.id] ?? null}</>}
        </Tile>
      ))}
    </TileGrid>
  );
}

/** PRD v6 R148: with v6 the headline tile is the page's <h1>; a page without one keeps its own (screen-reader) <h1>. */
export const hasHeadline = (tiles: TileModel[]) => tiles.some((t) => t.content.type === "headline" && !t.error);
