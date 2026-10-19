"use client";
import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * PRD v6 R145 / R169: while a panel is open, Tab cycles inside it, Esc closes it, everything outside is `inert` (the
 * page's <main>, header and nav), the page behind does not scroll; on close focus returns to the opener.
 */
export function useModalFocus(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void, opener: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const p = panel.current;
    if (!p) return;
    const outside = Array.from(document.body.children).filter((el) => !el.contains(p) && el instanceof HTMLElement) as HTMLElement[];
    // the panel lives inside the page's tree (rendered by a tile): mark the siblings on its path inert, not the path itself
    const inerted: HTMLElement[] = [];
    let node: HTMLElement | null = p;
    while (node && node.parentElement && node !== document.body) {
      for (const sib of Array.from(node.parentElement.children)) if (sib !== node && sib instanceof HTMLElement && !sib.inert && !sib.classList.contains("drawer-bg")) { sib.inert = true; inerted.push(sib); }
      node = node.parentElement;
    }
    for (const el of outside) if (!el.inert) { el.inert = true; inerted.push(el); }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    p.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const items = Array.from(p.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); p.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === p)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const back = opener.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      for (const el of inerted) el.inert = false;
      document.body.style.overflow = overflow;
      back?.focus();
    };
  }, [open, panel, onClose, opener]);
}
