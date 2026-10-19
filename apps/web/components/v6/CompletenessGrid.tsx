import { Status } from "./Status";
import type { StatusKind } from "@/lib/v6/status-map";

export interface GridLine { id: string; title: string; owner: string; cells: { date: string; label: string; status: StatusKind | null; note: string | null }[] }

/**
 * PRD v6 R162: "kelengkapan data harian" as a table whose day columns line up; each cell is a small Status; the input's name
 * keeps to one or two lines (first column at least 160 px).
 */
export function CompletenessGrid({ days, rows, caption }: { days: { date: string; label: string }[]; rows: GridLine[]; caption: string }) {
  return (
    <div className="t6-wrap">
      <table className="t6" data-grid6="">
        <caption>{caption}</caption>
        <thead><tr><th scope="col" style={{ minWidth: 160 }}>Input</th><th scope="col">Pemilik</th>{days.map((d) => <th key={d.date} scope="col">{d.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row">{r.title}</th>
              <td>{r.owner}</td>
              {r.cells.map((c) => <td key={c.date} title={c.note ?? undefined}>{c.status ? <Status kind={c.status} size="sm" /> : null}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
