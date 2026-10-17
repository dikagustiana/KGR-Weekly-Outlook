import Link from "next/link";
import { notFound } from "next/navigation";
import { addDays, monthEnd } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { RekonsiliasiView } from "@/components/v5/RekonsiliasiView";
import { moduleSettings, requireModulePage } from "@/lib/modules";
import { moduleSettingsGlobal } from "@/lib/rebuild";
import { supabaseServer } from "@/lib/supabase";
import { releaseContext } from "@/lib/release";
import { monthStart } from "@/lib/v3/drivers";
import { loadRekonsiliasi } from "@/lib/v4/close";
import { monthName } from "@/lib/v4/outlook-bulan";
import { REKONSILIASI_ROLES, inFsReconScope } from "@/lib/v5/fs-recon";

export const dynamic = "force-dynamic";

/** PRD v5.2-A R69 /m/[month]/rekonsiliasi: the app's month against the FS (C59). Read only; the override is on Tutup buku. */
export default async function RekonsiliasiPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const first = monthStart(month);
  if (!first) notFound();
  const v = await requireModulePage("m4_monthly", [...REKONSILIASI_ROLES]);
  const { weeks, week } = await plainContext();
  const sb = await supabaseServer();
  const model = await loadRekonsiliasi(sb, first, moduleSettingsGlobal(await moduleSettings()));
  const rc = inFsReconScope(first) ? await releaseContext(sb, "month", `${first}:FINAL`, first, monthEnd(first)) : null;
  const override = rc?.overrides.find((o) => o.code === "C59") ?? null;
  const prev = addDays(first, -1).slice(0, 7), next = addDays(monthEnd(first), 1).slice(0, 7);
  return (
    <Shell viewer={v} weeks={weeks} week={week} active="/m">
      <h1 className="sr-only">Rekonsiliasi ke FS {monthName(first)}</h1>
      <nav className="seg" aria-label="Bulan">
        <span className="seg-l">Bulan</span>
        <Link href={`/m/${prev}/rekonsiliasi`}>{monthName(`${prev}-01`)}</Link>
        <Link href={`/m/${first.slice(0, 7)}/rekonsiliasi`} aria-current="true">{monthName(first)}</Link>
        <Link href={`/m/${next}/rekonsiliasi`}>{monthName(`${next}-01`)}</Link>
        <Link href={`/m/${first.slice(0, 7)}`}>Outlook bulan</Link>
      </nav>
      <RekonsiliasiView first={first} model={model} />
      {override ? (
        <div className="fin">
          <h2>Override C59</h2>
          <p className="muted">Finance mencatat override untuk FINAL {monthName(first)}: {override.reason} (bukti: {override.evidence}{override.created_role ? `, oleh ${override.created_role}` : ""}). C59 tetap tampil di atas; override hanya mengizinkan FINAL dikunci.</p>
        </div>
      ) : null}
    </Shell>
  );
}
