import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ROLE_LABEL, seesInputs, type Role } from "@/lib/roles";
import type { Viewer } from "@/lib/session";
import type { WeekRow } from "@/lib/data";
import { tgl } from "@/lib/fmt";
import { WeekSelect } from "./WeekSelect";
import { ViewToggle } from "./ViewToggle";
import { canToggleView } from "@/lib/view";
import { currentView } from "@/lib/view-server";

const REPORTS: [string, string][] = [
  ["outlook", "Outlook"], ["stok", "Stok"], ["batch", "Batch RPA"], ["laba-rugi", "Laba Rugi"], ["neraca", "Neraca"],
  ["arus-kas", "Arus Kas"], ["kontrol", "Kontrol"], ["rilis", "Rilis"],
];
const INPUTS: [string, string, Role[] | null][] = [
  ["input/penjualan", "Penjualan", null], ["input/penerimaan", "Penerimaan", null], ["input/batch", "Batch", null],
  ["input/kas", "Rencana kas", null], ["input/parameter", "Parameter", null], ["input/harga", "Harga", null],
  ["input/runrate", "Run-rate", null], ["input/stok-awal", "Stok awal", null], ["upload", "Upload", null],
];

export async function Shell({
  viewer, weeks, week, active, children, banner,
}: { viewer: Viewer; weeks: WeekRow[]; week: WeekRow | null; active: string; children: ReactNode; banner?: ReactNode }) {
  const w = week?.week_start;
  const view = await currentView(viewer);
  // R13: the management view renders the reports only (no INPUT / ADMIN groups, Kontrol via the release line)
  const mgmt = view === "management";
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">KGR Weekly Outlook</Link>
        {w ? <WeekSelect weeks={weeks.map((x) => ({ start: x.week_start, end: x.week_end, status: x.status }))} current={w} active={active} longDates={mgmt} /> : null}
        {week ? <span className="who">Update: <b>{tgl(week.update_date, !mgmt)}</b></span> : null}
        <span className="spacer" />
        {canToggleView(viewer.role) ? <Suspense fallback={null}><ViewToggle view={view} /></Suspense> : null}
        {/* R12: no e-mail in the management view, also when the account has no name */}
        <span className="who">{mgmt ? (viewer.fullName ? `${viewer.fullName} · ` : "") : `${viewer.fullName ?? viewer.email} · `}{ROLE_LABEL[viewer.role]}</span>
        <Link href={w ? `/akun?week=${w}` : "/akun"} className="who">Akun</Link>
        <form action="/auth/signout" method="post"><button className="b sec small">Keluar</button></form>
      </header>
      {banner}
      <nav className="nav">
        {w ? REPORTS.filter(([p]) => !(mgmt && p === "kontrol")).map(([p, l]) => (
          <Link key={p} href={`/w/${w}/${p}`} className={active === p ? "on" : ""}>{l}</Link>
        )) : null}
        {w && !mgmt && seesInputs(viewer.role) ? (
          <>
            <span className="sep inputs" />
            <span className="grp">Input</span>
            {INPUTS.filter(([, , r]) => !r || r.includes(viewer.role)).map(([p, l]) => (
              <Link key={p} href={`/w/${w}/${p}`} className={`inputs ${active === p ? "on" : ""}`}>{l}</Link>
            ))}
          </>
        ) : null}
        {!mgmt && (viewer.role === "admin" || viewer.role === "inventory_accounting" || viewer.role === "finance") ? (
          <>
            <span className="sep inputs" />
            <span className="grp">Admin</span>
            {viewer.role === "admin" ? <Link href={`/admin/minggu${w ? `?week=${w}` : ""}`} className={`inputs ${active === "admin/minggu" ? "on" : ""}`}>Minggu</Link> : null}
            <Link href={`/master/item${w ? `?week=${w}` : ""}`} className={`inputs ${active.startsWith("master") ? "on" : ""}`}>Master</Link>
            {viewer.role === "admin" ? <Link href={`/admin/pengguna${w ? `?week=${w}` : ""}`} className={`inputs ${active === "admin/pengguna" ? "on" : ""}`}>Pengguna</Link> : null}
            <Link href={`/admin/audit${w ? `?week=${w}` : ""}`} className={`inputs ${active === "admin/audit" ? "on" : ""}`}>Audit</Link>
          </>
        ) : null}
      </nav>
      <main data-view={view}>{children}</main>
    </>
  );
}
