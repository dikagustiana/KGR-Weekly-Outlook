"use client";
import { useEffect } from "react";

const SCROLLERS = ".tile-b, .t6-wrap";

/**
 * PRD v6 R172 / 2.1.1 (axe scrollable-region-focusable): a tile body or table that scrolls sideways (a wide table at
 * 390 px or 200 % zoom) can be reached and scrolled with the keyboard — it gets tabindex 0 and a name — and only while it
 * really overflows, so the Tab order does not grow with tiles that fit (T35).
 */
export function ScrollFocus() {
  useEffect(() => {
    const mark = () => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(SCROLLERS))) {
        const over = el.scrollWidth > el.clientWidth + 1 && !el.querySelector("a[href], button, input, select, textarea, [tabindex]");
        if (over && !el.hasAttribute("tabindex")) {
          const title = el.closest("[data-tile]")?.querySelector("[data-tile-title], .c6-t")?.textContent ?? "Tabel";
          el.tabIndex = 0;
          el.setAttribute("role", "region");
          el.setAttribute("aria-label", `${title} (geser ke samping)`);
          el.dataset.scrollFocus = "";
        } else if (!over && el.dataset.scrollFocus !== undefined) {
          el.removeAttribute("tabindex"); el.removeAttribute("role"); el.removeAttribute("aria-label"); delete el.dataset.scrollFocus;
        }
      }
    };
    mark();
    const ro = new ResizeObserver(mark);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  return null;
}
