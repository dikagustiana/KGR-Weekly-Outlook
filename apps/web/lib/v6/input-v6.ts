/**
 * PRD v6 R151–R153, R155, R162 (flag v6_pages): the Input screen in the v6 grammar, from the same input as v5 (pure).
 * One-sentence headline with the time and cut-offs as its note (K87); cards that are a number or a Status, never a word
 * ("ya", "estimasi", "wizard v4", "tidak ditampilkan"); "Siap rilis" from releaseReadiness, the same as the headline; the
 * task list and the completeness grid as v6 components (rendered by the page in the tiles' slots); no backlog notes.
 */
import { tglShort } from "../fmt";
import type { TileModel } from "../v4/minggu-ini";
import { ROLE_NAME, plain } from "./glossary";
import { releaseReadiness } from "./readiness";
import { headlineOf, type InputV5Input } from "../v5/input";
import type { StatusKind } from "./status-map";
import type { TaskItem } from "@/components/v6/TaskList";
import type { GridLine } from "@/components/v6/CompletenessGrid";

const TASK_KIND: Record<string, StatusKind> = { late: "terlambat", received: "catatan", open: "belum", waiting: "belum", passed: "lolos" };
const TASK_WORD: Record<string, string> = { late: "terlambat", received: "catatan", open: "belum", waiting: "menunggu", passed: "lolos" };
const CELL_KIND: Record<string, StatusKind> = { passed: "lolos", noted: "catatan", late: "terlambat", not_due: "belum" };
const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const day = (d: string) => `${DAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8, 10))}`;

/** R153: a card's word value → Status, or null to drop the card for this role. */
function cardState(title: string, value: string): { kind: StatusKind; text?: string } | "drop" | null {
  const v = value.trim().toLowerCase();
  if (v === "wizard v4" || v === "tidak ditampilkan") return "drop";
  if (["ya", "terisi", "lengkap", "jadwal"].includes(v)) return { kind: "lolos", text: v === "jadwal" ? "sesuai jadwal" : "lolos" };
  if (v === "placeholder") return { kind: "catatan", text: "angka contoh" };
  if (v === "belum") return { kind: "terlambat", text: "belum" };
  if (/^[\d.,\s−-]+(kg|dari \d+)?/i.test(v) || /^s\.d\. /.test(v) || v.startsWith("rp")) return null; // a number: keep it
  return null;
}

export interface InputV6 {
  tiles: TileModel[];
  tasks: TaskItem[];
  impact: string | null;
  grid: { days: { date: string; label: string }[]; rows: GridLine[]; caption: string } | null;
}

