/**
 * PRD v5 §4.9 (K35): input tasks. The registry (`input_task_rule`, seeded from the weekly calendar §3.1) says what has
 * to be filled in, by whom and by when; an instance exists per anchor (week, cut date, date, batch, month); its status
 * comes from the data, never from a tick:
 *
 *   belum (open) → menunggu (waiting, an event not here yet) → masuk (received, with notes) → lolos cek (passed)
 *   belum + past the due time = terlambat (late)
 *
 * The completeness grid (`input_completeness_daily`) is input × date of the tasks due that day; a red (late) cell of
 * the week being released holds the release unless Finance records a K35 override with a reason. The release task
 * itself is a task but not a cell (PRD v5.1 K44): the release is what completes it, so it never holds the release.
 */
import { addDays, type ISODate } from "./dates";

export type TaskStatus = "open" | "waiting" | "received" | "passed" | "late";
export const TASK_LABEL: Record<TaskStatus, string> = { open: "belum", waiting: "menunggu", received: "masuk, ada catatan", passed: "lolos cek", late: "terlambat" };

export type CellStatus = "passed" | "noted" | "late" | "not_due";
export const CELL_LABEL: Record<CellStatus, string> = { passed: "masuk dan lolos cek", noted: "masuk, ada catatan", late: "belum masuk lewat tenggat", not_due: "belum jatuh tempo" };

export interface TaskRule { kind: string; title: string; owner_role: string; due_rule: string; impact_text: string; active?: boolean }

export type DueAnchor = "week_start" | "cut_date" | "date" | "batch.date" | "month_start";
export type DueRule = { event: true } | { event: false; anchor: DueAnchor; days: number; time: string };

