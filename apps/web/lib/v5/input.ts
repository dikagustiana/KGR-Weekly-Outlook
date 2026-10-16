/**
 * Model of the Input screen v5 (PRD v5 §6.4; mockup reference/design/v5/Input.dc.html), pure: one screen for every
 * role that fills data in; the content follows the role (admin and management switch roles to look). The upload panel
 * itself is a client component (components/v5/UploadPanel.tsx) placed into the tile "panel".
 */
import { TASK_LABEL, UPLOAD_TEMPLATES, type CellStatus, type TaskRule, type TaskStatus, type UploadKindV5 } from "@kgr/engine";
import { ROLE_LABEL, type Role } from "../roles";
import { tglShort } from "../fmt";
import type { Col, TRow } from "@/components/v4/Table";
import type { TilePos } from "@/components/v4/Tile";
import type { TileModel } from "../v4/minggu-ini";

/** Upload kinds of the v5 template per role (§4.9 "Pemilik"; Kepala Sales may do what Sales may). */
export const ROLE_KINDS: Partial<Record<Role, UploadKindV5[]>> = {
  sales: ["po_lines"], commercial_lead: ["po_lines"], cost_accounting: ["costing_wp", "supplier_invoice"], ppic: ["yield_matrix"],
  purchasing: ["lb_supply"], finance: ["fixed_cost"],
  admin: ["po_lines", "costing_wp", "supplier_invoice", "yield_matrix", "lb_supply", "fixed_cost"],
};

/** Roles of the screen (§6.4: the mockup's four plus Inventory Accounting, Purchasing, Kepala Sales, Direktur Operasional). */
export const INPUT_ROLES: Role[] = ["cost_accounting", "sales", "commercial_lead", "ppic", "purchasing", "inventory_accounting", "finance", "operations_director"];

/** Who may look at another role's Input screen (read only for management, K37). */
export const canSwitchRole = (r: Role) => r === "admin" || r === "management";
/** The role whose screen a viewer sees: their own, or the one admin / management picked. */
export function shownRole(viewer: Role, asked: string | null | undefined): Role {
  if (canSwitchRole(viewer)) return INPUT_ROLES.includes(asked as Role) ? (asked as Role) : "finance";
  return viewer;
}
/** Kepala Sales also owns the PO task of Sales; admin none (it switches role). */
export function rulesOfRole(rules: TaskRule[], role: Role): string[] {
  const roles = role === "commercial_lead" ? ["commercial_lead", "sales"] : [role];
  return rules.filter((r) => roles.includes(r.owner_role)).map((r) => r.kind);
}

export interface InputTaskLine { kind: string; ref: string; title: string; status: TaskStatus; due: string; impact: string }
export interface InputCard { title: string; value: string; sub: string; tone: "plain" | "warn" | "bad" }
export interface HistoryLine { at: string; what: string; result: string; tone: "ok" | "warn" | "bad" }
export interface ParamLine { label: string; unit: string; value: string; href: string | null }
export interface GridRow { kind: string; title: string; owner: Role; cells: { date: string; status: CellStatus | null; note: string | null }[] }

export interface InputV5Input {
  today: string;
  time: string;
  viewerRole: Role;
  role: Role;
  /** ?panel= : an upload kind, "grid", or null (the role's first). */
  panel: string | null;
  cutOffLb: string;
  cutOffFresh: string;
  roles: { role: Role; bad: number }[];
  tasks: InputTaskLine[];
  cards: InputCard[];
  history: HistoryLine[];
  params: ParamLine[];
  grid: { weekStart: string; days: string[]; rows: GridRow[]; override: { reason: string; by: string | null } | null } | null;
  kinds: UploadKindV5[];
}

