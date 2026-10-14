import Link from "next/link";
import { PNL_COLUMNS, type PnlColumn } from "@kgr/engine";
import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Card, Td } from "@/components/ui";
import { GlTable } from "@/components/GlTable";
import { tgl } from "@/lib/fmt";

export const dynamic = "force-dynamic";

const HEAD: Record<PnlColumn, string> = {
  lastWeek: "Minggu lalu\n(aktual)", actual: "Minggu ini\naktual s.d. kemarin", outlook: "Sisa minggu\n(outlook)", projection: "Proyeksi\nminggu ini",
  delta: "Δ vs\nminggu lalu", mtd: "Bulan berjalan\naktual (MTD)", mtdPlusOutlook: "MTD + sisa\nminggu",
};

export default async function PnlPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  const r = ctx.computed.result;
  const pnl = r.statements.pnl;
  const R = pnl.ranges;
  const col = (sp.col as PnlColumn) ?? "actual";
  const range = col === "lastWeek" ? R.lastWeek : col === "mtd" || col === "mtdPlusOutlook" ? R.mtd : R.actual;
  const drill = sp.line ? r.prepared.gl.filter((g) => g.plLine === sp.line && g.date !== null && g.date >= range[0] && g.date <= range[1]) : [];
  const tips: Record<PnlColumn, string> = {
    lastWeek: `−Σ (debit − kredit) jurnal ${tgl(R.lastWeek[0])} – ${tgl(R.lastWeek[1])}`,
    actual: `−Σ (debit − kredit) jurnal ${tgl(R.actual[0])} – ${tgl(R.actual[1])}`,
    outlook: `Order × harga (revenue), order × biaya rata-rata (COGS), run-rate × ${R.remainingDays}/${R.daysInMonth} hari + penyesuaian (lainnya)`,
    projection: "aktual + sisa minggu", delta: "proyeksi − minggu lalu",
    mtd: `−Σ jurnal ${tgl(R.mtd[0])} – ${tgl(R.mtd[1])}`, mtdPlusOutlook: "MTD + sisa minggu",
  };
  return (
    <WeekShell ctx={ctx} active="laba-rugi">
      <h1>Laba rugi mingguan (format P&amp;L deck) — Rp</h1>
      <p className="muted">Aktual = jurnal Accurate. Sisa minggu = order × harga (revenue), order × biaya rata-rata stok (COGS), run-rate untuk biaya lain. Biaya ditampilkan negatif. Klik angka aktual untuk melihat baris jurnal.</p>
      <Card>
        <div className="scroll">
          <table className="t">
            <thead><tr><th>Baris</th>{PNL_COLUMNS.map((c) => <th key={c} className="n">{HEAD[c]}</th>)}<th>Basis sisa minggu</th></tr></thead>
            <tbody>
              {pnl.lines.map((l) => (
                <tr key={l.line} className={l.kind === "total" ? "total" : l.kind === "ratio" ? "dim" : ""}>
                  <td className="lbl">{l.line}</td>
                  {PNL_COLUMNS.map((c) => {
                    const drillable = l.kind === "line" && (c === "lastWeek" || c === "actual" || c === "mtd");
                    if (l.kind === "ratio") return <Td key={c} v={l.values[c]} percent />;
                    return drillable ? (
                      <td key={c} className="n"><Link href={`?line=${encodeURIComponent(l.line)}&col=${c}#drill`}><Td.Inner v={l.values[c]} tip={tips[c]} /></Link></td>
                    ) : <Td key={c} v={l.values[c]} tip={tips[c]} />;
                  })}
                  <td className="muted" style={{ fontSize: 11 }}>{l.basis ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11 }}>Catatan: aktual = jurnal Accurate (tanggal SI/PI); blok 1 Outlook = pengiriman (DO). Jurnal akhir bulan (unbilled, penyesuaian) baru masuk setelah diposting.</p>
      </Card>
      {sp.line ? (
        <Card id="drill" title={`Baris jurnal: ${sp.line} · ${tgl(range[0])} – ${tgl(range[1])}`} extra={<Link href="?">tutup</Link>}>
          <GlTable lines={drill} sign={-1} />
        </Card>
      ) : null}
    </WeekShell>
  );
}
