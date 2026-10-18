import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { weekContext, type PageProps } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { TilePage } from "@/components/v4/TilePage";
import { moduleSettings } from "@/lib/modules";
import { requireViewer } from "@/lib/session";
import { mingguIniAllowed, v4On } from "@/lib/v4/nav";
import { loadMingguIni } from "@/lib/v4/minggu-ini-data";
import { mingguIniModel } from "@/lib/v4/minggu-ini";
import { num } from "@/lib/fmt";
import { decideLbPriceV5Action } from "../actions-v5";

export const dynamic = "force-dynamic";

/** PRD v4 §6.1 Manajemen · Minggu ini (flag v4_design). Read only; every number from the engine or the data marts. */
export default async function MingguIniPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  // PRD v5.1 K48 / R79: only the management roles and Finance, checked before anything heavy is loaded
  const viewer = await requireViewer();
  if (!mingguIniAllowed(viewer.role) || !v4On(await moduleSettings(), viewer.role)) notFound();
  const ctx = await weekContext(week);
  const input = await loadMingguIni(ctx, sp);
  const model = mingguIniModel(input);
  // PRD v5 journey M (flag v5_management): the operations director decides the price tried in the simulation (K25)
  const extras: Record<string, ReactNode> = {};
  const m = input.v5Mgmt;
  if (m && ["admin", "operations_director"].includes(ctx.viewer.role)) {
    extras["sim-lb"] = (
      <ActionForm v4="primary" action={decideLbPriceV5Action} submit={`Putuskan Rp ${num(m.sim.price, 0)} untuk potong ${Number(m.sim.cutDate.slice(8, 10))}/${m.sim.cutDate.slice(5, 7)}`} className="tile-form"
        confirm="Simpan keputusan harga LB? Keputusan tidak diubah; keputusan baru menggantikannya.">
        <input type="hidden" name="date" value={m.sim.cutDate} />
        <input type="hidden" name="price" value={m.sim.price.toFixed(0)} />
        <label>Volume kg LB <input name="volume" size={8} /></label>
        <input name="note" size={18} placeholder="catatan" aria-label="Catatan keputusan" />
      </ActionForm>
    );
  }
  return (
    <Shell viewer={ctx.viewer} weeks={ctx.weeks} week={ctx.week} active="minggu-ini">
      <h1 className="sr-only">Minggu ini</h1>
      <TilePage tiles={model.tiles} label="Minggu ini" extras={extras} />
    </Shell>
  );
}
