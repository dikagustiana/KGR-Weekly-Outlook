import { num } from "@/lib/fmt";

export interface DailyBar {
  date: string;
  /** jt Rp, display only (the numbers come from the engine). */
  value: number;
  kind: "actual" | "po" | "runrate" | "none";
  anomaly?: boolean;
}

/** Revenue per day: actual (solid), forecast on PO (striped tone) and run-rate (light). SVG, no client JS. */
export function DailyChart({ bars, height = 140 }: { bars: DailyBar[]; height?: number }) {
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
  const w = 18, gap = 4, H = height - 24;
  const color = (k: DailyBar["kind"]) => (k === "actual" ? "#2f6db5" : k === "po" ? "#6a9bd8" : k === "runrate" ? "#b8cbe6" : "#e2e6ee");
  return (
    <svg viewBox={`0 0 ${bars.length * (w + gap)} ${height}`} width="100%" height={height} role="img" aria-label="Revenue per hari">
      {bars.map((b, i) => {
        const h = (Math.abs(b.value) / max) * H;
        return (
          <g key={b.date} transform={`translate(${i * (w + gap)},0)`}>
            <rect x={0} y={H - h} width={w} height={Math.max(h, 1)} fill={color(b.kind)} stroke={b.anomaly ? "#c62828" : "none"} strokeWidth={b.anomaly ? 1.5 : 0}>
              <title>{`${b.date}: ${num(b.value, 1)} jt (${b.kind === "actual" ? "aktual" : b.kind === "po" ? "PO" : b.kind === "runrate" ? "run-rate" : "—"})${b.anomaly ? " — anomali" : ""}`}</title>
            </rect>
            <text x={w / 2} y={height - 8} fontSize={8} textAnchor="middle" fill="#667">{b.date.slice(8)}</text>
          </g>
        );
      })}
    </svg>
  );
}
