import type { ReactNode } from "react";

export interface Col6 {
  key: string;
  label: string;
  num?: boolean;
  /** Forecast column: italic, and its label says so (R171: meaning never by style alone). */
  fc?: boolean;
}

export interface Row6 {
  id: string;
  cells: Record<string, ReactNode>;
  total?: boolean;
}

/**
 * PRD v6 R141: nowrap only on number columns, text wraps; a hidden <caption>; `scope` on every header; the first cell of a
 * row is its row header; a total row is `scope="row"`; negatives are red AND carry the minus sign (−). At ≤ 899 px the first
 * column is sticky, and a table of at most 4 columns becomes a list of cards (`data-mobile="cards"`).
 */
export function Table6({ label, cols, rows, empty }: { label: string; cols: Col6[]; rows: Row6[]; empty?: ReactNode }) {
  if (!rows.length) return <p className="ts-empty">{empty ?? `${label}: belum ada baris`}</p>;
  const neg = (v: ReactNode) => (typeof v === "string" && v.startsWith("−") ? <span className="neg">{v}</span> : v);
  return (
    <div className="t6-wrap">
      <table className="t6" data-mobile={cols.length <= 4 ? "cards" : undefined}>
        <caption>{label}</caption>
        <thead><tr>{cols.map((c) => <th key={c.key} scope="col" className={[c.num ? "n" : "", c.fc ? "fc" : ""].filter(Boolean).join(" ") || undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.total ? "total" : undefined}>
              {cols.map((c, i) => {
                const cls = [c.num ? "n" : "", c.fc ? "fc" : ""].filter(Boolean).join(" ") || undefined;
                const v = neg(r.cells[c.key] ?? "");
                return i === 0
                  ? <th key={c.key} scope="row" className={cls} data-label={c.label}>{v}</th>
                  : <td key={c.key} className={cls} data-label={c.label}>{v}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
