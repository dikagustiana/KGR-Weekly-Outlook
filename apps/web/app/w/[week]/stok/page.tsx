import Link from "next/link";
import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Badge, Card, N, Td } from "@/components/ui";
import { tglShort } from "@/lib/fmt";

export const dynamic = "force-dynamic";

export default async function StokPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  const r = ctx.computed.result;
  const seg = sp.segment ?? "";
  const st = sp.status ?? "";
  const q = (sp.q ?? "").toLowerCase();
  const rows = r.stock.rows.filter((s) =>
    (!seg || s.segment === seg) && (!st || s.status === st) && (!q || s.key.toLowerCase().includes(q)) && (sp.all === "1" || !s.openingKg.isZero() || !s.salesAndOrdersKg.isZero() || !s.receiptsKg.isZero()),
  );
  const qs = (o: Record<string, string>) => {
    const p = new URLSearchParams({ ...(seg ? { segment: seg } : {}), ...(st ? { status: st } : {}), ...(q ? { q } : {}), ...o });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `?${p.toString()}`;
  };
  const day = r.stock.days;
  return (
    <WeekShell ctx={ctx} active="stok">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Stok per hari dan daftar stok yang harus dijual</h1>
          <p className="muted">Stok akhir hari = stok kemarin + terima − jual. Hari yang sudah lewat pakai aktual; hari ini dan seterusnya pakai rencana terima + order.</p>
        </div>
        <a className="b sec" href={`/api/w/${week}/stok.csv`}>Ekspor CSV</a>
      </div>
      <Card>
        <form className="row noprint" method="get">
          <select className="in" name="segment" defaultValue={seg}><option value="">Semua segmen</option><option>RPA</option><option>Trading</option></select>
          <select className="in" name="status" defaultValue={st}>
            <option value="">Semua status</option><option value="KURANG">KURANG</option><option value="JUAL">JUAL</option>
            <option value="PERHATIAN">PERHATIAN</option><option value="CEK HARGA">Cek harga</option><option value="-">-</option>
          </select>
          <input className="in" name="q" placeholder="cari key…" defaultValue={sp.q ?? ""} />
          <label className="row" style={{ gap: 4 }}><input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} /> tampilkan key tanpa pergerakan</label>
          <button className="b small">Filter</button>
          {seg || st || q ? <Link href={`/w/${week}/stok`}>reset</Link> : null}
          <span className="muted">{rows.length} key</span>
        </form>
      </Card>
      <div className="scroll card">
        <table className="t compact">
          <thead>
            <tr>
              <th>Key</th><th>Kelompok</th><th className="n">Stok awal{"\n"}minggu kg</th><th className="n">Nilai stok{"\n"}awal Rp</th><th className="n">Umur rata{"\n"}-rata (hari)</th><th className="n">kg di atas{"\n"}batas umur</th>
              {day.map((d) => <th key={d} className="n">Akhir{"\n"}{tglShort(d)}</th>)}
              <th className="n">Terima{"\n"}minggu kg</th><th className="n">Nilai{"\n"}terima Rp</th><th className="n">Biaya rata{"\n"}-rata Rp/kg</th><th className="n">Jual + order{"\n"}minggu kg</th>
              <th className="n">Stok hari{"\n"}ini kg</th><th className="n">Order sisa{"\n"}minggu kg</th><th className="n">Stok −{"\n"}order kg</th><th className="n">Stok{"\n"}terendah kg</th>
              <th className="n">Harga{"\n"}acuan Rp/kg</th><th className="n">Margin/kg di{"\n"}harga acuan</th><th className="n">Nilai stok{"\n"}hari ini Rp</th><th>STATUS / TINDAKAN</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key}>
                <td className="lbl">{s.key}</td><td className="muted">{s.group}</td>
                <Td v={s.openingKg} dp={2} tip="I_Stok_Awal: Σ kg kode item dengan key ini" /><Td v={s.openingValue} tip="I_Stok_Awal: Σ nilai" />
                <Td v={s.avgAgeDays} dp={1} tip="rata-rata umur tertimbang kg" /><Td v={s.kgOverAgeLimit} dp={2} tip="I_Stok_Awal: kg di atas batas umur" />
                {s.closing.map((c, i) => <Td key={i} v={c} dp={2} tip={day[i] < r.week.today ? "stok kemarin + terima aktual − jual aktual" : "stok kemarin + terima (aktual + rencana) − jual (aktual + order)"} />)}
                <Td v={s.receiptsKg} dp={2} tip="T_Penerimaan: Σ kg dihitung" /><Td v={s.receiptsValue} />
                <Td v={s.avgCost} tip="(nilai stok awal + nilai terima) ÷ (kg stok awal + kg terima)" /><Td v={s.salesAndOrdersKg} dp={2} />
                <Td v={s.stockToday} dp={2} tip="stok akhir kemarin" /><Td v={s.ordersRestOfWeek} dp={2} tip="order hari ini s.d. akhir minggu" />
                <Td v={s.stockMinusOrders} dp={2} /><Td v={s.lowest} dp={2} tip="min stok akhir harian" />
                <td className="n">{s.refPrice === null ? <span className="warn">kosong</span> : <N v={s.refPrice} />}</td>
                <Td v={s.marginAtRef} tip="harga acuan − biaya rata-rata" /><Td v={s.valueToday} tip="stok hari ini × biaya rata-rata" />
                <td>{s.status === "-" ? <span className="muted">-</span> : <Badge s={s.status}>{s.statusText}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">Nilai negatif ditandai merah. Ekspor CSV memakai titik desimal (untuk Excel id-ID buka lewat Data → From Text).</p>
    </WeekShell>
  );
}
