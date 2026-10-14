import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Card, Msg, N } from "@/components/ui";
import { guardInputs } from "@/lib/inputPage";
import { can } from "@/lib/roles";
import { num } from "@/lib/fmt";
import { saveParameters } from "./actions";
import { PARAM_AREA } from "@/lib/params";

export const dynamic = "force-dynamic";

type F = [string, string, string, string, "pct" | "num" | "int"];
const MAIN: F[] = [
  ["horizon_fresh_days", "Horizon kebutuhan karkas fresh", "hari", "Order karkas fresh yang dihitung mulai hari ini (hari ini + 2 hari)", "int"],
  ["target_shrink", "Target shrink (kg dibeli → kg diproses)", "%", "Target susut 3% (placeholder)", "pct"],
  ["freight_plan_per_kg_lb", "Angkut live bird (rencana)", "Rp/kg LB", "Benchmark batch terbaik", "num"],
  ["maklon_per_kg_processed", "Maklon", "Rp/kg diproses", "Tarif ISA", "num"],
  ["lb_price_today", "Harga live bird hari ini (penawaran)", "Rp/kg", "Harga penawaran supplier untuk potong berikutnya (Purchasing)", "num"],
  ["min_trading_spread", "Spread minimum trading", "Rp/kg", "Selisih harga jual − beli minimum (placeholder Rp 2.000/kg)", "num"],
  ["stock_age_limit_days", "Batas umur stok", "hari", "Stok di atas umur ini masuk daftar harus dijual (placeholder 30)", "int"],
  ["terms_lb_days", "Termin bayar live bird", "hari", "0 = tunai saat potong (placeholder 7)", "int"],
  ["terms_trading_days", "Termin bayar pembelian trading", "hari", "placeholder 14", "int"],
  ["terms_freight_maklon_days", "Termin bayar angkut & maklon", "hari", "placeholder 30", "int"],
];
const YIELDS: [string, string][] = [["yield_karkas", "Karkas"], ["yield_kepala", "Kepala"], ["yield_ceker", "Ceker"], ["yield_usus", "Usus"], ["yield_hja", "HJA"], ["yield_lemak", "Lemak"]];

