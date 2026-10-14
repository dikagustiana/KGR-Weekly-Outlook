import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Card, Msg, N } from "@/components/ui";
import { guardInputs } from "@/lib/inputPage";
import { can } from "@/lib/roles";
import { num } from "@/lib/fmt";
import { savePrices } from "./actions";

export const dynamic = "force-dynamic";

export default async function HargaPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  guardInputs(ctx);
  const r = ctx.computed.result;
  const closed = ctx.week.status === "closed" && ctx.viewer.role !== "admin";
  const sell = can(ctx.viewer.role, "price_sell") && !closed;
  const buy = can(ctx.viewer.role, "price_buy") && !closed;
  // default suggestion: last 7 days' realised price per key (Aktual sales)
  const realised = new Map<string, { kg: number; v: number }>();
  for (const s of r.sales) {
    if (s.status !== "Aktual" || !s.date || s.date < r.prepared.weekStart) continue;
    const a = realised.get(s.key) ?? { kg: 0, v: 0 };
    a.kg += s.kg.toNumber(); a.v += s.value.toNumber();
    realised.set(s.key, a);
  }
  const cell = (x: { toString(): string } | null) => (x === null ? "" : num(x.toString(), 2).replace(/\./g, "").replace(/,00$/, ""));
  return (
    <WeekShell ctx={ctx} active="input/harga">
      <h1>Harga acuan — jual (Sales) dan beli pengganti (Purchasing)</h1>
      <p className="muted">Harga jual acuan = harga laku rata-rata 7 hari terakhir atau price list terbaru. Harga beli pengganti = harga beli terakhir / penawaran supplier (Trading). Harga disimpan per minggu.</p>
      {sp.ok ? <Msg kind="ok">{sp.ok}</Msg> : null}
      {sp.err ? <Msg kind="err">{sp.err}</Msg> : null}
      <form action={savePrices}>
        <input type="hidden" name="week" value={week} />
        <Card>
          <table className="t compact">
            <thead><tr><th>Key</th><th>Kelompok</th><th className="n">Harga jual acuan Rp/kg</th><th className="n">Harga beli pengganti Rp/kg</th><th className="n">Harga laku aktual minggu ini</th><th className="n">Biaya rata-rata stok</th></tr></thead>
            <tbody>
              {r.prepared.master.map((m) => {
                const rl = realised.get(m.key);
                const st = r.stock.byKey.get(m.key.toUpperCase());
                return (
                  <tr key={m.key}>
                    <td className="lbl">{m.key}<input type="hidden" name="key" value={m.key} /></td><td className="muted">{m.group}</td>
                    <td className="n">{sell ? <input className="in n" name={`sell:${m.key}`} defaultValue={cell(m.refPrice)} style={{ width: 110 }} /> : m.refPrice === null ? <span className="warn">kosong</span> : <N v={m.refPrice} />}</td>
                    <td className="n">{m.segment !== "Trading" ? <span className="muted">—</span> : buy ? <input className="in n" name={`buy:${m.key}`} defaultValue={cell(m.buyPrice)} style={{ width: 110 }} /> : m.buyPrice === null ? <span className="muted">kosong</span> : <N v={m.buyPrice} />}</td>
                    <td className="n">{rl && rl.kg > 0 ? <span className="tip" data-tip="Σ nilai ÷ Σ kg penjualan Aktual minggu ini">{num(rl.v / rl.kg, 0)}</span> : <span className="muted">—</span>}</td>
                    <td className="n">{st ? <N v={st.avgCost} tip="O_Stok biaya rata-rata" /> : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        {sell || buy ? <button className="b">Simpan harga</button> : null}
      </form>
    </WeekShell>
  );
}
