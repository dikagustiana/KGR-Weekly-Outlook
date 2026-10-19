import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import type { Viewer } from "@/lib/session";
import type { WeekRow } from "@/lib/data";
import type { V4NavItem } from "@/lib/v4/nav";
import { WeekPicker } from "./WeekPicker";
import { MobileMenu } from "./MobileMenu";
import { NavProgress } from "./NavProgress";
import { ScrollFocus } from "./ScrollFocus";
import { ViewToggle } from "../ViewToggle";
import type { ViewMode } from "@/lib/view";

export interface ReleaseInfo {
  /** "28 Agu 2026" */
  date: string | null;
  passed: number | null;
  total: number | null;
  pdfHref: string | null;
}

/** R135: up to six tabs show; with more, the fifth onward go into "Lainnya" (no horizontal scroll at 1280 / 1366 px). */
export function splitTabs<T>(tabs: T[], max = 6): { shown: T[]; more: T[] } {
  return tabs.length <= max ? { shown: tabs, more: [] } : { shown: tabs.slice(0, max - 1), more: tabs.slice(max - 1) };
}

function releaseLine(r: ReleaseInfo | null) {
  if (!r) return null;
  const parts = [r.date ? `Rilis ${r.date}` : "Belum dirilis"];
  if (r.passed !== null && r.total) parts.push(`${r.passed}/${r.total} kontrol lulus`);
  return <>{parts.join(" · ")}{r.pdfHref ? <> · <a href={r.pdfHref}>Unduh PDF</a></> : null}</>;
}

/**
 * PRD v6 K85 / K88 / R134–R136: the v6 header. Desktop (≥ 900 px): a context row (brand and WeekPicker · release line ·
 * name, role and the account menu) over the tab row (≤ 6 tabs, the rest under "Lainnya"). Phone: one row of brand, a
 * compact WeekPicker and the menu (<dialog>), at most 56 px. "Lihat sebagai" lives in the account menu, not in the nav.
 * The skip link is the first focusable element; the page is <main id="isi">. Nothing sits above the headline but this.
 */
export function Shell6({ viewer, weeks, week, tabs, active, view, viewAs, viewAsActive, release, canToggle, longDates, children, banner }: {
  viewer: Viewer;
  weeks: WeekRow[];
  week: WeekRow | null;
  tabs: V4NavItem[];
  active: string | null;
  view: ViewMode;
  viewAs: { id: string; label: string; href: string }[];
  viewAsActive: string | null;
  release: ReleaseInfo | null;
  canToggle: boolean;
  longDates: boolean;
  children: ReactNode;
  banner?: ReactNode;
}) {
  const w = week?.week_start ?? null;
  const pick = weeks.map((x) => ({ start: x.week_start, end: x.week_end, status: x.status }));
  const { shown, more } = splitTabs(tabs);
  const moreOn = more.some((t) => t.id === active);
  const who = view === "management" ? (viewer.fullName ?? "") : (viewer.fullName ?? viewer.email);
  const acctLinks = (
    <>
      <Link href={w ? `/akun?week=${w}` : "/akun"}>Akun</Link>
      {viewAs.length ? <><span className="lbl">Lihat sebagai</span>{viewAs.map((i) => <Link key={i.id} href={i.href} aria-current={i.id === viewAsActive ? "page" : undefined}>{i.label}</Link>)}</> : null}
      {canToggle ? <Suspense fallback={null}><ViewToggle view={view} /></Suspense> : null}
      <form action="/auth/signout" method="post"><button className="v4b link">Keluar</button></form>
    </>
  );
  return (
    <div className="v4 v6" data-shell="v6">
      <a className="skip" href="#isi">Lewati ke isi</a>
      <Suspense fallback={null}><NavProgress /></Suspense>
      <header className="v6-top">
        <div className="v6-ctx">
          <Link href="/" className="v6-brand">KGR</Link>
          {w ? <WeekPicker weeks={pick} current={w} long={longDates} /> : null}
          <p className="v6-rel" data-release-line="">{releaseLine(release)}</p>
          <div className="v6-acct">
            <span>{who ? `${who} · ` : ""}{viewer.role ? ROLE_NAME[viewer.role] ?? viewer.role : ""}</span>
            <details className="v6-more">
              <summary aria-label="Menu akun">Akun ▾</summary>
              <div className="v6-pop right">{acctLinks}</div>
            </details>
          </div>
        </div>
        <nav className="v6-tabs" aria-label="Halaman">
          {shown.map((t) => <Link key={t.id} href={t.href} aria-current={t.id === active ? "page" : undefined}>{t.label}</Link>)}
          {more.length ? (
            <details className={`v6-more${moreOn ? " on" : ""}`}>
              <summary>Lainnya ▾</summary>
              <div className="v6-pop">{more.map((t) => <Link key={t.id} href={t.href} aria-current={t.id === active ? "page" : undefined}>{t.label}</Link>)}</div>
            </details>
          ) : null}
        </nav>
        <div className="v6-mobile">
          <Link href="/" className="v6-brand">KGR</Link>
          {w ? <WeekPicker weeks={pick} current={w} compact /> : null}
          <MobileMenu tabs={tabs} active={active} viewAs={viewAs} viewAsActive={viewAsActive} release={release ? <p className="note">{releaseLine(release)}</p> : null}
            account={<div className="v6-pop" style={{ position: "static", boxShadow: "none" }}><span className="lbl">{who ? `${who} · ` : ""}{ROLE_NAME[viewer.role] ?? viewer.role}</span>{acctLinks}</div>} />
        </div>
      </header>
      {banner}
      <main id="isi" tabIndex={-1} className="v4-main v6-main" data-view={view}>{children}</main>
      <ScrollFocus />
    </div>
  );
}

/** K96: role names in Indonesian (the glossary's; lib/roles.ts ROLE_LABEL keeps the stored labels until irisan 5). */
const ROLE_NAME: Record<string, string> = {
  management: "Manajemen", operations_director: "Direktur Operasional", finance: "Keuangan", cost_accounting: "Akuntansi Biaya",
  inventory_accounting: "Akuntansi Persediaan", ppic: "PPIC", commercial_lead: "Kepala Sales", sales: "Sales", purchasing: "Pembelian", admin: "Admin",
};
