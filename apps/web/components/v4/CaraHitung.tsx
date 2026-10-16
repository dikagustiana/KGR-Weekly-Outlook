"use client";
import { Fragment, useEffect, useRef, useState } from "react";

export interface CaraHitungContent {
  title: string;
  /** Engine function and the rule in words. */
  fn: string;
  rule: string;
  /** Source rows: table, upload or period. */
  sources: { label: string; value: string }[];
  basis?: string;
  period?: string;
  status?: string;
  link?: { href: string; label: string };
}

/**
 * CaraHitungDrawer (PRD v4 §5.3): rule, source rows and a link to the source page. Opened from the button in the tile
 * (Enter / Space), Esc closes it, focus goes back to the button.
 */
export function CaraHitung({ content, label = "cara hitung" }: { content: CaraHitungContent; label?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const close = () => { setOpen(false); btn.current?.focus(); };
  return (
    <>
      <button ref={btn} type="button" className="v4b link" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{label}</button>
      {open ? (
        <>
          <div className="drawer-bg" onClick={close} />
          <div ref={panel} className="drawer" role="dialog" aria-modal="true" aria-label={`Cara hitung: ${content.title}`} tabIndex={-1}>
            <h2>{content.title}</h2>
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
          </div>
        </>
      ) : null}
    </>
  );
}
