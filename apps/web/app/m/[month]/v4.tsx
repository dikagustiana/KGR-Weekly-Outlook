import { jakartaToday } from "@kgr/engine";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { TilePage } from "@/components/v4/TilePage";
import { plainContext } from "@/lib/page";
import { moduleSettings } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { currentView } from "@/lib/view-server";
import { loadOutlookBulan, type OutlookBulanExtra } from "@/lib/v4/outlook-bulan-data";
import { monthName, outlookBulanModel } from "@/lib/v4/outlook-bulan";
import { tglShort } from "@/lib/fmt";
import { agreeV4Action, budgetV4Action, cutOffV4Action, lockV4Action, rebuildMonthV4Action } from "./actions-v4";
import type { Viewer } from "@/lib/session";

/** PRD v4 §6.2 Manajemen · Outlook bulan (flag v4_design): tiles for everyone, the Finance panel only for Finance and Admin. */
export async function OutlookBulanV4({ first, viewer, versi }: { first: string; viewer: Viewer; versi: string | null }) {
  const { weeks, week } = await plainContext();
  const settings = await moduleSettings();
  const sb = await supabaseServer();
  const today = jakartaToday();
  const view = await currentView(viewer);
  const { input, extra } = await loadOutlookBulan(sb, { first, today, role: viewer.role, settings, selected: versi });
  const model = outlookBulanModel(input);
  const canAct = (viewer.role === "admin" || viewer.role === "finance") && view !== "management";
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/m">
      <h1 className="sr-only">{model.title}</h1>
      <TilePage tiles={model.tiles} label={model.title} />
      {canAct ? <FinancePanel first={first} extra={extra} cutOff={input.cutOff} hasRows={!!input.rows} /> : null}
    </Shell>
  );
}

function FinancePanel({ first, extra, cutOff, hasRows }: { first: string; extra: OutlookBulanExtra; cutOff: string; hasRows: boolean }) {
  const open = extra.registerIds.filter((r) => r.status !== "agreed");
  const reasonV1 = extra.hasV1 ? "V1 sudah dikunci" : !hasRows ? "bulan belum dibangun" : extra.blockers.length ? `${extra.blockers.length} hal menahan kunci V1` : null;
  const reasonV2 = extra.hasV2 ? "V2 sudah dikunci" : !extra.hasV1 ? "kunci V1 dulu" : null;
  const tot = new Map(extra.budgetRows.map((b) => [b.metric, String(b.value)]));
  return (
    <section className="fin" aria-label="Ruang kerja Finance">
      <h2>Finance · {monthName(first)}</h2>
      <div>
        <p className="muted">Kunci V1 pada Kamis {extra.lockDate ? tglShort(extra.lockDate) : "minggu yang ditetapkan"}; dasar rebuild terakhir {extra.builtAt ? tglShort(extra.builtAt.slice(0, 10)) : "belum ada"}.</p>
        {extra.blockers.length ? <ul>{extra.blockers.map((b) => <li key={b.code}>{b.text}</li>)}</ul> : <p className="muted">Tidak ada yang menahan kunci V1.</p>}
      </div>
      <div className="actionbar">
        <ActionForm v4="primary" action={lockV4Action} submit="Kunci V1" confirm="Kunci V1? Versi yang dikunci tidak bisa diubah." disabled={reasonV1 !== null}>
          <input type="hidden" name="month" value={first} /><input type="hidden" name="version" value="V1" />
        </ActionForm>
        {reasonV1 ? <span className="reason">{reasonV1}</span> : null}
        <ActionForm v4 action={lockV4Action} submit="Kunci V2" confirm="Kunci V2? Versi yang dikunci tidak bisa diubah." disabled={reasonV2 !== null}>
          <input type="hidden" name="month" value={first} /><input type="hidden" name="version" value="V2" />
        </ActionForm>
        {reasonV2 ? <span className="reason">{reasonV2}</span> : null}
        <ActionForm v4 action={rebuildMonthV4Action} submit="Bangun ulang"><input type="hidden" name="month" value={first} /></ActionForm>
      </div>
      <ActionForm v4 action={cutOffV4Action} submit="Simpan cut-off">
        <input type="hidden" name="month" value={first} />
        <label>Cut-off (kosong = otomatis, sekarang {tglShort(cutOff)}) <input name="cut_off_date" defaultValue={extra.cutOffOverride ?? ""} placeholder="YYYY-MM-DD" size={10} /></label>
      </ActionForm>
      <ActionForm v4 action={budgetV4Action} submit={extra.budgetVersion ? `Simpan budget (versi ${extra.budgetVersion + 1})` : "Simpan budget"}>
        <input type="hidden" name="month" value={first} />
        <label>Revenue <input name="budget_revenue" defaultValue={tot.get("revenue") ?? ""} size={14} /></label>
        <label>GP <input name="budget_gp" defaultValue={tot.get("gp") ?? ""} size={12} /></label>
        <label>Biaya <input name="budget_opex" defaultValue={tot.get("opex") ?? ""} size={12} /></label>
        <label>NIBT <input name="budget_nibt" defaultValue={tot.get("nibt") ?? ""} size={12} /></label>
        <label>kg <input name="budget_kg" defaultValue={tot.get("kg") ?? ""} size={10} /></label>
      </ActionForm>
      {open.length ? (
        <div>
          <p className="muted">Asumsi belum disepakati ({open.length}). Hari anomali butuh alasan.</p>
          <table>
            <tbody>
              {open.map((r) => (
                <tr key={r.id}><td>{r.code}</td><td>
                  <ActionForm v4 action={agreeV4Action} submit="Sepakati">
                    <input type="hidden" name="month" value={first} /><input type="hidden" name="id" value={r.id} />
                    {r.code.startsWith("anomaly_") ? <input name="note" placeholder="alasan hari anomali" size={36} /> : null}
                  </ActionForm>
                </td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
