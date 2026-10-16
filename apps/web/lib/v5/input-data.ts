import "server-only";
/**
 * Reads of the Input screen v5 (flag v5_input, PRD v5 §4.9, §6.4): the context of an upload (built here for the
 * browser's preview and built again by the save action — same function, so the fingerprints agree), the task and
 * completeness marts (written by the builder below, K17), and what each role's cards and history show.
 */
import {
  D, addDays, completenessCells, sum, effectiveCell, effectiveStatus, fixedNominals, instancesDue, mondayOf, registeredClasses, sizeKgOf, taskOf,
  type CellStatus, type CompletenessCell, type InputTask, type TaskFact, type TaskRule, type TaskStatus, type UploadContext, type UploadKindV5,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import type { Role } from "../roles";
import { fetchAll, listWeeks } from "../data";
import type { Row } from "../v3/uploads";
import { jakartaNow } from "../v3/allocation";
import { martReplace, registerBuilder } from "../rebuild-registry";
import { fixedSchedule } from "./pl";
import type { GridRow, HistoryLine, InputCard, InputTaskLine, InputV5Input, ParamLine } from "./input";
import { ROLE_KINDS, rulesOfRole } from "./input";
import { jtV4, num } from "../fmt";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const isOn = (v: unknown) => ((v as { enabled?: boolean } | null | undefined)?.enabled) === true;

export async function v5InputOn(sb: Supa): Promise<boolean> {
  const { data } = await sb.from("app_setting").select("value").eq("key", "v5_input").maybeSingle();
  return isOn((data as Row | null)?.value);
}

const nowIso = () => { const n = jakartaNow(); return `${n.date}T${n.time}:00+07:00`; };

/** Parameter row of the week holding `date` (the latest week otherwise). */
async function weekParams(sb: Supa, date: string): Promise<Row> {
  const weeks = await listWeeks(sb);
  const w = weeks.find((x) => x.week_start <= date && x.week_end >= date) ?? weeks[0];
  if (!w) return {};
  const { data } = await sb.from("parameter").select("*").eq("week_id", w.id).maybeSingle();
  return (data ?? {}) as Row;
}

// ------------------------------------------------------------------------------------------------ upload context

/** The context of `kind` for this viewer (PRD v5 §4.9): only what the checks of that kind read. */
export async function uploadContext(sb: Supa, viewer: Viewer, kind: UploadKindV5): Promise<UploadContext> {
  const today = jakartaNow().date;
  const [items, classes, par] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("item_map").select("item_code, item_name, key, size_kg").is("deleted_at", null).order("item_code").range(a, b)),
    sb.from("weight_class").select("code, min_kg, max_kg, avg_kg").order("sort_order"),
    weekParams(sb, today),
  ]);
  const ctx: UploadContext = {
    today,
    items: items.map((i) => ({ code: String(i.item_code), name: s(i.item_name), key: String(i.key), size_kg: s(i.size_kg) })),
    floors: null,
    classes: ((classes.data ?? []) as Row[]).map((c) => ({ code: String(c.code), min_kg: s(c.min_kg), max_kg: s(c.max_kg), avg_kg: s(c.avg_kg) })),
    yieldKarkas: { min: s(par.yield_karkas_min) ?? "0.68", max: s(par.yield_karkas_max) ?? "0.76" },
    shrinkTarget: s(par.target_shrink) ?? "0.03",
    tolerance: "0.02",
  };
  if (kind === "po_lines") {
    const sales = viewer.role === "sales";
    // floors = what the database guard compares with (commercial_daily.price_floor; v5/1: the cost per kg), hidden from
    // Sales when the week says so (v4 S2)
    if (!sales || par.sales_sees_cost !== false) {
      const { data: d } = await sb.from(sales ? "commercial_daily_sales" : "commercial_daily").select("date").lte("date", today).order("date", { ascending: false }).limit(1).maybeSingle();
      const date = s((d as Row | null)?.date);
      if (date) {
        const rows = await fetchAll<Row>((a, b) => sb.from(sales ? "commercial_daily_sales" : "commercial_daily").select("key, price_floor").eq("date", date).range(a, b)).catch(() => [] as Row[]);
        ctx.floors = Object.fromEntries(rows.filter((r) => s(r.price_floor)).map((r) => [String(r.key), String(r.price_floor)]));
      } else ctx.floors = {};
    }
    if (sales) {
      const { data: asg } = await sb.from("sales_assignment").select("customer").eq("active", true).ilike("email", viewer.email);
      const list = ((asg ?? []) as Row[]).map((a) => s(a.customer));
      ctx.customers = list.some((c) => c === null) ? "all" : (list as string[]);
    } else ctx.customers = "all";
  }
  if (kind === "costing_wp" || kind === "supplier_invoice") {
    const rows = await fetchAll<Row>((a, b) => sb.from("batch").select("batch_ref, date, lb_kg, status").is("deleted_at", null).is("superseded_at", null)
      .not("batch_ref", "is", null).gte("date", addDays(today, -60)).lte("date", addDays(today, 7)).order("date").range(a, b));
    const seen = new Set<string>();
    ctx.batches = [];
    // an actual batch wins over the planned one of the same reference
    for (const r of [...rows.filter((x) => x.status === "Aktual"), ...rows.filter((x) => x.status !== "Aktual")]) {
      const ref = String(r.batch_ref);
      if (seen.has(ref.toUpperCase())) continue;
      seen.add(ref.toUpperCase());
      ctx.batches.push({ ref, date: String(r.date), lb_kg: s(r.lb_kg), heads: null });
    }
    ctx.batches.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
  }
  if (kind === "supplier_invoice") {
    const gl = await fetchAll<Row>((a, b) => sb.from("gl_line").select("voucher_no, debit").eq("voucher_type", "Purchase Invoice").is("deleted_at", null).gte("date", addDays(today, -90)).range(a, b)).catch(() => [] as Row[]);
    const by = new Map<string, ReturnType<typeof D>>();
    for (const g of gl) if (s(g.voucher_no)) by.set(String(g.voucher_no), (by.get(String(g.voucher_no)) ?? D(0)).plus(D(s(g.debit) ?? "0")));
    ctx.glByDoc = Object.fromEntries([...by].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.toFixed(2)]));
  }
  if (kind === "fixed_cost") {
    const [coa, sched] = await Promise.all([
      fetchAll<Row>((a, b) => sb.from("coa_map").select("account").eq("driver_type", "fixed").is("deleted_at", null).order("account").range(a, b)),
      fetchAll<Row>((a, b) => sb.from("fixed_cost_schedule").select("code, account, start_date, end_date").eq("active", true).is("deleted_at", null).order("start_date").range(a, b)),
    ]);
    ctx.fixedAccounts = coa.map((c) => String(c.account));
    ctx.fixedSchedule = sched.map((r) => ({ code: s(r.code), account: s(r.account), start: String(r.start_date), end: s(r.end_date) }));
  }
  if (kind === "lb_supply") {
    const lead = Number(par.lead_time_days ?? 1);
    const rows = await fetchAll<Row>((a, b) => sb.from("demand_class_weekly").select("ship_date, weight_class, kg_lb").gte("ship_date", today).lte("ship_date", addDays(today, 14)).order("ship_date").range(a, b)).catch(() => [] as Row[]);
    ctx.classNeed = rows.map((r) => ({ date: addDays(String(r.ship_date), -lead), weight_class: String(r.weight_class), kg_lb: s(r.kg_lb) ?? "0" }));
  }
  return ctx;
}

