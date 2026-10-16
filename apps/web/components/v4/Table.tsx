import Link from "next/link";
import type { ReactNode } from "react";

export interface Col {
  key: string;
  label: string;
  num?: boolean;
  /** Decision column (bold) or supporting column (muted), §5.3; fc = forecast (italic), hi = the highlighted column. */
  kind?: "key" | "sup" | "fc" | "hi";
  /** Let long text wrap (narrow tiles); cells stay on one line otherwise. */
  wrap?: boolean;
}

export interface TRow {
  id: string;
  cells: Record<string, ReactNode>;
  href?: string;
  kind?: "total" | "sub" | "strong";
  on?: boolean;
  /** Negative numbers of the row in red (§5.1: red only for negatives, on the deciding rows). */
  redNeg?: boolean;
  /** One cell across every column (e.g. the trigger line under a segment). */
  span?: boolean;
}

/**
 * Table (§5.3): sticky header, numeric columns right-aligned and tabular, total row, row link that filters linked
 * tiles; states empty and truncated ("menampilkan 50 dari N, buka detail").
 */
export function V4Table({ cols, rows, empty = "tidak ada data untuk periode ini", limit = 50, detailHref, label }: {
  cols: Col[]; rows: TRow[]; empty?: string; limit?: number; detailHref?: string; label?: string;
}) {
  if (!rows.length) return <p className="note" data-tile-value="">{empty}</p>;
  const shown = rows.slice(0, limit);
  return (
    <>
      <table className="v4t" aria-label={label}>
        <thead><tr>{cols.map((c) => <th key={c.key} className={[c.num ? "n" : "", c.kind === "fc" || c.kind === "hi" ? c.kind : ""].filter(Boolean).join(" ") || undefined} scope="col">{c.label}</th>)}</tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} className={[r.kind, r.on ? "on" : ""].filter(Boolean).join(" ") || undefined}>
              {r.span ? <td colSpan={cols.length}>{r.cells[cols[0].key]}</td> : cols.map((c, i) => {
                const v = r.cells[c.key] ?? "";
                const cls = [c.num ? "n" : "", c.kind ?? "", c.wrap ? "wrap" : ""].filter(Boolean).join(" ") || undefined;
                const shown = r.redNeg && typeof v === "string" && v.startsWith("\u2212") ? <span className="neg">{v}</span> : v;
                return <td key={c.key} className={cls}>{i === 0 && r.href ? <Link href={r.href}>{shown}</Link> : shown}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length ? <p className="cut">menampilkan {shown.length} dari {rows.length}{detailHref ? <>, <Link href={detailHref}>buka detail</Link></> : null}</p> : null}
    </>
  );
}
