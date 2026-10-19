import { addDays, mondayOf, registeredClasses } from "@kgr/engine";
import type { ReactNode } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { ActionForm } from "@/components/ActionForm";
import { TilePage, hasHeadline } from "@/components/v4/TilePage";
import { v6PagesOn, v6ShellOn } from "@/lib/v6/flags";
import { UploadPanel } from "@/components/v5/UploadPanel";
import { plainContext } from "@/lib/page";
import { requireModulePage } from "@/lib/modules";
import { supabaseServer } from "@/lib/supabase";
import { loadInputScreen, uploadContext } from "@/lib/v5/input-data";
import { ROLE_KINDS, canSwitchRole, inputV5Model, panelOf, shownRole } from "@/lib/v5/input";
import { inputV6 } from "@/lib/v6/input-v6";
import { TaskList } from "@/components/v6/TaskList";
import { CompletenessGrid } from "@/components/v6/CompletenessGrid";
import { NumberInput } from "@/components/v6/NumberInput";
import { UPLOAD_SAMPLES } from "@/lib/v5/upload-samples";
import { mustRows } from "@/lib/loader";
import { decideLbPriceAction, k35OverrideAction, refreshTasksAction, remindAction, saveUploadAction } from "./actions";

export const dynamic = "force-dynamic";