// ------------------------------------------------------------------------------------------------ builder: tasks + grid

async function rules(sb: Supa): Promise<TaskRule[]> {
  const { data } = await sb.from("input_task_rule").select("kind, title, owner_role, due_rule, impact_text, active").order("kind");
  return ((data ?? []) as Row[]).map((r) => ({ kind: String(r.kind), title: String(r.title), owner_role: String(r.owner_role), due_rule: String(r.due_rule), impact_text: String(r.impact_text), active: r.active !== false }));
}

const exists = async (q: PromiseLike<{ count: number | null }>) => ((await q).count ?? 0) > 0;
type FactOf = (ref: string, anchor: string) => Promise<TaskFact>;

/** What the data says per rule kind (status from the data, never ticked by hand). */
function factReaders(sb: Supa): Record<string, FactOf> {
  const none: TaskFact = { done: null };
  return {
    commitment_lock: async (ref) => {
      const rows = ((await sb.from("sales_commitment").select("status").eq("week_start", ref).is("deleted_at", null).neq("status", "superseded")).data ?? []) as Row[];
      const locked = rows.filter((r) => r.status === "locked").length, drafts = rows.filter((r) => r.status === "draft").length;
      return !locked ? none : { done: drafts ? "noted" : "passed", note: drafts ? `${drafts} SKU masih draft` : null };
    },
    price_list_lock: async (ref) => {
      const rows = ((await sb.from("price_list_week").select("locked_at").eq("week_start", ref)).data ?? []) as Row[];
      const locked = rows.filter((r) => r.locked_at).length;
      return !locked ? none : { done: locked === rows.length ? "passed" : "noted", note: locked < rows.length ? `${rows.length - locked} SKU belum terkunci` : null };
    },
    plan_week: async (ref) => ((await exists(sb.from("plan_week").select("id", { count: "exact", head: true }).eq("week_start", ref))) ? { done: "passed" } : none),
    lb_price_decision: async (ref) => ((await exists(sb.from("lb_price_decision").select("id", { count: "exact", head: true }).eq("date", ref))) ? { done: "passed" } : none),
    lb_supply: async (ref) => {
      const rows = ((await sb.from("lb_supply").select("weight_class").eq("date", ref).is("deleted_at", null).in("status", ["confirmed", "received"])).data ?? []) as Row[];
      if (!rows.length) return none;
      const noClass = rows.filter((r) => !s(r.weight_class)).length;
      return { done: noClass ? "noted" : "passed", note: noClass ? `${noClass} baris tanpa kelas` : null };
    },
    allocation: async (ref) => ((await exists(sb.from("allocation").select("id", { count: "exact", head: true }).eq("date", ref).is("deleted_at", null))) ? { done: "passed" } : none),
    costing_wp: async (ref) => {
      const { data: b } = await sb.from("batch").select("id, wp_received_at").eq("batch_ref", ref).eq("status", "Aktual").is("deleted_at", null).limit(1).maybeSingle();
      const bid = s((b as Row | null)?.id);
      if (!bid || !(await exists(sb.from("batch_output_sku").select("id", { count: "exact", head: true }).eq("batch_id", bid).is("deleted_at", null)))) return none;
      // a WP saved with a reason (Σ SKU outside C22) is "masuk, ada catatan"
      const { data: up } = await sb.from("upload").select("id, committed_at, plan").eq("kind", "costing_wp").eq("status", "committed").contains("plan", { batches: [ref] }).order("committed_at", { ascending: false }).limit(1).maybeSingle();
      const u = up as Row | null;
      const reason = ((u?.plan as { needsReason?: string[] } | null)?.needsReason ?? []).includes(ref);
      return { done: reason ? "noted" : "passed", done_at: s(u?.committed_at) ?? s((b as Row).wp_received_at), upload_id: s(u?.id), note: reason ? "selisih hasil potong diberi alasan" : null };
    },
    supplier_invoice: async (ref) => {
      const { data: b } = await sb.from("batch").select("invoice_status").eq("batch_ref", ref).eq("status", "Aktual").is("deleted_at", null).limit(1).maybeSingle();
      const st = s((b as Row | null)?.invoice_status);
      return st === "tied" ? { done: "passed" } : st === "received" ? { done: "noted", note: "belum tie ke GL" } : { done: null, waiting: true };
    },
    gl_daily: async (ref) => ((await exists(sb.from("gl_line").select("id", { count: "exact", head: true }).eq("date", ref).is("deleted_at", null))) ? { done: "passed" } : none),
    stock_daily: async (ref) => ((await exists(sb.from("stock_card_snapshot").select("id", { count: "exact", head: true }).eq("date", ref).is("deleted_at", null))) ? { done: "passed" } : none),
    release_week: async (ref) => {
      const { data: w } = await sb.from("week").select("id").eq("week_start", ref).maybeSingle();
      return w && (await exists(sb.from("release").select("id", { count: "exact", head: true }).eq("week_id", String((w as Row).id)))) ? { done: "passed" } : none;
    },
    fixed_cost: async (ref) => {
      const n = fixedNominals({ month: `${ref}-01`, schedule: await fixedSchedule(sb), lastFinal: null });
      const est = n.filter((x) => x.source !== "jadwal");
      return est.length === n.length ? none : { done: est.length ? "noted" : "passed", note: est.length ? `${est.length} baris masih estimasi (C55)` : null };
    },
    budget: async (ref) => ((await exists(sb.from("budget").select("id", { count: "exact", head: true }).eq("month", `${ref}-01`).is("deleted_at", null))) ? { done: "passed" } : none),
    po_lines: async (ref) => {
      const ship = addDays(ref, 1);
      const lines = ((await sb.from("sales_line").select("item_code, size_kg").eq("status", "Order").eq("delivery_date", ship).is("deleted_at", null).is("superseded_at", null)).data ?? []) as Row[];
      if (!lines.length) return none;
      const { data: items } = await sb.from("item_map").select("item_code, item_name, key, size_kg").in("item_code", [...new Set(lines.map((l) => String(l.item_code)))]);
      const it = new Map(((items ?? []) as Row[]).map((i) => [String(i.item_code), i]));
      const unsized = lines.filter((l) => {
        const i = it.get(String(l.item_code));
        return i && /^RPA\|Karkas\|(Fresh|n\/a)$/.test(String(i.key)) && !s(l.size_kg) && !s(i.size_kg) && !sizeKgOf(s(i.item_name));
      }).length;
      return { done: unsized ? "noted" : "passed", note: unsized ? `${unsized} baris karkas tanpa ukuran (C50)` : null };
    },
  };
}

