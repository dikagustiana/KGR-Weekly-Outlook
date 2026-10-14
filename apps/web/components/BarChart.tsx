import { num } from "@/lib/fmt";

/** Small horizontal bar chart with data labels (prints well; no client JS). */
export function BarChart({ data, unit, target }: { data: { label: string; value: number; tone?: "neg" }[]; unit: string; target?: number }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)), target ?? 0);
  const fmt = (v: number) => (unit === "%" ? `${num(v, 1)}%` : num(v, 0));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(80px, 38%) 1fr", gap: "3px 8px", fontSize: 11 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: "contents" }}>
          <div className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</div>
          <div style={{ position: "relative", height: 16, background: "#f1f3f7", borderRadius: 2 }}>
            <div style={{ width: `${(Math.abs(d.value) / max) * 100}%`, height: "100%", background: d.tone === "neg" ? "#c9783a" : "#2f6db5", borderRadius: 2 }} />
            {target !== undefined ? <div style={{ position: "absolute", left: `${(target / max) * 100}%`, top: -2, bottom: -2, width: 2, background: "#c62828" }} title={`target ${fmt(target)}`} /> : null}
            <span style={{ position: "absolute", right: 4, top: 1, fontWeight: 600 }}>{fmt(d.value)}</span>
          </div>
        </div>
      ))}
      {target !== undefined ? <div className="muted" style={{ gridColumn: "1 / -1" }}>Garis merah = target {fmt(target)}</div> : null}
    </div>
  );
}