/** PRD v5 §6.4 Input (flag v5_input): the tasks, uploads and parameters of a role; Finance's completeness grid (K35). */
export default async function InputPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const viewer = await requireModulePage("v5_input");
  const { weeks, week } = await plainContext();
  const role = shownRole(viewer.role, sp.peran);
  const sb = await supabaseServer();
  const input = await loadInputScreen(sb, viewer, role, sp.panel ?? null);
  const v5model = inputV5Model(input);
  // PRD v6 irisan 5 (flag v6_pages): one headline, numeric / Status cards, the v6 task list and grid
  const pages = await v6PagesOn();
  const taskHref = (kind: string) => {
    const q = new URLSearchParams();
    if (canSwitchRole(viewer.role)) q.set("peran", role);
    if ((input.kinds as string[]).includes(kind)) q.set("panel", kind);
    else if (kind === "release_week" && input.grid) q.set("panel", "grid");
    else return undefined;
    return `/input?${q.toString()}`;
  };
  const v6m = pages ? inputV6(input, v5model.tiles, taskHref) : null;
  const model = v6m ? { ...v5model, title: `Input · ${v5model.title.replace(/^Input · /, "")}`, tiles: v6m.tiles } : v5model;
  const p = panelOf(input);
  const mgmt = viewer.role === "management";
  const extras: Record<string, ReactNode> = {};

  // R77 (O23 (b)): the v4 wizard (budget, daily cash, the v4 fixed-cost schedule) is opened from the Finance panel, not from the nav
  const wizard = role === "finance" && ["admin", "finance"].includes(viewer.role) && input.uploadHref
    ? <Link className="v4b link" href={input.uploadHref} data-wizard-v4="">Upload v4: budget, kas harian, jadwal beban tetap (wizard)</Link> : null;
  if (p.type === "upload") {
    const canSave = !mgmt && (ROLE_KINDS[viewer.role] ?? []).includes(p.kind);
    // the context is the viewer's own (the save action builds it again for the same viewer)
    const ctx = await uploadContext(sb, viewer, p.kind);
    extras.panel = (
      <>
        <UploadPanel kind={p.kind} ctx={ctx} sample={UPLOAD_SAMPLES[p.kind]?.grid ?? null} canSave={canSave} action={saveUploadAction} v6={pages} />
        {wizard ? <div className="actionbar">{wizard}</div> : null}
      </>
    );
  }
  if (p.type === "grid" && input.grid && ["admin", "finance"].includes(viewer.role)) {
    const g = input.grid;
    const red = g.rows.some((r) => r.cells.some((c) => c.status === "late"));
    extras.panel = (
      <>
      {v6m?.grid ? <CompletenessGrid days={v6m.grid.days} rows={v6m.grid.rows} caption={v6m.grid.caption} /> : null}
      <div className="actionbar">
        <ActionForm v4="primary" action={remindAction} submit="Kirim pengingat ke pemilik" disabled={!red}>
          <input type="hidden" name="week_start" value={g.weekStart} /><input type="hidden" name="week_end" value={addDays(g.weekStart, 6)} />
        </ActionForm>
        {viewer.role === "finance" && red && !g.override ? (
          <ActionForm v4 action={k35OverrideAction} submit="Rilis dengan alasan" className="tile-form" confirm={pages ? "Catat rilis dengan pengecualian untuk minggu ini? Rilis tetap lewat halaman Rilis." : "Catat override K35 untuk minggu ini? Rilis tetap lewat halaman Rilis."}>
            <input type="hidden" name="week_start" value={g.weekStart} />
            <input name="reason" size={28} placeholder="alasan (min. 10 karakter)" aria-label="Alasan rilis dengan sel terlambat" required minLength={10} />
            <input name="evidence" size={12} placeholder="bukti" aria-label="Bukti" required minLength={3} />
          </ActionForm>
        ) : null}
        <Link className="v4b link" href={`/w/${g.weekStart}/rilis`}>Ke halaman Rilis</Link>
        {wizard}
      </div>
      </>
    );
  }
  if (p.type === "grid" && v6m?.grid && !extras.panel) extras.panel = <CompletenessGrid days={v6m.grid.days} rows={v6m.grid.rows} caption={v6m.grid.caption} />;
  if (role === "operations_director" && !mgmt && ["admin", "operations_director"].includes(viewer.role)) {
    const cls = mustRows(await sb.from("weight_class").select("code, min_kg, max_kg, avg_kg"), "input.weight_class");
    const reg = registeredClasses((cls as Record<string, unknown>[]).map((c) => ({ code: String(c.code), min_kg: (c.min_kg ?? null) as string | null, max_kg: (c.max_kg ?? null) as string | null, avg_kg: (c.avg_kg ?? null) as string | null })));
    extras.parameter = (
      <ActionForm v4="primary" action={decideLbPriceAction} submit="Simpan keputusan" className="tile-form" confirm="Simpan keputusan harga LB? Keputusan tidak diubah; keputusan baru menggantikannya.">
        <label>Tanggal potong <input name="date" type="date" defaultValue={addDays(input.today, 1)} required /></label>
        <label>Kelas <select name="weight_class" defaultValue=""><option value="">semua kelas</option>{reg.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        {pages ? <><label>Harga Rp/kg LB <NumberInput name="price" label="Harga live bird Rp/kg LB" size={8} /></label><label>Volume kg LB <NumberInput name="volume" label="Volume live bird kg" size={8} /></label></> : <>
        <label>Harga Rp/kg LB <input name="price" size={8} required /></label>
        <label>Volume kg LB <input name="volume" size={8} /></label></>}
        <input name="note" size={20} placeholder="catatan" aria-label="Catatan keputusan" />
      </ActionForm>
    );
  }
  const refresh = !mgmt && viewer.role !== "operations_director" ? <ActionForm v4 action={refreshTasksAction} submit="Perbarui status tugas" className="actionbar" /> : null;
  if (v6m) extras.tugas = <><TaskList tasks={v6m.tasks} impact={v6m.impact} />{refresh}</>;
  else if (refresh) extras.tugas = refresh;
  const v6 = await v6ShellOn();
  return (
    <Shell viewer={viewer} weeks={weeks} week={week ?? weeks.find((w) => w.week_start === mondayOf(input.today)) ?? null} active="/input">
      {v6 && hasHeadline(model.tiles) ? null : <h1 className="sr-only">{model.title}</h1>}
      <TilePage tiles={model.tiles} label={model.title} extras={extras} v6={v6} plainText={v6 && (await v6PagesOn())} />
    </Shell>
  );
}
