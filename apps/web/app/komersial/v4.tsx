import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { TilePage } from "@/components/v4/TilePage";
import { plainContext } from "@/lib/page";
import { moduleSettings } from "@/lib/modules";
import { isModuleOn } from "@/lib/modules-core";
import { supabaseServer } from "@/lib/supabase";
import { currentView } from "@/lib/view-server";
import { dataToday, fetchAll, listWeeks } from "@/lib/data";
import { commercialMart, computeCommercial } from "@/lib/v3/commercial";
import { assignedKeysFor, commercialView } from "@/lib/v3/commercial-view";
import { weekFloorControls } from "@/lib/v3/discount";
import { jakartaNow } from "@/lib/v3/allocation";
import { komersialModel, type ApprovalRow } from "@/lib/v4/komersial";
import { num } from "@/lib/fmt";
import type { Viewer } from "@/lib/session";
import type { ReactNode } from "react";
import { decideAction, orderFromApprovalAction, spotSaleAction } from "./actions";

type Row = Record<string, unknown>;

/** PRD v4 §6.7 Sales/Commercial · Komersial (flag v4_design): ranking, spot path (K8), approval queue, C38–C40. */
export async function KomersialV4({ viewer }: { viewer: Viewer }) {
  const { weeks, week } = await plainContext();
  const sb = await supabaseServer();
  const settings = await moduleSettings();
  const mgmt = (await currentView(viewer)) === "management";
  const now = jakartaNow();
  const today = await dataToday(sb, now.date);
  const sales = viewer.role === "sales";
  const mart = await commercialMart(sb, today, sales);
  const { data: asg } = await sb.from("sales_assignment").select("key").eq("active", true).ilike("email", viewer.email);
  const own = (asg ?? []) as { key: string | null }[];
  const todayWeek = (await listWeeks(sb)).find((w) => w.week_start <= today && w.week_end >= today) ?? null;
  const { data: par } = todayWeek ? await sb.from("parameter").select("sales_sees_cost, spot_enabled, cut_off_time").eq("week_id", todayWeek.id).maybeSingle() : { data: null };
  const p = (par ?? {}) as Row;
  const rows = commercialView(mart.rows, { role: viewer.role, salesSeesCost: p.sales_sees_cost !== false, assignedKeys: assignedKeysFor(viewer.role, own) });
  const approvalOn = isModuleOn(settings.m7_approval, viewer.role);
  const [reqs, lim] = approvalOn ? await Promise.all([
    fetchAll<Row>((a, b) => sb.from("discount_approval").select("*").order("created_at", { ascending: false }).limit(200).range(a, b)),
    sb.rpc("discount_limit"),
  ]) : [[] as Row[], { data: null }];
  const limit = Number(lim.data ?? 500);
  const mayDecide = (r: Row) => !mgmt && (viewer.role === "admin" || viewer.role === "finance" || (viewer.role === "commercial_lead" && Number(r.rp_per_kg_below) <= limit));
  const approvals: ApprovalRow[] = reqs.map((r) => ({
    id: String(r.id), key: String(r.key), customer: r.customer === null ? null : String(r.customer), requested_price: String(r.requested_price), floor_price: String(r.floor_price),
    rp_per_kg_below: String(r.rp_per_kg_below), kg: String(r.kg), total_below: String(r.total_below), status: String(r.status) as ApprovalRow["status"],
    used: !!r.sales_line_id || r.reason === "dipakai (baris tempel / upload)", mine: String(r.requested_by ?? "").toLowerCase() === viewer.email.toLowerCase(), mayDecide: mayDecide(r),
  }));
  const controls = !sales && !mgmt ? [
    ...(await computeCommercial(sb, today)).controls,
    ...(approvalOn && week ? await weekFloorControls(sb, week) : []),
  ].map((c) => ({ code: c.code, name: c.name, status: c.status, action: [c.action, c.detail.slice(0, 4).join(", ")].filter(Boolean).join(": ") })) : null;
  const model = komersialModel({
    today, date: mart.date, role: viewer.role, rows, unassigned: sales && own.length === 0, approvals, controls,
    spot: { enabled: p.spot_enabled === true, cutOffTime: String(p.cut_off_time ?? "14:00"), now: now.time, canRecord: !mgmt && ["admin", "sales", "commercial_lead"].includes(viewer.role) },
  });

  const extras: Record<string, ReactNode> = {};
  const spot = model.actions.find((a) => a.action === "spot");
  if (spot) {
    extras["t-spot"] = (
      <div className="actionbar">
        <ActionForm v4="primary" action={spotSaleAction} submit="Catat spot" disabled={spot.disabledReason !== null} className="tile-form">
          <select name="key" aria-label="SKU">{model.spotKeys.map((k) => <option key={k.key} value={k.key}>{k.key} · {num(k.free, 0)} kg{k.floor ? ` · lantai ${num(k.floor, 0)}` : ""}</option>)}</select>
          <input name="customer" size={14} placeholder="pelanggan" aria-label="Pelanggan" />
          <input name="kg" size={6} placeholder="kg" aria-label="kg" />
          <input name="price" size={8} placeholder="Rp/kg" aria-label="Harga Rp/kg" />
        </ActionForm>
        {spot.disabledReason ? <span className="reason">{spot.disabledReason}</span> : null}
      </div>
    );
  }
  const acts = model.actions.filter((a) => a.tile === "t-approval");
  if (acts.length) {
    const label = (id: string) => { const a = approvals.find((x) => x.id === id)!; return `${a.key}${a.customer ? ` · ${a.customer}` : ""} · ${num(a.kg, 0)} kg`; };
    extras["t-approval"] = (
      <div>
        {acts.map((a) => (
          <div className="actionbar" key={`${a.action}-${a.id}`}>
            <span className="note">{label(a.id)}</span>
            {a.action === "decide" ? <>
              <ActionForm v4 action={decideAction} submit="Setujui" disabled={a.disabledReason !== null}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="approve" /></ActionForm>
              <ActionForm v4 action={decideAction} submit="Tolak" disabled={a.disabledReason !== null}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="decision" value="reject" /><input name="reason" size={12} placeholder="alasan" aria-label="Alasan" /></ActionForm>
            </> : (
              <ActionForm v4="primary" action={orderFromApprovalAction} submit="Buat order" className="tile-form">
                <input type="hidden" name="id" value={a.id} />
                <input name="po_ref" size={10} placeholder="nomor PO" aria-label="Nomor PO" />
                <input name="delivery_date" size={10} placeholder="tgl kirim YYYY-MM-DD" aria-label="Tanggal kirim" />
              </ActionForm>
            )}
            {a.disabledReason ? <span className="reason">{a.disabledReason}</span> : null}
          </div>
        ))}
      </div>
    );
  }
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/komersial">
      <h1 className="sr-only">{model.title}</h1>
      <TilePage tiles={model.tiles} label={model.title} extras={extras} />
    </Shell>
  );
}
