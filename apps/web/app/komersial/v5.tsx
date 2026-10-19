import { Shell } from "@/components/Shell";
import { moduleEnabled } from "@/lib/modules";
import { withSources } from "@/lib/v5/management";
import { periodOf, sourcesOf } from "@/lib/v5/management-data";
import { ActionForm } from "@/components/ActionForm";
import { TilePage, hasHeadline } from "@/components/v4/TilePage";
import { v6PagesOn, v6ShellOn } from "@/lib/v6/flags";
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
import { CommitmentForm } from "@/components/v5/CommitmentForm";
import { AssignmentLink } from "@/components/v5/AssignmentLink";
import { can } from "@/lib/roles";

/** PRD v5 §6.2 Commercial (flag v5_commercial): stock to sell, commitments for PPIC, PPIC's surplus, spot. */
export async function KomersialV5({ viewer, filter }: { viewer: Viewer; filter: StockFilter }) {
  const { weeks, week } = await plainContext();
  const sb = await supabaseServer();
  const mgmt = (await currentView(viewer)) === "management";
  const input = await loadKomersialV5(sb, viewer, filter);
  const pages = await v6PagesOn();
  const model0 = komersialV5Model({ ...input, v6: pages });
  // PRD v5 K36 (flag v5_management): the source label under the main numbers, read for the week shown (R76)
  const model = (await moduleEnabled("v5_management", viewer)) ? { ...model0, tiles: withSources(model0.tiles, await sourcesOf("commercial", sb, week ? periodOf(week.week_start, week.week_end, week.update_date) : undefined)) } : model0;
  const extras: Record<string, ReactNode> = {};
  // A7: Admin and Kepala Sales set up who sees which SKU (the card next to the approval queue)
  if (!mgmt && can(viewer.role, "sales_assignment")) extras["c-approval"] = <AssignmentLink />;
  const c = input.commitment;
  if (!mgmt && c.canEdit && c.rows.length) extras["t-komitmen"] = <CommitmentForm c={c} save={saveCommitmentsAction} lock={lockCommitmentsAction} />;
  // R56: the answer is about a surplus row of PPIC's saved plan — the key comes from that row, not from the screen
  // Q-v5.2-15: a Sales user answers a row of the view surplus_for_sales_v52 (their SKUs), of the week it was read for
  const forSales = input.surplusForSales ?? null;
  const surplus = input.ppic?.surplus ?? (forSales?.rows ?? []).filter((r) => r.kg !== null && Number(r.kg) > 0).map((r) => ({ key: r.key, kg: String(r.kg) }));
  const answerWeek = forSales ? forSales.weekStart : week?.week_start;
  if (!mgmt && (input.ppic || forSales) && surplus.length && c.canEdit && answerWeek) {
    extras["t-ppic"] = (
      <div className="actionbar">
        <ActionForm v4 action={answerSurplusAction} submit="Kirim jawaban ke PPIC" className="tile-form">
          <input type="hidden" name="week_start" value={answerWeek} />
          <select name="key" aria-label="SKU surplus">{surplus.map((r) => <option key={r.key} value={r.key}>{r.key.replace(/^RPA\|/, "")} · {num(r.kg, 0)} kg</option>)}</select>
          <select name="response" aria-label="jawaban surplus"><option value="absorb">Sanggup serap semua</option><option value="partial">Sanggup sebagian</option><option value="reduce">Tidak sanggup, kurangi potong</option></select>
          <input name="absorb_kg" size={6} placeholder="kg" aria-label="kg diserap" />
          <input name="price" size={7} placeholder="Rp/kg" aria-label="harga" />
        </ActionForm>
      </div>
    );
  }
  // spot sales are recorded on the clock's day (spotSaleAction): not from a screen that shows an older data date
  if (!mgmt && input.spot.length && ["admin", "sales", "commercial_lead"].includes(viewer.role) && input.spotToday) {
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
  const v6 = await v6ShellOn();
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="/komersial">
      {v6 && hasHeadline(model.tiles) ? null : <h1 className="sr-only">{model.title}</h1>}
      <TilePage tiles={model.tiles} label={model.title} extras={extras} v6={v6} plainText={v6 && pages} />
    </Shell>
  );
}
