import type { ControlV3 } from "@kgr/engine";
import { Badge, N } from "@/components/ui";

/** v3 module controls (C21–C40). Shown next to, never inside, the v1 Z_Kontrol list. */
export function ControlsV3Table({ controls, management = false }: { controls: ControlV3[]; management?: boolean }) {
  if (!controls.length) return null;
  return (
    <table className="t">
      <thead><tr><th>Kode</th><th>Kontrol</th><th className="n">Nilai</th><th className="n">Pembanding</th><th className="n">Selisih</th><th>Status</th><th>{management ? "Catatan" : "Tindakan"}</th></tr></thead>
      <tbody>
        {controls.map((c) => (
          <tr key={c.code}>
            <td>{c.code}</td>
            <td>{c.name}{!management && c.detail.length ? <details><summary className="muted">{c.detail.length} baris</summary><ul>{c.detail.slice(0, 30).map((d) => <li key={d}>{d}</li>)}</ul></details> : null}</td>
            <td className="n"><N v={c.value} dp={0} /></td>
            <td className="n">{c.comparator === null ? <span className="muted">—</span> : <N v={c.comparator} dp={c.comparator.isInteger() ? 0 : 2} />}</td>
            <td className="n">{c.difference === null ? "" : <N v={c.difference} dp={c.difference.abs().lt(1) && !c.difference.isZero() ? 4 : 0} />}</td>
            <td><Badge s={c.status} /></td>
            <td className="muted">{c.action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