const P = (x: number, y: number, w: number, h: number): TilePos => ({ x, y, w, h });
const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const day = (d: string) => `${DAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8, 10))}`;
const CELL: Record<CellStatus, string> = { passed: "✓ lolos", noted: "! catatan", late: "✕ terlambat", not_due: "belum jatuh tempo" };
const TONE = { plain: undefined, warn: undefined, bad: "worse" } as const;
const KIND_LABEL: Record<UploadKindV5, string> = {
  po_lines: "PO", costing_wp: "WP potong", yield_matrix: "Yield per kelas", lb_supply: "Supply LB per kelas", fixed_cost: "Jadwal beban tetap", supplier_invoice: "Faktur pemasok",
};
export const kindLabel = (k: UploadKindV5) => KIND_LABEL[k];

/** Which panel the tile shows: the grid (Finance's default), an upload kind of the role, or a note. */
export function panelOf(x: Pick<InputV5Input, "role" | "panel" | "kinds" | "grid">): { type: "grid" } | { type: "upload"; kind: UploadKindV5 } | { type: "none" } {
  if (x.panel === "grid" && x.grid) return { type: "grid" };
  const k = x.kinds.find((q) => q === x.panel);
  if (k) return { type: "upload", kind: k };
  if (x.role === "finance" && x.grid) return { type: "grid" };
  return x.kinds.length ? { type: "upload", kind: x.kinds[0] } : { type: "none" };
}

export function headlineOf(x: InputV5Input): { text: string; sub: string } {
  const late = x.tasks.filter((t) => t.status === "late");
  const noted = x.tasks.filter((t) => t.status === "received");
  const open = x.tasks.filter((t) => t.status === "open");
  if (x.role === "finance" && x.grid) {
    const red = x.grid.rows.filter((r) => r.cells.some((c) => c.status === "late"));
    if (red.length && !x.grid.override) return { text: `Rilis minggu ${tglShort(x.grid.weekStart)} tertahan: ${red.map((r) => r.title).join(", ")} lewat tenggat.`, sub: "Kelengkapan data dicek sebelum rilis. Merah = lewat tenggat, kuning = masuk dengan catatan." };
  }
  if (late.length) return { text: `${late.length} tugas terlambat: ${late.slice(0, 3).map((t) => t.title).join("; ")}.`, sub: late[0].impact };
  if (noted.length) return { text: `${noted.length} input masuk dengan catatan: ${noted.slice(0, 2).map((t) => t.title).join("; ")}.`, sub: noted[0].impact };
  if (open.length) return { text: `${open.length} tugas belum jatuh tempo; berikutnya ${open[0].title}.`, sub: open[0].due };
  return { text: `Semua input ${ROLE_LABEL[x.role]} lolos cek.`, sub: "Tidak ada tugas yang terbuka." };
}

