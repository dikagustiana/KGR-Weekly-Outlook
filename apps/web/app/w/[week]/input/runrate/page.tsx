import { PNL_COGS, PNL_DA, PNL_OPEX, PNL_OTHER } from "@kgr/engine";
import { weekContext, type PageProps } from "@/lib/page";
import { WeekShell } from "@/components/WeekShell";
import { Card, Msg, N } from "@/components/ui";
import { guardInputs } from "@/lib/inputPage";
import { can } from "@/lib/roles";
import { num } from "@/lib/fmt";
import { saveRunrate } from "./actions";

export const dynamic = "force-dynamic";

export default async function RunratePage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  guardInputs(ctx);
  const r = ctx.computed.result;
  const rr = new Map(r.prepared.runrate.map((x) => [x.plLine, x]));
  const lines = [...PNL_COGS.slice(2), ...PNL_OPEX, ...PNL_OTHER, PNL_DA];
  const edit = can(ctx.viewer.role, "runrate") && !(ctx.week.status === "closed" && ctx.viewer.role !== "admin");
  const R = r.statements.pnl.ranges;
  const f = (x: { toString(): string } | undefined) => (x === undefined ? "" : num(x.toString(), 0).replace(/\./g, ""));
  return (
    <WeekShell ctx={ctx} active="input/runrate">
      <h1>Run-rate biaya — untuk outlook laba rugi sisa minggu</h1>
      <p className="muted">Outlook = run-rate bulanan × (hari tersisa minggu ini ÷ hari dalam bulan) + penyesuaian minggu ini = × {R.remainingDays}/{R.daysInMonth}. Isi angka positif (biaya positif; Other Income: pendapatan positif). Setiap awal bulan perbarui dengan aktual bulan lalu.</p>
      {sp.ok ? <Msg kind="ok">{sp.ok}</Msg> : null}
      {sp.err ? <Msg kind="err">{sp.err}</Msg> : null}
      <form action={saveRunrate}>
        <input type="hidden" name="week" value={week} />
        <Card>
          <table className="t compact">
            <thead><tr><th>Baris laba rugi</th><th className="n">Run-rate bulanan Rp</th><th className="n">Penyesuaian minggu ini Rp</th><th>Basis</th><th className="n">Outlook sisa minggu</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const x = rr.get(l);
                return (
                  <tr key={l}>
                    <td className="lbl">{l}<input type="hidden" name="pl_line" value={l} /></td>
                    <td className="n">{edit ? <input className="in n" name={`m:${l}`} defaultValue={f(x?.monthly)} style={{ width: 130 }} /> : <N v={x?.monthly} />}</td>
                    <td className="n">{edit ? <input className="in n" name={`a:${l}`} defaultValue={f(x?.adjustment)} style={{ width: 120 }} /> : <N v={x?.adjustment} />}</td>
                    <td>{edit ? <input className="in" name={`b:${l}`} defaultValue={x?.basis ?? ""} style={{ width: 300 }} /> : x?.basis}</td>
                    <td className="n"><N v={r.statements.pnl.get(l).values.outlook} tip="−(run-rate × hari tersisa ÷ hari dalam bulan + penyesuaian); Other Income positif" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        {edit ? <button className="b">Simpan run-rate</button> : null}
      </form>
    </WeekShell>
  );
}
