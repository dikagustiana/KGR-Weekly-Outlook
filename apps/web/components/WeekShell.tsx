import Link from "next/link";
import type { ReactNode } from "react";
import { Shell } from "./Shell";
import { Badge } from "./ui";
import type { WeekCtx } from "@/lib/page";
import { tgl } from "@/lib/fmt";

export function WeekShell({ ctx, active, children }: { ctx: WeekCtx; active: string; children: ReactNode }) {
  const c = ctx.computed.result.controls;
  const i = ctx.computed.loaded.inputs;
  const ops = [...i.sales_lines, ...i.receipt_lines, ...i.batches, ...i.opening_stock].filter((r) => r.source === "Ops").length;
  const cls = c.overall === "ADA GAGAL" ? "GAGAL" : c.overall;
  const w = ctx.week;
  if (ctx.view === "management") {
    // R12: one small grey line instead of the control bar — release date, controls passed, the open conditions; no e-mail.
    // The counts are those of the numbers on screen; when they differ from the frozen release, say so.
    const rel = ctx.lastRelease;
    const relCounts = rel?.controls?.counts;
    const sameAsRelease = !!relCounts && (["LULUS", "PERIKSA", "BELUM DIISI", "GAGAL"] as const).every((k) => (relCounts[k] ?? 0) === c.counts[k]);
    const parts = [rel ? `Rilis ${tgl(rel.update_date)}` : "Belum dirilis"];
    if (rel && !sameAsRelease) parts.push("data berubah sejak rilis");
    parts.push(`${c.counts.LULUS}/${c.controls.length} kontrol lulus`);
    if (c.counts["BELUM DIISI"]) parts.push(`${c.counts["BELUM DIISI"]} belum diisi`);
    if (c.counts.PERIKSA) parts.push(`${c.counts.PERIKSA} perlu diperiksa`);
    if (c.counts.GAGAL) parts.push(`${c.counts.GAGAL} gagal`);
    if (w.status === "closed") parts.push("minggu ditutup");
    return (
      <Shell viewer={ctx.viewer} weeks={ctx.weeks} week={w} active={active}
        banner={<div className="relline"><Link href={`/w/${w.week_start}/kontrol`} data-relline>{parts.join(" · ")}</Link></div>}>
        {children}
      </Shell>
    );
  }
  const banner = (
    <div className={`banner ${cls}`}>
      <span>Kontrol: <Badge s={c.overall === "ADA GAGAL" ? "GAGAL" : c.overall}>{c.overall}</Badge></span>
      <span>{c.counts.LULUS} LULUS · {c.counts.PERIKSA} PERIKSA · {c.counts["BELUM DIISI"]} BELUM DIISI · {c.counts.GAGAL} GAGAL</span>
      <Link href={`/w/${w.week_start}/kontrol`}>lihat kontrol</Link>
      <span className="muted desktop-only">|</span>
      {ctx.lastRelease ? (
        <span>Rilis terakhir: update {tgl(ctx.lastRelease.update_date)} oleh {ctx.lastRelease.released_by} ({new Date(ctx.lastRelease.released_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })})</span>
      ) : (
        <span className="muted">Belum dirilis</span>
      )}
      {ops > 0 ? <span className="muted">· {ops} baris masih bersumber Ops</span> : null}
      {w.opening_stock_flag ? <span className="warn">· Stok awal: {w.opening_stock_flag}</span> : null}
      {w.status === "closed" ? <span className="warn">· Minggu ditutup (hanya baca)</span> : null}
    </div>
  );
  return (
    <Shell viewer={ctx.viewer} weeks={ctx.weeks} week={w} active={active} banner={banner}>
      {children}
    </Shell>
  );
}
