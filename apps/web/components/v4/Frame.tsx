import Link from "next/link";
import type { ReactNode } from "react";
import type { V4NavItem } from "@/lib/v4/nav";

/**
 * v4 shell (PRD v4 §5.4): one row of navigation per role (≤ 7 items), the period picker and the account on the
 * right. Pure: the server Shell decides the items. No e-mail in the management view (MV v2 R12).
 */
export function V4Frame({ nav, active, period, account, children, view, viewAs }: {
  nav: V4NavItem[];
  active: string | null;
  /** PRD v5 K37: "Lihat sebagai" links between the main screens the role may read. */
  viewAs?: { items: { id: string; label: string; href: string }[]; active: string | null };
  period?: ReactNode;
  account?: ReactNode;
  children: ReactNode;
  view?: string;
}) {
  return (
    <div className="v4">
      <header className="v4-top">
        <Link href="/" className="v4-brand">KGR</Link>
        <nav className="v4-nav" aria-label="Ruang kerja">
          {nav.map((n) => <Link key={n.id} href={n.href} aria-current={n.id === active ? "page" : undefined}>{n.label}</Link>)}
        </nav>
        {viewAs && viewAs.items.length ? (
          <nav className="viewas" aria-label="Lihat sebagai"><span>Lihat sebagai</span>{viewAs.items.map((i) => <Link key={i.id} href={i.href} aria-current={i.id === viewAs.active ? "page" : undefined}>{i.label}</Link>)}</nav>
        ) : null}
        {period}
        <div className="v4-user">{account}</div>
      </header>
      <main className="v4-main" data-view={view}>{children}</main>
    </div>
  );
}
