import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/session";
import { weeksCached } from "@/lib/data";
import { jakartaToday, mondayOf } from "@kgr/engine";

export const dynamic = "force-dynamic";

export default async function Home() {
  const viewer = await requireViewer();
  const weeks = await weeksCached();
  if (weeks.length === 0) redirect(viewer.role === "admin" ? "/admin/minggu" : "/kosong");
  const thisMonday = mondayOf(jakartaToday());
  const current = weeks.find((w) => w.week_start === thisMonday) ?? weeks.find((w) => w.status !== "closed") ?? weeks[0];
  redirect(`/w/${current.week_start}/outlook`);
}
