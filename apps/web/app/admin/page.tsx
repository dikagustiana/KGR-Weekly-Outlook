import Link from "next/link";
import { redirect } from "next/navigation";
import { jakartaToday } from "@kgr/engine";
import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { moduleSettings } from "@/lib/modules";
import { WORKSPACE, v4Nav } from "@/lib/v4/nav";
import { ROLES, ROLE_LABEL } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * Admin (PRD v4 §5.4, §6.8): the workspaces of every role (the admin navigation keeps 7 items) and the admin pages.
 */
export default async function AdminPage() {
  const { viewer, weeks, week } = await plainContext();
  if (viewer.role !== "admin") redirect("/");
  const settings = await moduleSettings();
  const ctx = { week: week?.week_start ?? null, month: week ? week.update_date.slice(0, 7) : jakartaToday().slice(0, 7), today: jakartaToday() };
  const q = week ? `?week=${week.week_start}` : "";
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="admin">
      <h1 className="headline">Admin</h1>
      <div className="tg">
        <section className="tile" style={{ gridColumn: "1 / span 4", gridRow: "1 / span 3" }}>
          <h2 className="tile-t">Pengaturan</h2>
          <ul>
            <li><Link href={`/admin/minggu${q}`}>Minggu</Link></li>
            <li><Link href={`/master/item${q}`}>Master (item, SKU, COA)</Link></li>
            <li><Link href={`/admin/pengguna${q}`}>Pengguna dan peran</Link></li>
            <li><Link href={`/admin/modul${q}`}>Modul dan antrian bangun ulang</Link></li>
            <li><Link href={`/admin/audit${q}`}>Audit</Link></li>
          </ul>
        </section>
        {ROLES.filter((r) => r !== "admin").map((r, i) => {
          const items = v4Nav(r, settings, ctx);
          return (
            <section key={r} className="tile" style={{ gridColumn: `${5 + (i % 2) * 4} / span 4`, gridRow: `${1 + Math.floor(i / 2) * 2} / span 2` }}>
              <h2 className="tile-t">{ROLE_LABEL[r]}</h2>
              {items.length ? <p>{items.map((n, j) => <span key={n.id}>{j ? " · " : ""}<Link href={n.href}>{n.label}</Link></span>)}</p> : <p className="note">semua halaman ruang kerja ini menunggu modulnya aktif ({WORKSPACE[r].length} halaman)</p>}
            </section>
          );
        })}
      </div>
    </Shell>
  );
}