/** Build the tasks due on `date` and their grid cells (marts input_task, input_completeness_daily). */
export async function buildInputDay(sb: Supa, date: string): Promise<string> {
  if (!(await v5InputOn(sb))) return "v5_input mati";
  const rs = await rules(sb);
  const bs = await fetchAll<Row>((a, b) => sb.from("batch").select("id, batch_ref, date, status").is("deleted_at", null).is("superseded_at", null)
    .gte("date", addDays(date, -1)).lte("date", addDays(date, 1)).range(a, b));
  const inst = instancesDue(rs, date, {
    cutDates: [...new Set(bs.map((b) => String(b.date)))],
    batches: bs.filter((b) => b.status === "Aktual").map((b) => ({ ref: s(b.batch_ref) ?? String(b.id), date: String(b.date) })),
  });
  const read = factReaders(sb), now = nowIso();
  const tasks: InputTask[] = [];
  for (const i of inst) tasks.push(taskOf(i, read[i.kind] ? await read[i.kind](i.ref, i.anchor) : { done: null }, now));
  const cells = completenessCells(tasks, rs, now);
  await martReplace(sb, "input_task", date, tasks as unknown as Record<string, unknown>[]);
  await martReplace(sb, "input_completeness_daily", date, cells as unknown as Record<string, unknown>[]);
  return `${tasks.length} tugas, ${cells.filter((c) => c.status === "late").length} sel merah`;
}