export function inputV5Model(x: InputV5Input, base = "/input"): { title: string; tiles: TileModel[] } {
  const tiles: TileModel[] = [];
  const switching = canSwitchRole(x.viewerRole);
  const href = (q: Record<string, string | null>) => {
    const p = new URLSearchParams();
    if (switching) p.set("peran", x.role);
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, v); else p.delete(k);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  const roles = switching ? x.roles : x.roles.filter((r) => r.role === x.role);
  tiles.push({
    id: "peran", pos: P(0, 0, 9, 1), kind: "bare",
    content: {
      type: "slicer", label: switching ? "Role (lihat sebagai)" : "Role", current: x.role,
      options: roles.map((r) => ({ value: r.role, label: `${ROLE_LABEL[r.role]}${r.bad ? ` · ${r.bad} terlambat` : ""}`, href: switching ? `${base}?peran=${r.role}` : base })),
    },
  });
  tiles.push({ id: "hari", pos: P(9, 0, 3, 1), kind: "bare", content: { type: "headline", text: `${tglShort(x.today)} · ${x.time}. Cut-off pembelian LB ${x.cutOffLb} · cut-off fresh ${x.cutOffFresh}.` } });
  const h = headlineOf(x);
  tiles.push({ id: "headline", pos: P(0, 1, 12, 1), kind: "bare", content: { type: "headline", text: `${h.text} ${h.sub}` } });
  x.cards.slice(0, 4).forEach((c, i) => tiles.push({
    id: `c-${i}`, pos: P(i * 3, 2, 3, 2), kind: "card", title: c.title,
    content: { type: "card", value: c.value, compare: [{ label: c.sub, value: "", tone: TONE[c.tone] }] },
  }));

  // tasks: title, due, status (as text), impact; a task of an upload kind opens its panel
  const tcols: Col[] = [{ key: "t", label: "Tugas", kind: "key", wrap: true }, { key: "s", label: "Status" }, { key: "d", label: "Tenggat · dampak", kind: "sup", wrap: true }];
  const trows: TRow[] = x.tasks.slice(0, 8).map((t, i) => ({
    id: `${t.kind}-${t.ref}-${i}`, href: (x.kinds as string[]).includes(t.kind) ? href({ panel: t.kind }) : t.kind === "release_week" && x.grid ? href({ panel: "grid" }) : undefined,
    cells: { t: t.title, s: TASK_LABEL[t.status], d: `${t.due}. ${t.impact}` },
  }));
  tiles.push({ id: "tugas", pos: P(0, 4, 5, 5), kind: "tall", title: "Tugas saya · pilih untuk dikerjakan", content: { type: "table", cols: tcols, rows: trows } });

  const p = panelOf(x);
  if (p.type === "grid" && x.grid) {
    const g = x.grid;
    const cols: Col[] = [{ key: "k", label: "Input", kind: "key", wrap: true }, { key: "o", label: "Pemilik", kind: "sup" }, ...g.days.map((d) => ({ key: d, label: day(d) }))];
    const rows: TRow[] = g.rows.map((r) => ({ id: r.kind, cells: { k: r.title, o: ROLE_LABEL[r.owner], ...Object.fromEntries(r.cells.map((c) => [c.date, c.status ? `${CELL[c.status]}${c.note && c.status !== "passed" ? ` (${c.note})` : ""}` : ""])) } }));
    tiles.push({
      id: "panel", pos: P(5, 4, 7, 5), kind: "tall", title: `Kelengkapan data · ${tglShort(g.days[0])}–${tglShort(g.days[g.days.length - 1])}`,
      views: x.kinds.length ? [{ label: "Panel", current: "grid", options: [{ value: "grid", label: "Kelengkapan", href: href({ panel: "grid" }) }, ...x.kinds.map((k) => ({ value: k, label: `Upload ${KIND_LABEL[k]}`, href: href({ panel: k }) }))] }] : undefined,
      note: g.override ? `Override K35 tercatat: ${g.override.reason}${g.override.by ? ` (${g.override.by})` : ""}.` : "Rilis aktif bila tidak ada sel merah untuk minggu yang dirilis, atau sel merah sudah diberi alasan dan disetujui Finance (K35).",
      content: { type: "table", cols, rows },
    });
  } else if (p.type === "upload") {
    const views = x.kinds.length > 1 || x.grid ? [{ label: "Panel", current: p.kind, options: [...(x.grid ? [{ value: "grid", label: "Kelengkapan", href: href({ panel: "grid" }) }] : []), ...x.kinds.map((k) => ({ value: k, label: `Upload ${KIND_LABEL[k]}`, href: href({ panel: k }) }))] }] : undefined;
    tiles.push({ id: "panel", pos: P(5, 4, 7, 5), kind: "tall", title: `Upload dan cek · ${KIND_LABEL[p.kind]}`, views, note: UPLOAD_TEMPLATES[p.kind].hint, content: { type: "slot" } });
  } else {
    const items = x.role === "inventory_accounting"
      ? ["Jurnal Accurate, stok awal, kartu stok dan pengiriman diunggah lewat wizard v4 (§4.4) dari menu Upload; tugas dan status di kiri dihitung dari data itu."]
      : x.role === "operations_director" ? ["Keputusan harga dan volume LB per tanggal potong diisi di tile Parameter di bawah; Purchasing mengisi supply per kelas setelahnya."]
      : ["Peran ini tidak punya upload template v5."];
    tiles.push({ id: "panel", pos: P(5, 4, 7, 5), kind: "tall", title: "Upload dan cek", content: { type: "list", items } });
  }

  // parameters in effect and where they change today (§6.4 "Form parameter")
  const pcols: Col[] = [{ key: "l", label: "Parameter", kind: "key", wrap: true }, { key: "v", label: "Berlaku", num: true }, { key: "u", label: "Satuan", kind: "sup" }, { key: "w", label: "Ubah di" }];
  tiles.push({
    id: "parameter", pos: P(0, 9, 7, 3), kind: "tall", title: x.role === "operations_director" ? "Keputusan harga LB" : "Parameter yang berlaku",
    note: "Usulan dengan persetujuan Finance (O8: perubahan di atas 5% atau Rp 5 jt per minggu) belum dibangun; nilai diubah di halaman masing-masing.",
    content: x.params.length
      ? { type: "table", cols: pcols, rows: x.params.map((q, i) => ({ id: `p${i}`, href: q.href ?? undefined, cells: { l: q.label, v: q.value, u: q.unit, w: q.href ? "buka" : "" } })) }
      : { type: "list", items: [], empty: x.role === "operations_director" ? "" : "tidak ada parameter untuk peran ini" },
  });

  // history and who waits for this input
  const hcols: Col[] = [{ key: "a", label: "Waktu", kind: "sup" }, { key: "w", label: "Apa", kind: "key", wrap: true }, { key: "r", label: "Hasil", wrap: true }];
  tiles.push({
    id: "riwayat", pos: P(7, 9, 5, 3), kind: "tall", title: "Riwayat dan siapa yang menunggu",
    content: { type: "table", cols: hcols, rows: [...x.history.slice(0, 6).map((l, i) => ({ id: `h${i}`, cells: { a: l.at, w: l.what, r: l.result } })), ...waiting(x).map((w, i) => ({ id: `w${i}`, cells: { a: "Menunggu Anda", w: w.who, r: w.what } }))] },
  });
  tiles.push({ id: "catatan", pos: P(0, 12, 12, 1), kind: "bare", content: { type: "headline", text: "Status tugas dihitung dari data (bukan dicentang). Upload dicek di browser lalu dicek ulang di server sebelum disimpan; baris gagal ditahan dengan tindakannya." } });
  return { title: `Input · ${ROLE_LABEL[x.role]}`, tiles };
}

/** §3.2 hand-overs: who waits for this role's input while a task of it is open. */
const WAITING: Partial<Record<Role, { who: string; what: string }[]>> = {
  cost_accounting: [{ who: "Commercial", what: "biaya/kg untuk harga lantai" }, { who: "Manajemen", what: "GP RPA minggu ini untuk rilis" }],
  sales: [{ who: "PPIC", what: "ukuran karkas untuk beli LB 12.00" }],
  commercial_lead: [{ who: "PPIC", what: "komitmen terkunci untuk rencana Senin" }],
  ppic: [{ who: "Purchasing", what: "kebutuhan kg LB per kelas" }, { who: "Commercial", what: "surplus atau kekurangan minggu ini" }],
  purchasing: [{ who: "PPIC", what: "supply per kelas untuk salin ke batch" }],
  operations_director: [{ who: "Purchasing", what: "harga dan volume LB untuk potong besok" }],
  inventory_accounting: [{ who: "Finance", what: "jurnal harian untuk actual P&L" }],
  finance: [{ who: "Manajemen", what: "rilis mingguan" }],
};
function waiting(x: InputV5Input) {
  return x.tasks.some((t) => t.status === "late" || t.status === "open") ? WAITING[x.role] ?? [] : [];
}
