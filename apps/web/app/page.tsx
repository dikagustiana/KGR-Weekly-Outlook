import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/session";
import { weeksCached } from "@/lib/data";
import { jakartaToday, mondayOf } from "@kgr/engine";
import { moduleSettings } from "@/lib/modules";
import { v4Home, v4On } from "@/lib/v4/nav";

export const dynamic = "force-dynamic";

export default async function Home() {
  const viewer = await requireViewer();
  const weeks = await weeksCached();
  if (weeks.length === 0) redirect(viewer.role === "admin" ? "/admin/minggu" : "/kosong");
  const thisMonday = mondayOf(jakartaToday());
  const current = weeks.find((w) => w.week_start === thisMonday) ?? weeks.find((w) => w.status !== "closed") ?? weeks[0];
  // PRD v4 §5.4 (flag v4_design): the first page of the role's workspace
  const settings = await moduleSettings();
  if (v4On(settings, viewer.role)) {
    const home = v4Home(viewer.role, settings, { week: current.week_start, month: current.update_date.slice(0, 7), today: jakartaToday() });
    if (home) redirect(home);
  }
  redirect(`/w/${current.week_start}/outlook`);
}