registerBuilder({ module: "v5_input", name: "tugas input dan kelengkapan", build: buildInputDay });

// ------------------------------------------------------------------------------------------------ screen

const RANK: Record<TaskStatus, number> = { late: 0, open: 1, waiting: 2, received: 3, passed: 4 };
const dmy = (d: string) => `${Number(d.slice(8, 10))}/${d.slice(5, 7)}`;
const hm = (iso: string | null) => (iso ? iso.slice(11, 16).replace(":", ".") : "");
const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const dayName = (d: string) => DAYS[new Date(`${d}T00:00:00Z`).getUTCDay()];

/** Everything the screen shows for `role` (the viewer's own, or the one admin / management switched to). */
export async function loadInputScreen(sb: Supa, viewer: Viewer, role: Role, panel: string | null): Promise<InputV5Input> {
  const n = jakartaNow(), today = n.date, now = `${n.date}T${n.time}:00+07:00`;
  const [rs, par, taskRows] = await Promise.all([
    rules(sb), weekParams(sb, today),
    fetchAll<Row>((a, b) => sb.from("input_task").select("*").gte("due_date", addDays(today, -13)).lte("due_date", addDays(today, 7)).order("due_date").range(a, b)).catch(() => [] as Row[]),
  ]);
  const ruleOf = new Map(rs.map((r) => [r.kind, r]));
  const lines = (forRole: Role): InputTaskLine[] => taskRows.filter((t) => rulesOfRole(rs, forRole).includes(String(t.rule_kind))).map((t) => {
    const r = ruleOf.get(String(t.rule_kind))!;
    const st = effectiveStatus({ status: String(t.status) as TaskStatus, due_at: s(t.due_at) }, now);
    const due = s(t.due_at);
    return {
      kind: r.kind, ref: String(t.ref), title: `${r.title} · ${/^\d{4}-\d{2}-\d{2}$/.test(String(t.ref)) ? dmy(String(t.ref)) : String(t.ref)}`, status: st,
      due: due ? `Tenggat ${dayName(due.slice(0, 10))} ${dmy(due.slice(0, 10))} ${hm(due)}${s(t.done_at) ? ` · masuk ${hm(s(t.done_at))}` : ""}` : "Saat dokumen masuk",
      impact: s(t.note) ? `${s(t.note)}. ${r.impact_text}` : r.impact_text,
    };
  }).filter((t) => t.status !== "passed" || t.due.length > 0)
    .sort((a, b) => RANK[a.status] - RANK[b.status] || a.due.localeCompare(b.due));
  const all = lines(role);
  const ws = mondayOf(today);
  const roleBad = (r: Role) => lines(r).filter((t) => t.status === "late").length;

  // history: the last uploads of the role's kinds
  const kinds = ROLE_KINDS[role] ?? [];
  const ups = kinds.length ? ((await sb.from("upload").select("kind, file_name, status, ok_count, row_count, uploaded_at, committed_at, message").in("kind", kinds).order("uploaded_at", { ascending: false }).limit(6)).data ?? []) as Row[] : [];
  const history: HistoryLine[] = ups.map((u) => {
    const at = s(u.committed_at) ?? s(u.uploaded_at) ?? "";
    const partial = u.ok_count !== null && Number(u.ok_count) < Number(u.row_count);
    return { at: at ? `${dmy(at.slice(0, 10))} ${new Date(at).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).replace(":", ".")}` : "—", what: String(u.file_name), result: u.status === "committed" ? (partial ? `${u.ok_count} dari ${u.row_count} baris tersimpan` : `${u.row_count} baris tersimpan`) : String(u.status), tone: u.status === "committed" && !partial ? "ok" : "warn" };
  });
  const { data: rem } = await sb.from("input_reminder").select("date, kind, note, sent_by, sent_at").eq("owner_role", role).gte("sent_at", `${addDays(today, -7)}T00:00:00+07:00`).order("sent_at", { ascending: false }).limit(5);
  for (const r of (rem ?? []) as Row[]) history.unshift({ at: dmy(String(r.sent_at).slice(0, 10)), what: `Pengingat dari ${s(r.sent_by) ?? "Finance"}`, result: `${ruleOf.get(String(r.kind))?.title ?? r.kind} ${dmy(String(r.date))}${s(r.note) ? ` · ${s(r.note)}` : ""}`, tone: "bad" });

  // grid (Finance; also admin and management looking as Finance): the week being released, Monday–Saturday
  let grid: InputV5Input["grid"] = null;
  if (role === "finance") {
    const days = Array.from({ length: 6 }, (_, i) => addDays(ws, i));
    const cells = await fetchAll<Row>((a, b) => sb.from("input_completeness_daily").select("*").gte("date", days[0]).lte("date", days[5]).range(a, b)).catch(() => [] as Row[]);
    const { data: ov } = await sb.from("release_override").select("reason, created_by, created_at").eq("scope_kind", "week").eq("scope", ws).eq("code", "K35").is("deleted_at", null).maybeSingle();
    const cellOf = (c: Row): CompletenessCell => ({ date: String(c.date), kind: String(c.kind), owner_role: String(c.owner_role), status: String(c.status) as CellStatus, due_at: s(c.due_at), note: s(c.note) });
    const rows: GridRow[] = rs.filter((r) => r.active !== false && cells.some((c) => c.kind === r.kind)).map((r) => ({
      kind: r.kind, title: r.title, owner: r.owner_role as Role,
      cells: days.map((d) => { const c = cells.find((x) => x.kind === r.kind && x.date === d); return c ? { date: d, status: effectiveCell(cellOf(c), now), note: s(c.note) } : { date: d, status: null, note: null }; }),
    }));
    grid = { weekStart: ws, days, rows, override: ov ? { reason: String((ov as Row).reason), by: s((ov as Row).created_by) } : null };
  }

  return {
    today, time: n.time.replace(":", "."), viewerRole: viewer.role, role, panel,
    cutOffLb: "12.00", cutOffFresh: String(par.cut_off_time ?? "14:00").slice(0, 5).replace(":", "."),
    roles: (["cost_accounting", "sales", "commercial_lead", "ppic", "purchasing", "inventory_accounting", "finance", "operations_director"] as Role[]).map((r) => ({ role: r, bad: roleBad(r) })),
    tasks: all, cards: await roleCards(sb, role, today, all, grid), history, params: await roleParams(sb, role, today, par), grid, kinds,
  };
}

