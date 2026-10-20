"use client";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { WEEK_STATUS, weekHref, weekRange } from "@/lib/v6/week-label";

export interface PickWeek { start: string; end: string; status: string }

/**
 * PRD v6 K86 / R137: one button ("Minggu 24–30 Agu · rilis") that opens the list of weeks with their status. Up / Down
 * move, Home / End jump, Enter selects, Esc closes and returns focus to the button. Replaces the native <select> and the
 * week chip in the page body. `compact` = "24–30 Agu" (phone header).
 */
export function WeekPicker({ weeks, current, long = false, compact = false }: { weeks: PickWeek[]; current: string; long?: boolean; compact?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(() => Math.max(0, weeks.findIndex((w) => w.start === current)));
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const cur = weeks.find((w) => w.start === current);
  useEffect(() => { if (open) list.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && e.target !== btn.current) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const pick = (i: number) => {
    const w = weeks[i];
    setOpen(false);
    btn.current?.focus();
    if (w && w.start !== current) router.push(weekHref(path, current, w.start));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAct((a) => Math.min(weeks.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAct((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setAct(0); }
    else if (e.key === "End") { e.preventDefault(); setAct(weeks.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(act); }
    else if (e.key === "Escape" || e.key === "Tab") { if (e.key === "Escape") e.preventDefault(); setOpen(false); btn.current?.focus(); }
  };
  const label = cur ? `${compact ? "" : "Minggu "}${weekRange(cur.start, cur.end, long && !compact)}${compact ? "" : ` · ${WEEK_STATUS[cur.status] ?? cur.status}`}` : "Pilih minggu";
  return (
    <div className="wp">
      <button ref={btn} type="button" className="wp-btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-l` : undefined}
        aria-label={compact && cur ? `Minggu ${weekRange(cur.start, cur.end)}, ${WEEK_STATUS[cur.status] ?? cur.status}; ganti minggu` : undefined}
        onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}>
        {label}<span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul ref={list} id={`${id}-l`} role="listbox" className="wp-list" tabIndex={-1} aria-label="Pilih minggu" aria-activedescendant={`${id}-${act}`} onKeyDown={onKey}>
          {weeks.map((w, i) => (
            <li key={w.start} id={`${id}-${i}`} role="option" aria-selected={w.start === current} className={i === act ? "act" : undefined} onClick={() => pick(i)} onMouseEnter={() => setAct(i)}>
              <span>{weekRange(w.start, w.end, long)}</span><span className="st">{WEEK_STATUS[w.status] ?? w.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
