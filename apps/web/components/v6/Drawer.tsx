"use client";
import { Fragment, useCallback, useRef, useState } from "react";
import { useModalFocus } from "./focus-trap";
import type { CaraHitungContent } from "../v4/CaraHitung";

/**
 * PRD v6 R145: the "cara hitung" drawer (content and behaviour of v4 CaraHitung) with a focus trap, `inert` on the page
 * behind, scroll lock, Esc, and focus back on the opener. The opener's name is unique per tile ("Cara hitung Outlook
 * minggu", R170); `icon` renders it as the ⓘ of a card (R139).
 */
export function Drawer({ content, label, icon }: { content: CaraHitungContent; label?: string; icon?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useModalFocus(open, panel, close, btn);
  const name = label ?? `Cara hitung ${content.title}`;
  const titleId = `dr-${content.title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <>
      <button ref={btn} type="button" className={icon ? "info" : "v4b link"} aria-haspopup="dialog" aria-expanded={open} aria-label={icon ? name : undefined} onClick={() => setOpen(true)}>
        {icon ? <span aria-hidden="true">ⓘ</span> : "cara hitung"}
      </button>
      {open ? (
        <>
          <div className="drawer-bg" onClick={close} />
          <aside ref={panel} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
            <h2 id={titleId}>{content.title}</h2>
            <dl>
              <dt>Aturan</dt><dd>{content.rule}</dd>
              <dt>Fungsi</dt><dd><code>{content.fn}</code></dd>
              {content.period ? <><dt>Periode</dt><dd>{content.period}</dd></> : null}
              {content.basis ? <><dt>Basis</dt><dd>{content.basis}</dd></> : null}
              {content.status ? <><dt>Status</dt><dd>{content.status}</dd></> : null}
              {content.sources.map((s) => <Fragment key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></Fragment>)}
            </dl>
            {content.link ? <a href={content.link.href}>{content.link.label}</a> : null}
            <button type="button" className="v4b" onClick={close}>Tutup</button>
          </aside>
        </>
      ) : null}
    </>
  );
}
