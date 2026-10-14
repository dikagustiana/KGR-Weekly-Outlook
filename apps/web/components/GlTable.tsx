import type { GlP } from "@kgr/engine";
import { Td } from "./ui";
import { tgl } from "@/lib/fmt";

/** Journal lines (drill-down) with the derived columns of T_GL. */
export function GlTable({ lines, sign = 1, extra }: { lines: GlP[]; sign?: 1 | -1; extra?: (g: GlP) => React.ReactNode }) {
  const total = lines.reduce((a, g) => a.plus(g.drCr), lines[0]?.drCr.times(0) ?? (null as never));
  return (
    <div className="scroll">
      <table className="t compact">
        <thead>
          <tr><th>Tanggal</th><th>No. sumber</th><th>Tipe</th><th>Akun</th><th>Nama akun</th><th>Keterangan</th><th>Pihak</th><th className="n">Debit</th><th className="n">Kredit</th><th className="n">{sign === -1 ? "Nilai (−Dr+Cr)" : "Dr − Cr"}</th>{extra ? <th /> : null}</tr>
        </thead>
        <tbody>
          {lines.map((g) => (
            <tr key={g.idx}>
              <td className="lbl">{tgl(g.date)}</td><td>{g.voucher}</td><td className="muted">{g.src.voucher_type}</td><td>{g.account}</td>
              <td>{g.src.account_name}</td><td style={{ maxWidth: 360 }}>{g.src.description}</td><td className="muted">{g.src.party}</td>
              <Td v={g.src.debit ?? null} dp={2} /><Td v={g.src.credit ?? null} dp={2} /><Td v={sign === -1 ? g.drCr.neg() : g.drCr} dp={2} />
              {extra ? <td>{extra(g)}</td> : null}
            </tr>
          ))}
          {lines.length > 0 ? (
            <tr className="total"><td colSpan={9}>Total ({lines.length} baris)</td><Td v={sign === -1 ? total.neg() : total} dp={2} />{extra ? <td /> : null}</tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
