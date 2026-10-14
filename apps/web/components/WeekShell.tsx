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
  const banner = (
    <div className={`banner ${cls}`}>
      <span>Kontrol: <Badge s={c.overall === "ADA GAGAL" ? "GAGAL" : c.overall}>{c.overall}</Badge></span>
      <span>{c.counts.LULUS} LULUS · {c.counts.PERIKSA} PERIKSA · {c.counts["BELUM DIISI"]} BELUM DIISI · {c.counts.GAGAL} GAGAL</span>
      <Link href={`/w/${w.week_start}/kontrol`}>lihat kontrol</Link>
      <span className="muted">|</span>
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
