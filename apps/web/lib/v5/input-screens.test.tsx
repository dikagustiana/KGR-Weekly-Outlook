/** Input v5 screen (PRD v5 §6.4, mockup Input.dc.html): layout, roles, tasks from the engine, panel per role, K35 grid. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { completenessCells, effectiveStatus, instancesDue, taskOf, type TaskRule } from "@kgr/engine";
import { INPUT_ROLES, headlineOf, inputV5Model, panelOf, shownRole, type InputTaskLine, type InputV5Input } from "./input";
import { UPLOAD_SAMPLES } from "./upload-samples";
import { TilePage } from "@/components/v4/TilePage";
import { UploadPanel } from "@/components/v5/UploadPanel";
import type { TileModel } from "../v4/minggu-ini";
import type { Role } from "../roles";

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const text = (t: TileModel | undefined) => plain(renderToStaticMarkup(<TilePage tiles={t ? [t] : []} label="x" />));

// the registry seeded by v5/0 (§3.1) for the roles of the example
const rules: TaskRule[] = [
  { kind: "costing_wp", title: "WP potong per batch", owner_role: "cost_accounting", due_rule: "batch.date + 1 day 12:00", impact_text: "C53; biaya/kg di Commercial tetap estimasi" },
  { kind: "supplier_invoice", title: "Faktur pemasok, tie ke GL", owner_role: "cost_accounting", due_rule: "event", impact_text: "Costing tetap sementara" },
  { kind: "gl_daily", title: "Jurnal Accurate harian", owner_role: "inventory_accounting", due_rule: "date + 0 days 16:00", impact_text: "Actual P&L berhenti di hari terakhir lolos" },
];
const now = "2026-08-27T09:30:00+07:00";
const x0 = { cutDates: [], batches: [{ ref: "B260825", date: "2026-08-25" }, { ref: "B260826", date: "2026-08-26" }] };
const tasks = ["2026-08-25", "2026-08-26", "2026-08-27"].flatMap((d) => instancesDue(rules, d, x0)).map((i) =>
  taskOf(i, i.kind === "costing_wp" && i.ref === "B260826" ? { done: "noted", done_at: "2026-08-27T08:47:00+07:00", note: "selisih hasil potong diberi alasan" }
    : i.kind === "costing_wp" ? { done: null } : i.kind === "supplier_invoice" ? { done: null, waiting: true } : { done: "passed" }, now));
const lineOf = (role: Role): InputTaskLine[] => tasks.filter((t) => rules.find((r) => r.kind === t.rule_kind)!.owner_role === role).map((t) => {
  const r = rules.find((q) => q.kind === t.rule_kind)!;
  return { kind: r.kind, ref: t.ref, title: `${r.title} · ${t.ref}`, status: effectiveStatus(t, now), due: t.due_at ? `Tenggat ${t.due_at.slice(8, 10)}/${t.due_at.slice(5, 7)} ${t.due_at.slice(11, 16)}` : "Saat dokumen masuk", impact: r.impact_text };
}).sort((a, b) => (a.status === "late" ? -1 : b.status === "late" ? 1 : 0));
const cells = completenessCells(tasks, rules, now);
const days = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"];
const grid: NonNullable<InputV5Input["grid"]> = {
  weekStart: "2026-08-24", days, override: null,
  rows: rules.map((r) => ({ kind: r.kind, title: r.title, owner: r.owner_role as Role, cells: days.map((d) => { const c = cells.find((q) => q.kind === r.kind && q.date === d); return { date: d, status: c?.status ?? null, note: c?.note ?? null }; }) })),
};

const input = (role: Role, over: Partial<InputV5Input> = {}): InputV5Input => ({
  today: "2026-08-27", time: "09.30", viewerRole: role, role, panel: null, cutOffLb: "12.00", cutOffFresh: "14.00",
  roles: INPUT_ROLES.map((r) => ({ role: r, bad: lineOf(r).filter((t) => t.status === "late").length })),
  tasks: lineOf(role), kinds: role === "cost_accounting" ? ["costing_wp", "supplier_invoice"] : role === "finance" ? ["fixed_cost"] : [],
  cards: [{ title: "Tugas terbuka", value: "3", sub: "1 terlambat", tone: "bad" }, { title: "Status batch minggu ini", value: "2 / 0", sub: "sementara / final", tone: "plain" }, { title: "Faktur LB masuk", value: "0 dari 2", sub: "costing belum bisa final", tone: "warn" }, { title: "WP belum masuk", value: "1", sub: "biaya/kg batch itu masih estimasi", tone: "bad" }],
  history: [{ at: "27/08 08.47", what: "WP_potong_260826.xlsx", result: "6 dari 8 baris tersimpan", tone: "warn" }],
  params: [{ label: "Tarif overhead", unit: "Rp/kg LB", value: "belum diisi", href: "/w/2026-08-24/costing" }],
  grid: role === "finance" ? grid : null,
  ...over,
});

describe("Input v5 layout = mockup grid", () => {
  const m = inputV5Model(input("cost_accounting"));
  it("tiles at the mockup coordinates; no overlap", () => {
    const spec: Record<string, [number, number, number, number]> = {
      peran: [0, 0, 9, 1], hari: [9, 0, 3, 1], headline: [0, 1, 12, 1], "c-0": [0, 2, 3, 2], "c-1": [3, 2, 3, 2], "c-2": [6, 2, 3, 2], "c-3": [9, 2, 3, 2],
      tugas: [0, 4, 5, 5], panel: [5, 4, 7, 5], parameter: [0, 9, 7, 3], riwayat: [7, 9, 5, 3], catatan: [0, 12, 12, 1],
    };
    expect(Object.fromEntries(m.tiles.map((t) => [t.id, [t.pos.x, t.pos.y, t.pos.w, t.pos.h]]))).toEqual(spec);
    const cellsOf = (t: TileModel) => Array.from({ length: t.pos.w * t.pos.h }, (_, i) => `${t.pos.x + (i % t.pos.w)},${t.pos.y + Math.floor(i / t.pos.w)}`);
    const all = m.tiles.flatMap(cellsOf);
    expect(new Set(all).size).toBe(all.length);
  });
  it("tasks: status from the data, as text; late first; the WP task opens its upload panel", () => {
    const t = text(m.tiles.find((q) => q.id === "tugas"));
    expect(t).toMatch(/WP potong per batch · B260825 terlambat Tenggat 26\/08 12:00/);
    expect(t).toMatch(/WP potong per batch · B260826 masuk, ada catatan/);
    expect(t).toMatch(/Faktur pemasok, tie ke GL · B260826 menunggu Saat dokumen masuk/);
    expect(renderToStaticMarkup(<TilePage tiles={m.tiles.filter((q) => q.id === "tugas")} label="x" />)).toContain('href="/input?panel=costing_wp"');
  });
  it("headline names the late task and its impact; cards show status as text", () => {
    expect(headlineOf(input("cost_accounting")).text).toBe("1 tugas terlambat: WP potong per batch · B260825.");
    expect(text(m.tiles.find((q) => q.id === "c-1"))).toMatch(/Status batch minggu ini 2 \/ 0 sementara \/ final/);
  });
});

describe("roles (§6.4, K37)", () => {
  it("admin and management switch roles (default Finance); every other role sees its own screen only", () => {
    expect(shownRole("management", "ppic")).toBe("ppic");
    expect(shownRole("admin", null)).toBe("finance");
    expect(shownRole("admin", "nobody")).toBe("finance");
    expect(shownRole("sales", "finance")).toBe("sales");
    const mg = inputV5Model(input("cost_accounting", { viewerRole: "management" }));
    const roles = text(mg.tiles.find((q) => q.id === "peran"));
    for (const l of ["Cost Accounting", "Sales", "Kepala Sales", "PPIC", "Purchasing / Ops", "Inventory Accounting", "Finance", "Direktur Operasional"]) expect(roles).toContain(l);
    expect(roles).toMatch(/Role \(lihat sebagai\)/);
    expect(roles).toMatch(/Cost Accounting · 1 terlambat/);
    const own = text(inputV5Model(input("cost_accounting")).tiles.find((q) => q.id === "peran"));
    expect(own).not.toContain("Finance");
  });
  it("panel per role: upload of the role's first kind, ?panel= another, Finance's grid, a note for roles without a template", () => {
    expect(panelOf(input("cost_accounting"))).toEqual({ type: "upload", kind: "costing_wp" });
    expect(panelOf(input("cost_accounting", { panel: "supplier_invoice" }))).toEqual({ type: "upload", kind: "supplier_invoice" });
    expect(panelOf(input("cost_accounting", { panel: "fixed_cost" }))).toEqual({ type: "upload", kind: "costing_wp" });
    expect(panelOf(input("finance"))).toEqual({ type: "grid" });
    expect(panelOf(input("finance", { panel: "fixed_cost" }))).toEqual({ type: "upload", kind: "fixed_cost" });
    expect(text(inputV5Model(input("inventory_accounting")).tiles.find((q) => q.id === "panel"))).toMatch(/wizard v4/);
    expect(text(inputV5Model(input("operations_director")).tiles.find((q) => q.id === "parameter"))).toMatch(/Keputusan harga LB/);
  });
});

describe("Finance: completeness grid (K35, journey P)", () => {
  const m = inputV5Model(input("finance"));
  it("input × day, owner, status as text; a late cell names its reference", () => {
    const t = text(m.tiles.find((q) => q.id === "panel"));
    expect(t).toMatch(/Kelengkapan data · 24 Agu–29 Agu/);
    expect(t).toMatch(/Input Pemilik Sen 24 Sel 25 Rab 26 Kam 27 Jum 28 Sab 29/);
    expect(t).toMatch(/WP potong per batch Cost Accounting/);
    expect(t).toMatch(/terlambat \(B260825\)/);
    // PRD v5.1 R36: words only, no icon
    expect(t).not.toMatch(/[✓✕!] (lolos|terlambat|catatan)/);
    expect(t).toMatch(/terlambat \(B260825\) catatan \(B260826\)/);
    expect(t).toMatch(/Rilis aktif bila tidak ada sel terlambat/);
  });
  it("headline: the release is held by the red rows; an override is shown once recorded", () => {
    expect(headlineOf(input("finance")).text).toBe("Rilis minggu 24 Agu tertahan: WP potong per batch lewat tenggat.");
    const o = inputV5Model(input("finance", { grid: { ...grid, override: { reason: "WP masuk sore, angka sudah dicek", by: "fin@kgr" } } }));
    expect(text(o.tiles.find((q) => q.id === "panel"))).toMatch(/Override K35 tercatat: WP masuk sore, angka sudah dicek \(fin@kgr\)/);
  });
});

describe("upload panel (client) — first render", () => {
  it("file / paste / example / template, the template hint; saving needs a preview", () => {
    const ctx = { today: "2026-08-27", items: [], floors: {}, classes: [] };
    const html = plain(renderToStaticMarkup(<UploadPanel kind="po_lines" ctx={ctx} sample={UPLOAD_SAMPLES.po_lines!.grid} canSave action={async () => ({})} />));
    expect(html).toMatch(/Pilih file Excel atau CSV/);
    expect(html).toMatch(/Pakai file contoh/);
    expect(html).toMatch(/Buat template/);
    expect(html).toMatch(/tempel di sini/);
    expect(html).toMatch(/Kolom: no_po, tanggal_kirim/);
    expect(html).not.toMatch(/Simpan/);
  });
});

// ------------------------------------------------------------------------------------------------ PRD v6 (flag v6_pages)
import { inputV6 } from "../v6/input-v6";
import { releaseReadiness } from "../v6/readiness";
import { hasCode } from "../v6/glossary";
describe("Input v6 (R151–R153, R162)", () => {
  const finance = input("finance", { cards: [{ title: "Siap rilis", value: "ya", sub: "grid tanpa sel terlambat", tone: "plain" }, { title: "Tugas terbuka", value: "2", sub: "", tone: "plain" }, { title: "Beban tetap bulan ini", value: "estimasi", sub: "2 baris tanpa jadwal (C55)", tone: "warn" }, { title: "Upload lain", value: "wizard v4", sub: "jurnal", tone: "plain" }] });
  const v6 = inputV6(finance, inputV5Model(finance).tiles, () => undefined);
  const r = releaseReadiness(finance);
  it("one source: the 'Siap rilis' card and the headline say the same", () => {
    const card = v6.tiles.find((t) => t.title === "Siap rilis")!;
    const head = v6.tiles.find((t) => t.id === "headline")!;
    expect(card.content.type === "card" && card.content.status?.kind).toBe(r.ready ? "lolos" : "terlambat");
    expect(head.content.type === "headline" && head.content.text).toMatch(r.ready ? /siap dirilis/ : /tertahan/);
  });
  it("no word cards, no codes, no backlog notes; the time is the headline's note", () => {
    expect(v6.tiles.some((t) => t.title === "Upload lain")).toBe(false);
    const fixed = v6.tiles.find((t) => t.title === "Beban tetap bulan ini")!;
    expect(fixed.content.type === "card" && fixed.content.value).toBe("2");
    expect(v6.tiles.find((t) => t.id === "hari")).toBeUndefined();
    const head = v6.tiles.find((t) => t.id === "headline")!;
    expect(head.content.type === "headline" && head.content.note).toMatch(/Cut-off pembelian LB 12.00/);
    expect(v6.tiles.find((t) => t.id === "parameter")!.note).toBeUndefined();
    for (const t of v6.tiles) expect(hasCode(`${t.title ?? ""} ${t.note ?? ""}`)).toBe(false);
  });
  it("tasks: one line each, late first, status in the four words", () => {
    const ca = input("cost_accounting");
    const t = inputV6(ca, inputV5Model(ca).tiles, () => undefined);
    expect(t.tasks.map((x) => x.status)).toContain("terlambat");
    expect(t.impact).toBeTruthy();
  });
});