export default async function ParameterPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  guardInputs(ctx);
  const p = ctx.computed.loaded.db.parameter as Record<string, unknown>;
  const w = ctx.week;
  const r = ctx.computed.result;
  const role = ctx.viewer.role;
  const closed = w.status === "closed" && role !== "admin";
  const editable = (col: string) => !closed && can(role, PARAM_AREA[col]);
  const val = (col: string, kind: string) => {
    const x = p[col];
    if (x === null || x === undefined) return "";
    return kind === "pct" ? num(Number(x) * 100, 4).replace(/\./g, "").replace(/,?0+$/, "") : num(String(x), kind === "int" ? 0 : 2).replace(/\./g, "").replace(/,00$/, "");
  };
  const input = (col: string, kind: string) =>
    editable(col) ? <input className="in n" name={col} defaultValue={val(col, kind)} style={{ width: 120 }} inputMode="decimal" /> : <b>{val(col, kind) || "—"}</b>;
  const ya = r.prepared.yieldsActual;
  return (
    <WeekShell ctx={ctx} active="input/parameter">
      <h1>Parameter — diisi / dicek setiap pagi</h1>
      {sp.ok ? <Msg kind="ok">{sp.ok}</Msg> : null}
      {sp.err ? <Msg kind="err">{sp.err}</Msg> : null}
      {p.placeholder_note ? <Msg kind="info">{String(p.placeholder_note)}</Msg> : null}
      <form action={saveParameters}>
        <input type="hidden" name="week" value={week} />
        <div className="grid2">
          <Card title="Tanggal dan parameter">
            <table className="t compact">
              <thead><tr><th>Parameter</th><th className="n">Nilai</th><th>Satuan</th><th>Keterangan</th></tr></thead>
              <tbody>
                <tr><td>Tanggal update (hari ini)</td><td className="n">{can(role, "update_date") && !closed ? <input className="in" type="date" name="update_date" defaultValue={w.update_date} /> : <b>{w.update_date}</b>}</td><td>tanggal</td><td className="muted">Data aktual = transaksi sampai kemarin. Mengubah tanggal menggeser pembagian aktual/outlook.</td></tr>
                <tr><td>Awal minggu (Senin)</td><td className="n">{w.week_start}</td><td>tanggal</td><td className="muted">Minggu berjalan Senin–Minggu</td></tr>
                <tr><td>Akhir minggu (Minggu)</td><td className="n">{w.week_end}</td><td>tanggal</td><td /></tr>
                {MAIN.map(([c, l, u, k, kind]) => (
                  <tr key={c}><td>{l}</td><td className="n">{input(c, kind)}</td><td>{u}</td><td className="muted">{k}</td></tr>
                ))}
                <tr><td>Tanggal saldo awal (TB Accurate)</td><td className="n">{can(role, "parameter_all") ? <input className="in" type="date" name="tb_opening_date" defaultValue={w.tb_opening_date} /> : <b>{w.tb_opening_date}</b>}</td><td>tanggal</td><td className="muted">Jurnal yang dipakai = setelah tanggal ini sampai kemarin</td></tr>
              </tbody>
            </table>
          </Card>
          <div>
            <Card title="Yield (÷ kg diproses) — dipakai untuk breakeven dan kebutuhan potong">
              <table className="t compact">
                <thead><tr><th>Produk</th><th className="n">Dipakai</th><th className="n">Default %</th><th className="n">Aktual minggu ini</th></tr></thead>
                <tbody>
                  {YIELDS.map(([c, l]) => {
                    const k = c.replace("yield_", "") as keyof typeof r.prepared.yields;
                    return (
                      <tr key={c}><td>{l}</td><td className="n"><N v={r.prepared.yields[k]} percent dp={2} tip="aktual bila ada batch Aktual dengan kg diproses, selain itu default" /></td>
                        <td className="n">{input(c, "pct")}</td><td className="n">{ya ? <N v={ya[k]} percent dp={2} /> : <span className="muted">—</span>}</td></tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 11 }}>Default = rata-rata 12 batch Agustus 2026. Begitu ada batch Aktual di minggu ini, yield aktual minggu ini yang dipakai.</p>
            </Card>
            <Card title="Kontrol ke Accurate (dipakai kontrol 8 dan 9)">
              <table className="t compact">
                <tbody>
                  <tr><td>Total kg penjualan aktual minggu ini per laporan Accurate</td><td className="n">{input("accurate_sales_kg", "num")}</td><td>kg</td></tr>
                  <tr><td>Total nilai stok awal minggu per Inventory Valuation Accurate</td><td className="n">{input("accurate_opening_stock_value", "num")}</td><td>Rp</td></tr>
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 11 }}>Kosongkan kalau belum dicek (status BELUM DIISI).</p>
            </Card>
            <Card title="Minggu lalu — untuk pembanding blok 1">
              <table className="t compact">
                <thead><tr><th>Segmen</th><th className="n">kg terjual</th><th className="n">Revenue Rp</th><th className="n">GP produk Rp</th></tr></thead>
                <tbody>
                  {(["rpa", "trading"] as const).map((sgm) => (
                    <tr key={sgm}><td>{sgm === "rpa" ? "RPA" : "Trading"}</td>
                      {(["kg", "revenue", "gp"] as const).map((m) => {
                        const col = `lw_${sgm}_${m}` as keyof typeof w;
                        return <td key={m} className="n">{can(role, "parameter_all") ? <input className="in n" name={col} defaultValue={num(String(w[col]), m === "kg" ? 2 : 0).replace(/\./g, "")} style={{ width: 130 }} /> : num(String(w[col]))}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 11 }}>Sumber: {w.lw_source ?? "—"}. Rollover Senin mengisi otomatis dari snapshot rilis minggu lalu.</p>
            </Card>
          </div>
        </div>
        {!closed ? <button className="b">Simpan parameter</button> : <Msg kind="info">Minggu ditutup — hanya Admin yang dapat mengubah.</Msg>}
      </form>
    </WeekShell>
  );
}
