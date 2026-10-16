/**
 * Chart (PRD v4 §5.3): column, line, combo, waterfall, stacked and paired bars, rendered on the server as SVG.
 * The selected period is highlighted, a click on a bar is a link that filters the linked tiles, value labels show
 * when there are ≤ 12 points, and every bar carries its basis in the tooltip (<title>).
 *
 * §5.3 names ECharts; this component keeps the same contract with plain SVG because a new dependency could not be
 * installed and verified here (docs/v4/QUESTIONS.md Q14). Values arrive in Rp jt (or Rp/kg) already decided by the
 * engine; the labels arrive formatted, so the chart only places them.
 */
import type { ReactNode } from "react";

const PAD = { l: 8, r: 8, t: 20, b: 26 };
const LABEL_MAX = 12;

export interface ChartPoint {
  key: string;
  label: string;
  bar: number | null;
  barText?: string;
  barTone?: "s1" | "s2" | "s3";
  line?: number | null;
  lineText?: string;
  href?: string;
  title?: string;
  selected?: boolean;
}

function scale(values: number[], top: number, bottom: number) {
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const head = span * 0.12;
  const min = lo < 0 ? lo - head : lo, max = hi + head;
  return (v: number) => top + ((max - v) / (max - min)) * (bottom - top);
}

function Wrap({ href, title, children }: { href?: string; title?: string; children: ReactNode }) {
  const t = title ? <title>{title}</title> : null;
  return href ? <a href={href}>{t}{children}</a> : <g>{t}{children}</g>;
}

/** Columns with an optional line (combo); empty state as text. */
export function ComboChart({ width, height, points, label, empty = "tidak ada data untuk periode ini" }: {
  width: number; height: number; points: ChartPoint[]; label: string; empty?: string;
}) {
  if (!points.length || points.every((p) => p.bar === null && (p.line ?? null) === null)) return <p className="note">{empty}</p>;
  const top = PAD.t, bottom = height - PAD.b;
  const y = scale(points.flatMap((p) => [p.bar ?? 0, p.line ?? 0]), top, bottom);
  const slot = (width - PAD.l - PAD.r) / points.length;
  const bw = Math.min(56, slot * 0.58);
  const cx = (i: number) => PAD.l + slot * i + slot / 2;
  const showLabels = points.length <= LABEL_MAX;
  const line = points.map((p, i) => (p.line === null || p.line === undefined ? null : [cx(i), y(p.line)] as const)).filter((p): p is readonly [number, number] => p !== null);
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      {points.map((p, i) => p.selected ? <rect key={`sel${p.key}`} className="sel" x={PAD.l + slot * i + 2} y={top - 14} width={slot - 4} height={bottom - top + 14} rx={6} /> : null)}
      <line className="axis" x1={PAD.l} x2={width - PAD.r} y1={y(0)} y2={y(0)} />
      {points.map((p, i) => {
        const v = p.bar ?? 0;
        const y0 = y(0), y1 = y(v);
        return (
          <Wrap key={p.key} href={p.href} title={p.title}>
            {p.bar !== null ? <rect className={p.barTone ?? "s1"} x={cx(i) - bw / 2} y={Math.min(y0, y1)} width={bw} height={Math.max(1, Math.abs(y1 - y0))} rx={3} /> : null}
            <rect x={PAD.l + slot * i} y={top} width={slot} height={bottom - top} fill="transparent" />
            {showLabels && p.bar !== null && p.barText ? <text className={`v${v < 0 ? " neg" : ""}`} x={cx(i)} y={v < 0 ? y1 + 13 : y1 - 5} textAnchor="middle">{p.barText}</text> : null}
            <text x={cx(i)} y={height - 8} textAnchor="middle">{p.label}</text>
          </Wrap>
        );
      })}
      {line.length > 1 ? <polyline className="ln" points={line.map(([a, b]) => `${a},${b}`).join(" ")} /> : null}
      {points.map((p, i) => (p.line === null || p.line === undefined ? null : (
        <g key={`l${p.key}`}>
          <circle className="dot" cx={cx(i)} cy={y(p.line)} r={3.5} />
          {showLabels && p.lineText ? <text className={`v${p.line < 0 ? " neg" : ""}`} x={cx(i) + 6} y={y(p.line) + 15}>{p.lineText}</text> : null}
        </g>
      )))}
    </svg>
  );
}

export interface WaterfallStep {
  key: string;
  label: string;
  value: number;
  valueText: string;
  kind: "total" | "delta";
  title?: string;
}

