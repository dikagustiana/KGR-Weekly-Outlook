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
import { moduleSettings, navModules } from "@/lib/modules";
import { jakartaToday } from "@kgr/engine";
import { V4Frame } from "./v4/Frame";
import { v4Nav, v4On } from "@/lib/v4/nav";
import { viewAsActive, viewAsItems } from "@/lib/v5/view-as";

const REPORTS: [string, string][] = [
  ["outlook", "Outlook"], ["stok", "Stok"], ["batch", "Batch RPA"], ["laba-rugi", "Laba Rugi"], ["neraca", "Neraca"],
  ["arus-kas", "Arus Kas"], ["kontrol", "Kontrol"], ["rilis", "Rilis"],
];
const INPUTS: [string, string, Role[] | null][] = [
  ["input/penjualan", "Penjualan", null], ["input/penerimaan", "Penerimaan", null], ["input/batch", "Batch", null],
  ["input/kas", "Rencana kas", null], ["input/parameter", "Parameter", null], ["input/harga", "Harga", null],
  ["input/runrate", "Run-rate", null], ["input/stok-awal", "Stok awal", null], ["upload", "Upload", null],
];

/** Map an old `active` key of a page to the v4 navigation item it belongs to. */
function v4Active(active: string): string | null {
  if (active === "minggu-ini") return "minggu-ini";
  if (active === "rencana" || active === "demand") return "rencana";
  if (active === "/hari") return "alokasi";
  if (active === "stok" || active.startsWith("/sku")) return "stok";
  if (active.startsWith("/komersial")) return active === "/komersial/approval" ? "approval" : active === "/komersial/scorecard" ? "scorecard" : "komersial";
  if (active === "rilis" || active === "kontrol" || active === "upload") return active;
  if (active === "/input") return "upload";
  if (active === "input/penjualan") return "pesanan";
  if (active === "input/batch") return "batch";
  if (active === "input/harga") return "harga";
  if (active === "input/parameter") return "supply-lb";
  if (active === "costing") return "costing";
  if (active.startsWith("admin")) return "admin";
  if (active === "/m" || active.startsWith("/m/") || active === "m4_monthly:Bulanan") return "outlook-bulan";
  if (active.startsWith("/kas")) return "kas";
  return null;
}

export async function Shell({
  viewer, weeks, week, active, children, banner,
}: { viewer: Viewer; weeks: WeekRow[]; week: WeekRow | null; active: string; children: ReactNode; banner?: ReactNode }) {
  const w = week?.week_start;
  const view = await currentView(viewer);
  // R13: the management view renders the reports only (no INPUT / ADMIN groups, Kontrol via the release line)
  const mgmt = view === "management";
  const settings = await moduleSettings();
  // PRD v4 irisan 1 (flag v4_design): one navigation row per role, the v4 visual grammar around every page
  if (v4On(settings, viewer.role)) {
    const nav = v4Nav(viewer.role, settings, { week: w ?? null, month: week ? week.update_date.slice(0, 7) : jakartaToday().slice(0, 7), today: jakartaToday() });
    return (
      <V4Frame
        nav={nav} active={v4Active(active)} view={view}
        viewAs={{ items: viewAsItems(viewer.role, settings, { week: w ?? null }), active: viewAsActive(active) }}
        period={w ? <WeekSelect weeks={weeks.map((x) => ({ start: x.week_start, end: x.week_end, status: x.status }))} current={w} active={active} longDates={mgmt} /> : null}
        account={<>
          {canToggleView(viewer.role) ? <Suspense fallback={null}><ViewToggle view={view} /></Suspense> : null}
          <span>{mgmt ? (viewer.fullName ? `${viewer.fullName} · ` : "") : `${viewer.fullName ?? viewer.email} · `}{ROLE_LABEL[viewer.role]}</span>
          <Link href={w ? `/akun?week=${w}` : "/akun"}>Akun</Link>
          <form action="/auth/signout" method="post"><button className="v4b">Keluar</button></form>
        </>}
      >
        {banner}
        {children}
      </V4Frame>
    );
  }
  // PRD v3 rule 5: only modules that are on, and only the pages the role may open
  const mods = navModules(settings, viewer.role, {
    week: w ?? null, month: week ? week.update_date.slice(0, 7) : jakartaToday().slice(0, 7), today: jakartaToday(),
  }, mgmt);
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
        {mods.length ? (
          <>
            <span className="sep" />
            <span className="grp">Modul</span>
            {mods.map((m) => (
              <Link key={m.href} href={m.href} className={active === m.href || active === m.module + ":" + m.label ? "on" : ""}>{m.label}</Link>
            ))}
          </>
        ) : null}
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
            {viewer.role === "admin" ? <Link href={`/admin/modul${w ? `?week=${w}` : ""}`} className={`inputs ${active === "admin/modul" ? "on" : ""}`}>Modul</Link> : null}
            <Link href={`/admin/audit${w ? `?week=${w}` : ""}`} className={`inputs ${active === "admin/audit" ? "on" : ""}`}>Audit</Link>
          </>
        ) : null}
      </nav>
      <main data-view={view}>{children}</main>
    </>
  );
}
