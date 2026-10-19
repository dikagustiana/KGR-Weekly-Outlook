import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { weekContext, type PageProps } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { DecisionDialog } from "@/components/v6/DecisionDialog";
import { NumberInput } from "@/components/v6/NumberInput";
import { v6PagesOn, v6ShellOn } from "@/lib/v6/flags";
import { wallNow } from "@/lib/clock";
import { TilePage, hasHeadline } from "@/components/v4/TilePage";
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
  // PRD v6 irisan 5 (flag v6_pages): the cards carry the decided metric
  const model = mingguIniModel({ ...input, v6: await v6PagesOn() });
  // PRD v5 journey M (flag v5_management): the operations director decides the price tried in the simulation (K25)
  const extras: Record<string, ReactNode> = {};
  const m = input.v5Mgmt;
  if (m && ["admin", "operations_director"].includes(ctx.viewer.role)) {
    // PRD v6 K93 / R143: the decision is taken in a dialog that shows what is decided and its effect (T40)
    const cut = `${Number(m.sim.cutDate.slice(8, 10))}/${m.sim.cutDate.slice(5, 7)}`;
    const row = m.sim.result?.rows.find((x) => x.price.eq(m.sim.price)) ?? null;
    const base = m.sim.todayPrice ? m.sim.result?.rows.find((x) => x.price.eq(m.sim.todayPrice!)) ?? null : null;
    const jt = (v: { div: (n: number) => { toFixed: (d: number) => string } }) => num(v.div(1e6).toFixed(1), 1);
    const now = wallNow();
    extras["sim-lb"] = (
      <DecisionDialog action={decideLbPriceV5Action} opener={`Putuskan harga LB potong ${cut}`} title={`Keputusan harga live bird · potong ${cut}`} submit={`Putuskan Rp ${num(m.sim.price, 0)}`}
        hidden={{ date: m.sim.cutDate, price: m.sim.price.toFixed(0) }}
        rows={[
          { label: "Harga", value: `Rp ${num(m.sim.price, 0)}/kg LB` },
          { label: "Volume rencana", value: m.sim.result ? `${num(m.sim.result.kgLb, 0)} kg LB` : "belum ada basis" },
          { label: "GP rencana minggu", value: row ? `Rp ${jt(row.gp)} jt` : "tidak tersedia" },
          ...(row && base && !base.price.eq(row.price) ? [{ label: `Selisih vs harga hari ini (Rp ${num(base.price, 0)})`, value: `Rp ${jt(row.gp.minus(base.gp))} jt` }] : []),
          { label: "Pemutus", value: ctx.viewer.fullName ?? ctx.viewer.email },
          { label: "Waktu", value: `${now.date.slice(8, 10)}/${now.date.slice(5, 7)} ${now.time} WIB` },
        ]}>
        <label>Volume kg LB (opsional)<NumberInput name="volume" label="Volume kg LB" /></label>
      </DecisionDialog>
    );
  }
  const v6 = await v6ShellOn();
  return (
    <Shell viewer={ctx.viewer} weeks={ctx.weeks} week={ctx.week} active="minggu-ini">
      {v6 && hasHeadline(model.tiles) ? null : <h1 className="sr-only">Minggu ini</h1>}
      <TilePage tiles={model.tiles} label="Minggu ini" extras={extras} v6={v6} plainText={v6 && (await v6PagesOn())} />
    </Shell>
  );
}