/** Waterfall: totals from zero (neutral), deltas floating (green = better, red = worse). */
export function Waterfall({ width, height, steps, label }: { width: number; height: number; steps: WaterfallStep[]; label: string }) {
  if (!steps.length) return <p className="note">tidak ada data untuk periode ini</p>;
  let run = 0;
  const bars = steps.map((s) => {
    if (s.kind === "total") { run = s.value; return { s, from: 0, to: s.value }; }
    const from = run; run += s.value; return { s, from, to: run };
  });
  const top = PAD.t, bottom = height - PAD.b - 12;
  const y = scale(bars.flatMap((b) => [b.from, b.to]), top, bottom);
  const slot = (width - PAD.l - PAD.r) / steps.length;
  const bw = Math.min(54, slot * 0.6);
  const cx = (i: number) => PAD.l + slot * i + slot / 2;
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <line className="axis" x1={PAD.l} x2={width - PAD.r} y1={y(0)} y2={y(0)} />
      {bars.map((b, i) => {
        const yA = y(b.from), yB = y(b.to);
        const tone = b.s.kind === "total" ? "s3" : b.s.value >= 0 ? "up" : "down";
        const words = b.s.label.split(" ");
        const mid = Math.ceil(words.length / 2);
        return (
          <g key={b.s.key}>
            <title>{b.s.title ?? b.s.label}</title>
            <rect className={tone} x={cx(i) - bw / 2} y={Math.min(yA, yB)} width={bw} height={Math.max(1, Math.abs(yB - yA))} rx={3} />
            {i < bars.length - 1 ? <line className="axis" x1={cx(i) + bw / 2} x2={cx(i + 1) - bw / 2} y1={yB} y2={yB} strokeDasharray="3 3" /> : null}
            <text className={`v${(b.s.kind === "total" ? b.s.value : b.s.value) < 0 ? " neg" : ""}`} x={cx(i)} y={Math.min(yA, yB) - 5} textAnchor="middle">{b.s.valueText}</text>
            <text x={cx(i)} y={height - 22} textAnchor="middle">{words.slice(0, mid).join(" ")}</text>
            <text x={cx(i)} y={height - 9} textAnchor="middle">{words.slice(mid).join(" ")}</text>
          </g>
        );
      })}
    </svg>
  );
}

export interface PairGroup { key: string; label: string; a: number | null; aText: string; b: number | null; bText: string; href?: string; selected?: boolean; title?: string }

/** Paired bars per group (e.g. revenue/kg vs COGS/kg per segment), value labels on every bar. */
export function PairedBars({ width, height, groups, label }: { width: number; height: number; groups: PairGroup[]; label: string }) {
  if (!groups.length) return <p className="note">tidak ada data untuk periode ini</p>;
  const top = PAD.t, bottom = height - PAD.b;
  const y = scale(groups.flatMap((g) => [g.a ?? 0, g.b ?? 0]), top, bottom);
  const slot = (width - PAD.l - PAD.r) / groups.length;
  const bw = Math.min(44, slot * 0.3);
  const cx = (i: number) => PAD.l + slot * i + slot / 2;
  const bar = (v: number | null, x: number, tone: string, text: string) => v === null ? (
    <text x={x} y={y(0) - 5} textAnchor="middle">belum diisi</text>
  ) : (
    <>
      <rect className={tone} x={x - bw / 2} y={Math.min(y(0), y(v))} width={bw} height={Math.max(1, Math.abs(y(v) - y(0)))} rx={3} />
      <text className={`v${v < 0 ? " neg" : ""}`} x={x} y={Math.min(y(0), y(v)) - 5} textAnchor="middle">{text}</text>
    </>
  );
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <line className="axis" x1={PAD.l} x2={width - PAD.r} y1={y(0)} y2={y(0)} />
      {groups.map((g, i) => (
        <Wrap key={g.key} href={g.href} title={g.title}>
          {g.selected ? <rect className="sel" x={PAD.l + slot * i + 2} y={top - 14} width={slot - 4} height={bottom - top + 14} rx={6} /> : null}
          {bar(g.a, cx(i) - bw / 2 - 3, "s1", g.aText)}
          {bar(g.b, cx(i) + bw / 2 + 3, "s3", g.bText)}
          <text x={cx(i)} y={height - 8} textAnchor="middle">{g.label}</text>
        </Wrap>
      ))}
    </svg>
  );
}

export interface StackRow { key: string; label: string; parts: number[]; totalText: string; href?: string; selected?: boolean; title?: string }

/** Horizontal stacked bars (e.g. stock per age bucket per SKU), total label at the end of each bar. */
export function StackedBars({ width, height, rows, label, tones = ["s1", "s2", "s3"], rowHeight }: { width: number; height: number; rows: StackRow[]; label: string; tones?: string[]; rowHeight?: number }) {
  if (!rows.length) return <p className="note">tidak ada data untuk periode ini</p>;
  const lw = Math.min(150, width * 0.32), rw = 70;
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((a, b) => a + Math.max(0, b), 0)));
  const rh = rowHeight ?? Math.min(26, (height - 8) / rows.length);
  const x = (v: number) => (v / max) * (width - lw - rw - 8);
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      {rows.map((r, i) => {
        let acc = 0;
        const yy = 4 + i * rh;
        return (
          <Wrap key={r.key} href={r.href} title={r.title}>
            {r.selected ? <rect className="sel" x={0} y={yy} width={width} height={rh - 2} rx={4} /> : null}
            <text x={lw - 6} y={yy + rh / 2 + 4} textAnchor="end">{r.label}</text>
            {r.parts.map((p, j) => {
              const w = x(Math.max(0, p));
              const el = <rect key={j} className={tones[j] ?? "s3"} x={lw + x(acc)} y={yy + 2} width={Math.max(0, w)} height={Math.max(6, rh - 5)} />;
              acc += Math.max(0, p);
              return el;
            })}
            <text className="v" x={lw + x(acc) + 6} y={yy + rh / 2 + 4}>{r.totalText}</text>
          </Wrap>
        );
      })}
    </svg>
  );
}

export function Legend({ items }: { items: { tone: "s1" | "s2" | "s3" | "ln"; label: string }[] }) {
  return <div className="legend">{items.map((i) => <span key={i.label}><i className={i.tone} />{i.label}</span>)}</div>;
}
