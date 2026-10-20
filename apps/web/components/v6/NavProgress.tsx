"use client";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * PRD v6 R133: a 2 px bar above the shell from the click on an internal link until the new route renders, so a menu click
 * always answers within 100 ms. Listens to clicks in the capture phase (no change to the links themselves); hidden again
 * when the path or the query changes, or after 15 s.
 */
export function NavProgress() {
  const path = usePathname();
  const qs = useSearchParams();
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(false); }, [path, qs]);
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      if (url.pathname.startsWith("/api/")) return;
      setOn(true);
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, []);
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => setOn(false), 15_000);
    return () => clearTimeout(t);
  }, [on]);
  return <div className="navp" hidden={!on} aria-hidden="true" data-nav-progress=""><i /></div>;
}
