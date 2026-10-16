import { notFound } from "next/navigation";
import { weekContext, type PageProps } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { TilePage } from "@/components/v4/TilePage";
import { moduleSettings } from "@/lib/modules";
import { v4On } from "@/lib/v4/nav";
import { loadMingguIni } from "@/lib/v4/minggu-ini-data";
import { mingguIniModel } from "@/lib/v4/minggu-ini";

export const dynamic = "force-dynamic";

/** PRD v4 §6.1 Manajemen · Minggu ini (flag v4_design). Read only; every number from the engine or the data marts. */
export default async function MingguIniPage({ params, searchParams }: PageProps) {
  const { week } = await params;
  const sp = await searchParams;
  const ctx = await weekContext(week);
  if (!v4On(await moduleSettings(), ctx.viewer.role)) notFound();
  const model = mingguIniModel(await loadMingguIni(ctx, sp));
  return (
    <Shell viewer={ctx.viewer} weeks={ctx.weeks} week={ctx.week} active="minggu-ini">
      <h1 className="sr-only">Minggu ini</h1>
      <TilePage tiles={model.tiles} label="Minggu ini" />
    </Shell>
  );
}