export function inputV6(x: InputV5Input, v5: TileModel[], taskHref: (kind: string) => string | undefined): InputV6 {
  const ready = releaseReadiness(x);
  const h = headlineOf(x);
  const late = x.tasks.filter((t) => t.status === "late");
  // R162: one sentence; the late tasks are listed in "Tugas saya", not again in the headline
  const text = x.role === "finance" && x.grid
    ? ready.ready ? `Minggu ${tglShort(x.grid.weekStart)} siap dirilis${ready.exception ? " dengan pengecualian yang tercatat" : ""}.` : `Rilis minggu ${tglShort(x.grid.weekStart)} tertahan: ${ready.reasons.length} input belum lengkap.`
    : late.length ? `${late.length} tugas ${ROLE_NAME[x.role]} terlambat.` : h.text;
  const tiles: TileModel[] = [];
  for (const t of v5) {
    if (t.id === "hari") continue; // K87: the time and cut-offs are the headline's note
    if (t.id === "headline") {
      tiles.push({ ...t, content: { type: "headline", text: plain(text), note: `${tglShort(x.today)} · ${x.time}. Cut-off pembelian LB ${x.cutOffLb} · cut-off fresh ${x.cutOffFresh}.` } });
      continue;
    }
    if (t.id === "peran" && t.content.type === "slicer") {
      tiles.push({ ...t, content: { ...t.content, options: t.content.options.map((o) => ({ ...o, label: o.label.replace(/^[^·]+/, (n) => (ROLE_NAME as Record<string, string>)[o.value] ? `${(ROLE_NAME as Record<string, string>)[o.value]} ` : n) })) } });
      continue;
    }
    if (t.kind === "card" && t.content.type === "card") {
      const i = Number(t.id.slice(2));
      const c = x.cards[i];
      if (!c) continue;
      if (c.title === "Siap rilis") {
        tiles.push({ ...t, note: ready.ready ? (ready.exception ? `pengecualian: ${ready.exception}` : "kelengkapan data harian tanpa sel terlambat") : ready.reasons.join("; "), content: { type: "card", value: null, compare: [], status: ready.ready ? { kind: "lolos", text: "siap" } : { kind: "terlambat", text: "tertahan" } } });
        continue;
      }
      if (c.title === "Beban tetap bulan ini") {
        const n = /^(\d+) baris/.exec(c.sub)?.[1];
        tiles.push({ ...t, note: n ? "diestimasi dari bulan lalu sampai Finance mengisi jadwal" : "jadwal Finance", content: n ? { type: "card", value: n, unit: "baris tanpa jadwal", compare: [] } : { type: "card", value: null, compare: [], status: { kind: "lolos", text: "sesuai jadwal" } } });
        continue;
      }
      const st = cardState(c.title, c.value);
      if (st === "drop") continue;
      tiles.push({ ...t, title: plain(c.title), note: plain(c.sub), content: st ? { type: "card", value: null, compare: [], status: st } : { type: "card", value: c.value, compare: [] } });
      continue;
    }
    if (t.id === "tugas") { tiles.push({ ...t, title: "Tugas saya", content: { type: "slot" } }); continue; }
    if (t.id === "panel" && x.grid && t.title?.startsWith("Kelengkapan")) { tiles.push({ ...t, title: `Kelengkapan data harian · ${tglShort(x.grid.days[0])}–${tglShort(x.grid.days[x.grid.days.length - 1])}`, note: x.grid.override ? `Rilis dengan pengecualian tercatat: ${x.grid.override.reason}.` : "Sel terlambat menahan rilis; catatan tidak.", content: { type: "slot" } }); continue; }
    if (t.id === "panel" && x.role === "inventory_accounting" && t.content.type === "table") {
      tiles.push({ ...t, note: "Tugas dan status di kiri dihitung dari data itu.", content: { ...t.content, cols: [{ key: "k", label: "Data", kind: "key" }, { key: "w", label: "Buka" }], rows: t.content.rows.map((r) => ({ ...r, cells: { ...r.cells, w: "Upload" } })) } });
      continue;
    }
    if (t.id === "parameter") { tiles.push({ ...t, note: undefined }); continue; } // R162: the backlog note goes
    if (t.id === "catatan") { tiles.push({ ...t, content: { type: "list", items: [] , empty: "Status tugas dihitung dari data, bukan dicentang. Upload dicek di browser lalu di server sebelum disimpan." } }); continue; }
    tiles.push(t);
  }
  const tasks: TaskItem[] = x.tasks.map((t, i) => ({
    id: `${t.kind}-${t.ref}-${i}`, title: plain(t.title), due: t.due, status: TASK_KIND[t.status] ?? "catatan", statusText: TASK_WORD[t.status], detail: plain(t.impact), href: taskHref(t.kind),
  }));
  const bad = x.tasks.find((t) => t.status === "late" || t.status === "received");
  const grid = x.grid ? {
    caption: "Kelengkapan data harian",
    days: x.grid.days.map((d) => ({ date: d, label: day(d) })),
    rows: x.grid.rows.map((r) => ({ id: r.kind, title: plain(r.title), owner: ROLE_NAME[r.owner], cells: r.cells.map((c) => ({ date: c.date, label: day(c.date), status: c.status ? CELL_KIND[c.status] : null, note: c.note ? plain(c.note) : null })) })),
  } : null;
  return { tiles, tasks, impact: bad ? plain(bad.impact) : null, grid };
}
