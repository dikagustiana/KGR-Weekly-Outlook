"use client";
import Link from "next/link";
import { useRef, type ReactNode } from "react";

export interface MenuLink { id: string; label: string; href: string }

/**
 * PRD v6 R136: the phone menu — a native <dialog> (focus trapped, Esc closes, focus back on the button) with the page
 * tabs, the account, "Lihat sebagai" when allowed, the release line and PDF, and Keluar.
 */
export function MobileMenu({ tabs, active, viewAs, viewAsActive, release, account }: {
  tabs: MenuLink[];
  active: string | null;
  viewAs: MenuLink[];
  viewAsActive: string | null;
  release?: ReactNode;
  account: ReactNode;
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => dlg.current?.close();
  return (
    <>
      <button ref={btn} type="button" className="v4b" aria-haspopup="dialog" onClick={() => dlg.current?.showModal()}>Menu</button>
      <dialog ref={dlg} className="mm" aria-label="Menu" onClose={() => btn.current?.focus()} onClick={(e) => { if (e.target === dlg.current) close(); }}>
        <div className="mm-h"><strong>KGR</strong><button type="button" className="v4b" onClick={close}>Tutup</button></div>
        <nav aria-label="Halaman" onClick={(e) => { if ((e.target as Element).closest("a")) close(); }}>
          {tabs.map((t) => <Link key={t.id} href={t.href} aria-current={t.id === active ? "page" : undefined}>{t.label}</Link>)}
        </nav>
        {release ? <><h2>Rilis</h2><div onClick={(e) => { if ((e.target as Element).closest("a")) close(); }}>{release}</div></> : null}
        {viewAs.length ? (
          <>
            <h2>Lihat sebagai</h2>
            <nav aria-label="Lihat sebagai" onClick={(e) => { if ((e.target as Element).closest("a")) close(); }}>
              {viewAs.map((t) => <Link key={t.id} href={t.href} aria-current={t.id === viewAsActive ? "page" : undefined}>{t.label}</Link>)}
            </nav>
          </>
        ) : null}
        <h2>Akun</h2>
        {account}
      </dialog>
    </>
  );
}
