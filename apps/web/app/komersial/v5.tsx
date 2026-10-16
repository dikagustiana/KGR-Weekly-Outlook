import { Shell } from "@/components/Shell";
import { moduleEnabled } from "@/lib/modules";
import { withSources } from "@/lib/v5/management";
import { loadSources, sourcesFor } from "@/lib/v5/management-data";
import { jakartaNow } from "@/lib/v3/allocation";
import { ActionForm } from "@/components/ActionForm";
import { TilePage } from "@/components/v4/TilePage";
import { plainContext } from "@/lib/page";
import { supabaseServer } from "@/lib/supabase";
import { currentView } from "@/lib/view-server";
import { loadKomersialV5 } from "@/lib/v5/komersial-data";
import { komersialV5Model } from "@/lib/v5/komersial";
import { num } from "@/lib/fmt";
import type { Viewer } from "@/lib/session";
import type { StockFilter } from "@kgr/engine";
import type { ReactNode } from "react";
import { spotSaleAction } from "./actions";
import { answerSurplusAction, lockCommitmentsAction, saveCommitmentsAction } from "./actions-v5";

const nowWib = () => { const n = jakartaNow(); return `${n.date}T${n.time}:00+07:00`; };

/** PRD v5 §6.2 Commercial (flag v5_commercial): stock to sell, commitments for PPIC, PPIC's surplus, spot. */
export async function KomersialV5({ viewer, filter }: { viewer: Viewer; filter: StockFilter }) {
  const { weeks, week } = await plainContext();
  const sb = await supabaseServer();
  const mgmt = (await currentView(viewer)) === "management";
  const input = await loadKomersialV5(sb, viewer, filter);
  const model0 = komersialV5Model(input);
  // PRD v5 K36 (flag v5_management): the source label under the main numbers
  const model = (await moduleEnabled("v5_management", viewer)) ? { ...model0, tiles: withSources(model0.tiles, sourcesFor("commercial", await loadSources(sb, nowWib()))) } : model0;
  const extras: Record<string, ReactNode> = {};
  const c = input.commitment;
  const open = c.rows.some((r) => r.status !== "locked");
  if (!mgmt && c.canEdit && c.rows.length) {
    extras["t-komitmen"] = (
      <div className="actionbar">
        <ActionForm v4 action={saveCommitmentsAction} submit="Simpan draft" className="tile-form">
          <input type="hidden" name="week_start" value={c.weekStart} /><input type="hidden" name="n" value={c.rows.length} />
          {c.rows.map((r, i) => (
            <span key={r.key}>
              <input type="hidden" name={`key_${i}`} value={r.key} />
              <label>{r.key.split("|")[1]} fresh <input name={`fresh_${i}`} size={6} defaultValue={r.fresh ? num(r.fresh, 0) : ""} disabled={r.status === "locked" && !c.canLock} /></label>
              <label> frozen <input name={`frozen_${i}`} size={6} defaultValue={r.frozen ? num(r.frozen, 0) : ""} /></label>
              <label> harga <input name={`price_${i}`} size={7} defaultValue={r.price ? num(r.price, 0) : ""} /></label>
            </span>
          ))}
          <input name="reason" size={24} placeholder="alasan (wajib bila sudah dikunci)" aria-label="alasan versi baru" />
        </ActionForm>
        {c.canLock ? <ActionForm v4="primary" action={lockCommitmentsAction} submit="Kunci komitmen dan price list" disabled={!open} confirm="Kunci komitmen dan price list minggu depan? Perubahan sesudahnya menjadi versi baru dengan alasan."><input type="hidden" name="week_start" value={c.weekStart} /></ActionForm> : <span className="reason">Dikunci Kepala Sales.</span>}
      </div>
    );
  }
  if (!mgmt && input.ppic && input.ppic.surplusKg && input.ppic.surplusKg.gt(0) && c.canEdit && week) {
    extras["t-ppic"] = (
      <div className="actionbar">
        <ActionForm v4 action={answerSurplusAction} submit="Kirim jawaban ke PPIC" className="tile-form">
          <input type="hidden" name="week_start" value={week.week_start} /><input type="hidden" name="surplus_kg" value={input.ppic.surplusKg.toFixed(2)} />
          <select name="response" aria-label="jawaban surplus"><option value="absorb">Sanggup serap semua</option><option value="partial">Sanggup sebagian</option><option value="reduce">Tidak sanggup, kurangi potong</option></select>
          <input name="absorb_kg" size={6} placeholder="kg" aria-label="kg diserap" />
          <input name="price" size={7} placeholder="Rp/kg" aria-label="harga" />
        </ActionForm>
      </div>
    );
  }
  // spot sales are recorded on the clock's day (spotSaleAction): not from a screen that shows an older data date
  if (!mgmt && input.spot.length && ["admin", "sales", "commercial_lead"].includes(viewer.role) && input.today === jakartaNow().date) {
    extras["t-spot"] = (
      <div className="actionbar">
        <ActionForm v4="primary" action={spotSaleAction} submit="Catat spot" className="tile-form">
          <select name="key" aria-label="SKU">{input.spot.map((k) => <option key={k.key} value={k.key}>{k.key} · {num(k.free_kg, 0)} kg</option>)}</select>
          <input name="customer" size={14} placeholder="pelanggan" aria-label="Pelanggan" />
          <input name="kg" size={6} placeholder="kg" aria-label="kg" />
          <input name="price" size={8} placeholder="Rp/kg" aria-label="Harga Rp/kg" />
        </ActionForm>
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