/** The four cards of a role (§6.4 "Headline + 4 kartu"). */
async function roleCards(sb: Supa, role: Role, today: string, tasks: InputTaskLine[], grid: InputV5Input["grid"]): Promise<InputCard[]> {
  const dueToday = tasks.filter((t) => t.status !== "passed");
  const late = tasks.filter((t) => t.status === "late").length;
  const first: InputCard = { title: "Tugas terbuka", value: String(dueToday.length), sub: late ? `${late} terlambat` : "tidak ada yang terlambat", tone: late ? "bad" : "plain" };
  const ws = mondayOf(today);
  if (role === "cost_accounting") {
    const bs = ((await sb.from("batch").select("invoice_status, wp_received_at").eq("status", "Aktual").is("deleted_at", null).gte("date", ws).lte("date", today)).data ?? []) as Row[];
    const fin = bs.filter((b) => b.invoice_status === "tied").length, wp = bs.filter((b) => b.wp_received_at).length;
    const inv = bs.filter((b) => b.invoice_status !== "pending").length;
    return [first,
      { title: "Status batch minggu ini", value: `${wp - fin} / ${fin}`, sub: "sementara / final", tone: "plain" },
      { title: "Faktur LB masuk", value: `${inv} dari ${bs.length}`, sub: inv < bs.length ? "costing belum bisa final" : "semua masuk", tone: inv < bs.length ? "warn" : "plain" },
      { title: "WP belum masuk", value: String(bs.length - wp), sub: bs.length - wp ? "biaya/kg batch itu masih estimasi" : "semua batch punya WP", tone: bs.length - wp ? "bad" : "plain" }];
  }
  if (role === "sales" || role === "commercial_lead") {
    const po = ((await sb.from("sales_line").select("kg").eq("status", "Order").is("deleted_at", null).gte("delivery_date", ws).lte("delivery_date", addDays(ws, 6))).data ?? []) as Row[];
    const unsized = ((await sb.from("demand_class_weekly").select("net_kg").eq("week_start", ws).eq("size_code", "tanpa")).data ?? []) as Row[];
    const { count: pend } = await sb.from("discount_approval").select("id", { count: "exact", head: true }).eq("status", "pending");
    const { data: last } = await sb.from("upload").select("ok_count, row_count").eq("kind", "po_lines").order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
    const l = last as Row | null;
    const failed = l && l.ok_count !== null ? Number(l.row_count) - Number(l.ok_count) : 0;
    const uk = sum(unsized.map((r) => D(s(r.net_kg) ?? "0")));
    return [
      { title: "PO minggu ini", value: String(po.length), sub: `baris · ${num(sum(po.map((r) => D(s(r.kg) ?? "0"))), 0)} kg`, tone: "plain" },
      { title: "Gagal cek (upload terakhir)", value: String(failed), sub: failed ? "baris perlu dilengkapi" : "tidak ada", tone: failed ? "bad" : "plain" },
      { title: "Karkas tanpa ukuran", value: `${num(uk, 0)} kg`, sub: "dihitung STD di PPIC (C50)", tone: uk.gt(0) ? "bad" : "plain" },
      { title: "Menunggu approval", value: String(pend ?? 0), sub: "PO di bawah lantai", tone: pend ? "warn" : "plain" }];
  }
  if (role === "ppic") {
    const { data: cls } = await sb.from("weight_class").select("code, min_kg, max_kg, avg_kg");
    const all = ((cls ?? []) as Row[]).map((c) => ({ code: String(c.code), min_kg: s(c.min_kg), max_kg: s(c.max_kg), avg_kg: s(c.avg_kg) }));
    const reg = registeredClasses(all);
    const { count: yk } = await sb.from("yield_matrix").select("id", { count: "exact", head: true }).neq("weight_class", "STD").is("deleted_at", null);
    const { count: cap } = await sb.from("capacity").select("id", { count: "exact", head: true }).gte("date", today).lte("date", addDays(today, 6)).not("cut_capacity_head", "is", null);
    return [first,
      { title: "Kelas berat terdaftar", value: `${reg.length} dari ${all.length}`, sub: reg.length < all.length ? `baru ${reg.join(", ") || "—"}` : "lengkap", tone: reg.length < all.length ? "bad" : "plain" },
      { title: "Yield per kelas", value: yk ? "terisi" : "placeholder", sub: yk ? `${yk} baris di luar STD` : "satu yield STD untuk semua kelas (C42)", tone: yk ? "plain" : "warn" },
      { title: "Kapasitas 7 hari", value: `${cap ?? 0} dari 7`, sub: "hari terisi", tone: (cap ?? 0) < 7 ? "warn" : "plain" }];
  }
  if (role === "purchasing" || role === "operations_director") {
    const tmr = addDays(today, 1);
    const [{ data: sup }, { data: dec }] = await Promise.all([
      sb.from("lb_supply").select("weight_class, kg").eq("date", tmr).is("deleted_at", null).in("status", ["confirmed", "received"]),
      sb.from("lb_price_decision").select("price, volume_kg_lb, decided_at").eq("date", tmr).order("decided_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const kg = sum(((sup ?? []) as Row[]).map((r) => D(s(r.kg) ?? "0")));
    const d = dec as Row | null;
    return [first,
      { title: `Harga LB potong ${dmy(tmr)}`, value: d ? num(s(d.price), 0) : "belum", sub: d ? "diputuskan Direktur Operasional" : "C57: simulasi memakai harga kemarin", tone: d ? "plain" : "bad" },
      { title: `Supply terkonfirmasi ${dmy(tmr)}`, value: `${num(kg, 0)} kg`, sub: d?.volume_kg_lb ? `volume keputusan ${num(s(d.volume_kg_lb), 0)} kg` : "kg LB", tone: "plain" },
      { title: "Supply tanpa kelas", value: String(((sup ?? []) as Row[]).filter((r) => !s(r.weight_class)).length), sub: "baris (C58 tidak bisa dicek)", tone: "plain" }];
  }
  if (role === "inventory_accounting") {
    const [{ data: gl }, { data: st }] = await Promise.all([
      sb.from("gl_line").select("date").is("deleted_at", null).order("date", { ascending: false }).limit(1).maybeSingle(),
      sb.from("stock_card_snapshot").select("date").is("deleted_at", null).order("date", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const g = s((gl as Row | null)?.date), k = s((st as Row | null)?.date);
    return [first,
      { title: "Jurnal Accurate", value: g ? `s.d. ${dmy(g)}` : "belum ada", sub: "Actual P&L berhenti di hari terakhir lolos", tone: g && g >= addDays(today, -1) ? "plain" : "warn" },
      { title: "Kartu stok", value: k ? `s.d. ${dmy(k)}` : "belum ada", sub: "rekon stok (C26)", tone: k && k >= addDays(today, -1) ? "plain" : "warn" },
      { title: "Upload lain", value: "wizard v4", sub: "jurnal, stok awal, kartu stok, pengiriman", tone: "plain" }];
  }
  if (role === "finance") {
    const red = grid ? grid.rows.reduce((a, r) => a + r.cells.filter((c) => c.status === "late").length, 0) : 0;
    const bad = grid ? grid.rows.filter((r) => r.cells.some((c) => c.status === "late")).length : 0;
    const month = today.slice(0, 7);
    const est = fixedNominals({ month: `${month}-01`, schedule: await fixedSchedule(sb), lastFinal: null }).filter((x) => x.source !== "jadwal").length;
    // the register hangs off the month's outlook (assumption_register.month_outlook_id), it has no month column
    const { data: mo } = await sb.from("month_outlook").select("id").eq("month", `${month}-01`).maybeSingle();
    const { data: reg } = mo ? await sb.from("assumption_register").select("agreed_at").eq("month_outlook_id", String((mo as Row).id)).is("deleted_at", null).neq("status", "superseded") : { data: [] };
    const regs = (reg ?? []) as Row[];
    return [
      { title: "Siap rilis", value: red && !grid?.override ? "belum" : "ya", sub: red ? `${bad} input bermasalah${grid?.override ? " · override K35" : ""}` : "grid tanpa sel merah", tone: red && !grid?.override ? "bad" : "plain" },
      first,
      { title: "Beban tetap bulan ini", value: est ? "estimasi" : "jadwal", sub: est ? `${est} baris tanpa jadwal (C55)` : "jadwal Finance", tone: est ? "warn" : "plain" },
      { title: "Register asumsi", value: `${regs.filter((r) => r.agreed_at).length} dari ${regs.length}`, sub: "disepakati", tone: regs.some((r) => !r.agreed_at) ? "bad" : "plain" }];
  }
  return [first];
}

/** Values in effect for the role and where they are changed today (§6.4 "Form parameter"). */
async function roleParams(sb: Supa, role: Role, today: string, par: Row): Promise<ParamLine[]> {
  const weeks = await listWeeks(sb);
  const w = weeks.find((x) => x.week_start <= today && x.week_end >= today) ?? weeks[0];
  const wk = w ? `/w/${w.week_start}` : null;
  const rp = (v: unknown) => (s(v) === null ? "belum diisi" : num(s(v), 0));
  if (role === "cost_accounting") {
    const { data: oh } = await sb.from("overhead_rate").select("rate_per_kg_lb, period_start").is("deleted_at", null).lte("period_start", today).order("period_start", { ascending: false }).limit(1).maybeSingle();
    return [
      { label: "Angkut", unit: "Rp/kg LB", value: rp(par.freight_plan_per_kg_lb), href: wk ? `${wk}/input/parameter` : null },
      { label: "Maklon", unit: "Rp/kg hasil potong", value: rp(par.maklon_per_kg_processed), href: wk ? `${wk}/input/parameter` : null },
      { label: "Tarif overhead", unit: "Rp/kg LB", value: rp((oh as Row | null)?.rate_per_kg_lb), href: wk ? `${wk}/costing` : null },
    ];
  }
  if (role === "ppic") {
    const { data: cap } = await sb.from("capacity").select("date, cut_capacity_head").gte("date", today).order("date").limit(1).maybeSingle();
    return [
      { label: "Kapasitas line", unit: "ekor per hari", value: rp((cap as Row | null)?.cut_capacity_head), href: wk ? `${wk}/rencana` : null },
      { label: "Target susut", unit: "% kg LB", value: `${num(D(s(par.target_shrink) ?? "0.03").times(100), 1)}%`, href: wk ? `${wk}/input/parameter` : null },
      { label: "Cut-off fresh", unit: "WIB", value: String(par.cut_off_time ?? "14:00").slice(0, 5).replace(":", "."), href: wk ? `${wk}/input/parameter` : null },
    ];
  }
  if (role === "purchasing" || role === "operations_director") {
    return [{ label: "Harga LB hari ini", unit: "Rp/kg LB", value: rp(par.lb_price_today), href: wk ? `${wk}/input/parameter` : null }];
  }
  if (role === "finance") {
    const month = today.slice(0, 7);
    const n = fixedNominals({ month: `${month}-01`, schedule: await fixedSchedule(sb), lastFinal: null });
    return n.slice(0, 4).map((x) => ({ label: x.pl_line, unit: `Rp jt · ${x.source}`, value: x.source === "jadwal" ? jtV4(x.nominal) : "estimasi", href: `/m/${month}-01/biaya` }));
  }
  if (role === "commercial_lead" || role === "sales") return [{ label: "Komitmen dan price list minggu depan", unit: "dikunci Jumat 17.00", value: "di layar Commercial", href: "/komersial" }];
  return [];
}
