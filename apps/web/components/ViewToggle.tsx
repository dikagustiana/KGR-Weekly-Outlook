"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { setViewMode } from "@/app/view/actions";
import type { ViewMode } from "@/lib/view";

/** Topbar switch for preparers: preview the management view and come back (R1). */
export function ViewToggle({ view }: { view: ViewMode }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const next = pathname + (sp.size ? `?${sp.toString()}` : "");
  const target: ViewMode = view === "management" ? "preparer" : "management";
  return (
    <form action={setViewMode} className="view-toggle">
      <input type="hidden" name="mode" value={target} />
      <input type="hidden" name="next" value={next} />
      <button className="b sec small" data-view={view}>
        {view === "management" ? "Kembali ke tampilan penyusun" : "Pratinjau tampilan manajemen"}
      </button>
    </form>
  );
}