/** "batch.date + 1 day 12:00" → { anchor, days: 1, time: "12:00" }; "event" → { event: true }; null when unreadable. */
export function parseDueRule(rule: string): DueRule | null {
  const s = rule.trim();
  if (s === "event") return { event: true };
  const m = /^(week_start|cut_date|date|batch\.date|month_start)\s*([+-])\s*(\d+)\s*days?\s+(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return { event: false, anchor: m[1] as DueAnchor, days: (m[2] === "-" ? -1 : 1) * Number(m[3]), time: `${m[4].padStart(2, "0")}:${m[5]}` };
}

/** Due date and time (WIB) of an instance anchored at `anchor`. */
export function dueOf(rule: Extract<DueRule, { event: false }>, anchor: ISODate): { date: ISODate; at: string } {
  const date = addDays(anchor, rule.days);
  return { date, at: `${date}T${rule.time}:00+07:00` };
}

const dow = (d: ISODate) => new Date(`${d}T00:00:00Z`).getUTCDay();

export interface DueInstance { kind: string; ref: string; anchor: ISODate; due_date: ISODate; due_at: string | null }

/**
 * The instances of the active rules that fall due on `date`: weeks start on Monday; cut dates are the days with a
 * batch (planned or actual); daily inputs are due Monday–Saturday; batch inputs per actual batch; monthly ones on the
 * first; an event rule (supplier invoice) is placed on its batch's date and has no deadline.
 */
export function instancesDue(rules: TaskRule[], date: ISODate, x: { cutDates: ISODate[]; batches: { ref: string; date: ISODate }[] }): DueInstance[] {
  const out: DueInstance[] = [];
  for (const r of rules.filter((q) => q.active !== false)) {
    const p = parseDueRule(r.due_rule);
    if (!p) continue;
    if (p.event) {
      for (const b of x.batches.filter((q) => q.date === date)) out.push({ kind: r.kind, ref: b.ref, anchor: b.date, due_date: date, due_at: null });
      continue;
    }
    const anchor = addDays(date, -p.days);
    const push = (ref: string) => { const d = dueOf(p, anchor); out.push({ kind: r.kind, ref, anchor, due_date: d.date, due_at: d.at }); };
    if (p.anchor === "week_start") { if (dow(anchor) === 1) push(anchor); }
    else if (p.anchor === "cut_date") { if (x.cutDates.includes(anchor)) push(anchor); }
    else if (p.anchor === "date") { if (dow(anchor) !== 0) push(anchor); }
    else if (p.anchor === "month_start") { if (anchor.endsWith("-01")) push(anchor.slice(0, 7)); }
    else for (const b of x.batches.filter((q) => q.date === anchor)) push(b.ref);
  }
  return out;
}

/** What the data says about one instance: passed, received with notes, an event still awaited, or nothing yet. */
export interface TaskFact { done: "passed" | "noted" | null; done_at?: string | null; waiting?: boolean; upload_id?: string | null; note?: string | null }

export interface InputTask { due_date: ISODate; rule_kind: string; ref: string; due_at: string | null; status: TaskStatus; done_at: string | null; upload_id: string | null; note: string | null }

export function taskOf(i: DueInstance, f: TaskFact, now: string): InputTask {
  const status: TaskStatus = f.done === "passed" ? "passed" : f.done === "noted" ? "received"
    : i.due_at === null || f.waiting ? "waiting" : Date.parse(now) >= Date.parse(i.due_at) ? "late" : "open";
  return { due_date: i.due_date, rule_kind: i.kind, ref: i.ref, due_at: i.due_at, status, done_at: f.done_at ?? null, upload_id: f.upload_id ?? null, note: f.note ?? null };
}

/** The status at `now` of a task stored earlier: an open task whose due time has passed is late. */
export function effectiveStatus(t: Pick<InputTask, "status" | "due_at">, now: string): TaskStatus {
  return t.status === "open" && t.due_at !== null && Date.parse(now) >= Date.parse(t.due_at) ? "late" : t.status;
}

export interface CompletenessCell { date: ISODate; kind: string; owner_role: string; status: CellStatus; due_at: string | null; note: string | null }

/** Task kinds that are not inputs of the release and have no grid cell (K44). */
export const NOT_IN_GRID: ReadonlySet<string> = new Set(["release_week"]);

/** Grid cells of the tasks: per due date × input, the worst instance (late > noted > not yet due > passed). */
export function completenessCells(tasks: InputTask[], rules: TaskRule[], now: string): CompletenessCell[] {
  const owner = new Map(rules.map((r) => [r.kind, r.owner_role]));
  const groups = new Map<string, InputTask[]>();
  for (const t of tasks.filter((q) => !NOT_IN_GRID.has(q.rule_kind))) groups.set(`${t.due_date}|${t.rule_kind}`, [...(groups.get(`${t.due_date}|${t.rule_kind}`) ?? []), t]);
  const out: CompletenessCell[] = [];
  for (const [k, ts] of groups) {
    const [date, kind] = k.split("|");
    const st = ts.map((t) => effectiveStatus(t, now));
    const status: CellStatus = st.includes("late") ? "late" : st.includes("received") ? "noted" : st.some((s) => s === "open" || s === "waiting") ? "not_due" : "passed";
    const dues = ts.map((t) => t.due_at).filter((d): d is string => !!d).sort();
    const bad = ts.filter((_, i) => st[i] === "late" || st[i] === "received").map((t) => t.ref);
    out.push({ date, kind, owner_role: owner.get(kind) ?? "admin", status, due_at: dues[0] ?? null, note: bad.length ? bad.join(", ") : null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/** A stored cell at `now`: not yet due when built, past its due time now = late. */
export function effectiveCell(c: Pick<CompletenessCell, "status" | "due_at">, now: string): CellStatus {
  return c.status === "not_due" && c.due_at !== null && Date.parse(now) >= Date.parse(c.due_at) ? "late" : c.status;
}

/**
 * K35: the red cells of the week being released; the release passes when there are none or Finance gave a K35
 * override. Without any cell of the week (grid not built) it does not pass (K45), override or not. Cells of the
 * release task stored before K44 are ignored.
 */
export function k35(x: { cells: CompletenessCell[]; weekStart: ISODate; now: string; override: boolean }): { ok: boolean; red: CompletenessCell[]; built: boolean } {
  const end = addDays(x.weekStart, 6);
  const week = x.cells.filter((c) => c.date >= x.weekStart && c.date <= end && !NOT_IN_GRID.has(c.kind));
  const red = week.filter((c) => effectiveCell(c, x.now) === "late");
  if (!week.length) return { ok: false, red, built: false };
  return { ok: red.length === 0 || x.override, red, built: true };
}
