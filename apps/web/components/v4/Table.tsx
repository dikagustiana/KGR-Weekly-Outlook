import Link from "next/link";
import type { ReactNode } from "react";

export interface Col {
  key: string;
  label: string;
  num?: boolean;
  /** Decision column (bold) or supporting column (muted), §5.3. */
  kind?: "key" | "sup";
}

export interface TRow {
  id: string;
  cells: Record<string, ReactNode>;
  href?: string;
  kind?: "total" | "sub";
  on?: boolean;
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
  if (!rows.length) return <p className="note">{empty}</p>;
  const shown = rows.slice(0, limit);
  return (
    <>
      <table className="v4t" aria-label={label}>
        <thead><tr>{cols.map((c) => <th key={c.key} className={c.num ? "n" : undefined} scope="col">{c.label}</th>)}</tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} className={[r.kind, r.on ? "on" : ""].filter(Boolean).join(" ") || undefined}>
              {r.span ? <td colSpan={cols.length}>{r.cells[cols[0].key]}</td> : cols.map((c, i) => {
                const v = r.cells[c.key] ?? "";
                const cls = [c.num ? "n" : "", c.kind ?? ""].filter(Boolean).join(" ") || undefined;
                return <td key={c.key} className={cls}>{i === 0 && r.href ? <Link href={r.href}>{v}</Link> : v}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length ? <p className="cut">menampilkan {shown.length} dari {rows.length}{detailHref ? <>, <Link href={detailHref}>buka detail</Link></> : null}</p> : null}
    </>
  );
}
