import Link from "next/link";
import { CF_CATEGORIES, type CfColumn } from "@kgr/engine";
import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Card, Td } from "@/components/ui";
import { GlTable } from "@/components/GlTable";
import { can } from "@/lib/roles";
import { tgl } from "@/lib/fmt";
import { setCfOverride } from "./actions";

export const dynamic = "force-dynamic";

export default async function CfPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  const r = ctx.computed.result;
  const cf = r.statements.cf;
  const p = r.prepared;
  const cols: [CfColumn, string][] = [["lastWeek", "Minggu lalu\n(aktual)"], ["actual", "Minggu ini\naktual s.d. kemarin"], ["outlook", "Sisa minggu\n(rencana)"], ["projection", "Proyeksi\nminggu ini"]];
  const ranges = { lastWeek: [r.statements.pnl.ranges.lastWeek[0], r.statements.pnl.ranges.lastWeek[1]], actual: [p.weekStart, r.statements.pnl.ranges.actual[1]] } as const;
  const cat = sp.cat;
  const col = (sp.col === "lastWeek" ? "lastWeek" : "actual") as "lastWeek" | "actual";
  const drill = cat ? p.gl.filter((g) => g.isCash && (cat === "?" ? g.cfCategory === "?" : g.cfCategory === cat) && g.date !== null && g.date >= ranges[col][0] && g.date <= ranges[col][1]) : [];
  const vouchers = new Set(drill.map((g) => g.voucher));
  const editable = can(ctx.viewer.role, "gl_override") && ctx.week.status !== "closed";
  const tie = cf.tieOut;
  return (
    <WeekShell ctx={ctx} active="arus-kas">
      <h1>Arus kas mingguan (metode langsung) — Rp</h1>
      <p className="muted">Aktual = baris kas di jurnal Accurate, dikategorikan dari akun lawan terbesar di voucher yang sama. Sisa minggu = rencana kas + pembayaran live bird / trading / angkut-maklon jatuh tempo (termin). Klik angka aktual untuk melihat voucher dan mengganti kategori.</p>
      <div className="grid2">
        <Card>
          <table className="t">
            <thead><tr><th>Kategori</th>{cols.map(([c, h]) => <th key={c} className="n">{h}</th>)}</tr></thead>
            <tbody>
              {cf.lines.map((l) => (
                <tr key={l.category}>
                  <td className="lbl">{l.category}</td>
                  {cols.map(([c]) => (c === "lastWeek" || c === "actual") ? (
                    <td key={c} className="n"><Link href={`?cat=${encodeURIComponent(l.category)}&col=${c}#drill`}><Td.Inner v={l.values[c]} tip="Σ baris kas dengan kategori ini (akun lawan → I_COA kolom F, atau override)" /></Link></td>
                  ) : <Td key={c} v={l.values[c]} tip={c === "outlook" ? "T_Kas_Rencana (hari ini s.d. akhir minggu) + pembayaran jatuh tempo dari rencana" : "aktual + sisa minggu"} />)}
                </tr>
              ))}
              <tr className="total"><td>ARUS KAS BERSIH</td>{cols.map(([c]) => <Td key={c} v={cf.net[c]} />)}</tr>
              <tr><td>Saldo kas awal</td>{cols.map(([c]) => <Td key={c} v={cf.opening[c]} tip="Neraca: kas akhir minggu lalu / kemarin" />)}</tr>
              <tr><td>Arus kas bersih</td>{cols.map(([c]) => <Td key={c} v={cf.net[c]} />)}</tr>
              <tr className="total"><td>Saldo kas akhir</td>{cols.map(([c]) => <Td key={c} v={cf.closing[c]} />)}</tr>
              <tr className="dim">
                <td>Kontrol: saldo kas akhir = neraca (harus 0)</td>
                <Td v={tie.lastWeek} className={tie.lastWeek.isZero() ? "" : "warn"} /><Td v={tie.actual} className={tie.actual.isZero() ? "" : "warn"} /><td /><Td v={tie.projection} className={tie.projection.isZero() ? "" : "warn"} />
              </tr>
            </tbody>
          </table>
          {p.gl.some((g) => g.isCash && g.cfCategory === "?") ? <p className="warn"><Link href="?cat=%3F#drill">Ada baris kas tanpa kategori (kontrol 17)</Link></p> : null}
        </Card>
        <Card title="Saldo kas harian — minggu ini">
          <table className="t compact">
            <thead><tr><th>Tanggal</th><th className="n">Arus kas bersih</th><th className="n">Saldo akhir hari</th><th>Basis</th></tr></thead>
            <tbody>
              {cf.daily.map((d) => (
                <tr key={d.date} className={d.date === cf.lowest.date ? "sub" : ""}>
                  <td className="lbl">{tgl(d.date, true)}</td>
                  <Td v={d.netFlow} tip={d.basis === "aktual" ? "Σ baris kas jurnal tanggal ini" : "rencana kas tanggal ini − LB/trading/angkut-maklon jatuh tempo"} />
                  <Td v={d.closing} /><td>{d.basis}</td>
                </tr>
              ))}
              <tr className="total"><td>Saldo kas terendah minggu ini</td><td /><Td v={cf.lowest.balance} tip={`pada ${tgl(cf.lowest.date)}`} /><td>{tgl(cf.lowest.date)}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>
      {cat ? (
        <Card id="drill" title={`Voucher kas: ${cat === "?" ? "tanpa kategori" : cat} · ${col === "lastWeek" ? "minggu lalu" : "minggu ini s.d. kemarin"} (${vouchers.size} voucher)`} extra={<Link href="?">tutup</Link>}>
          <GlTable
            lines={drill}
            extra={(g) => (
              <span className="row" style={{ gap: 4 }}>
                <span className="muted" title="akun lawan">↔ {g.counterAccount}</span>
                {editable ? (
                  <form action={setCfOverride} className="row" style={{ gap: 4 }}>
                    <input type="hidden" name="id" value={g.src.id ?? ""} /><input type="hidden" name="week" value={week} />
                    <select className="in" name="category" defaultValue={g.src.cf_override ?? ""}>
                      <option value="">(otomatis)</option>
                      {CF_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button className="b small sec">Simpan</button>
                  </form>
                ) : g.src.cf_override ? <span className="chip">override</span> : null}
              </span>
            )}
          />
        </Card>
      ) : null}
    </WeekShell>
  );
}
