/**
 * A7 — the screen that manages `sales_assignment` (K49, O21(b)): what a Sales user sees and writes. Pure rules, no database:
 * the keys an assignment may name, the one-line cover summary per Sales user, how a row is recognised as "the same
 * assignment", and how a database error reads to Kepala Sales. The loaders are in `assignment-data.ts`, the writes in
 * `app/komersial/assignment/actions.ts`.
 *
 * An assignment key without a form suffix ("RPA|Karkas") covers every form of that SKU; with one ("RPA|Karkas|Fresh") only
 * that exact key (`public.assignment_covers`, `assignmentCovers` of the engine, which the tests compare with `scopeText`). A missing key covers every SKU (rows made
 * by SQL only: the screen asks for a key), a missing customer covers every customer.
 */
import { baseKey } from "@kgr/engine";

export const ASSIGNMENT_PATH = "/komersial/assignment";

/** The form suffix of a SKU key (`baseKey` strips it); the label says what a suffixed assignment key covers. */
const FORM_SUFFIX = /\|(Fresh|Frozen|n\/a)$/;

export interface AssignmentRow {
  id: string;
  sales_rep: string;
  email: string | null;
  customer: string | null;
  key: string | null;
  active: boolean;
  note: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface SalesUser { email: string; name: string | null }

/** The keys the app knows: the SKU keys of the master (sku_key, active) and the base key of each (every form of a SKU). */
export interface KnownKeys { skus: string[]; bases: string[] }

export function knownKeys(skuKeys: readonly string[]): KnownKeys {
  const skus = [...new Set(skuKeys)].sort((a, b) => a.localeCompare(b));
  const bases = [...new Set(skus.map(baseKey))].sort((a, b) => a.localeCompare(b));
  return { skus, bases };
}

/** The label of what a key covers: "semua bentuk" for a base key, "hanya Fresh" for a SKU key with its form. */
export function scopeText(key: string | null): string {
  if (key === null || key === "") return "semua SKU";
  const m = FORM_SUFFIX.exec(key);
  if (!m) return "semua bentuk";
  return m[1] === "n/a" ? "hanya bentuk n/a" : `hanya ${m[1]}`;
}

export type KeyCheck = { ok: true; key: string; base: boolean } | { ok: false; error: string };

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/**
 * The key typed on the form, against the keys the app knows. The comparison is exact (the database compares the key
 * text as it is: `RPA|karkas` would cover nothing), so a key that differs only in case or spacing is refused with the
 * key it probably means. An empty key is refused: "semua SKU" is not a thing this screen creates.
 */
export function checkKey(raw: unknown, known: KnownKeys): KeyCheck {
  const key = String(raw ?? "").trim();
  if (!key) return { ok: false, error: "Isi key SKU: key lengkap dengan bentuk (RPA|Karkas|Fresh) atau key dasar (RPA|Karkas = semua bentuk)" };
  if (known.skus.includes(key)) return { ok: true, key, base: false };
  if (known.bases.includes(key)) return { ok: true, key, base: true };
  const near = [...known.bases, ...known.skus].find((k) => squash(k) === squash(key));
  const example = known.skus.find((k) => FORM_SUFFIX.test(k)) ?? known.skus[0];
  return {
    ok: false,
    error: near
      ? `Key "${key}" tidak dikenal; maksud Anda "${near}"? Huruf besar/kecil dan spasi harus persis sama dengan master`
      : `Key "${key}" tidak dikenal. Pakai key SKU dari master${example ? ` (mis. ${example})` : ""} atau key dasar tanpa bentuk${example ? ` (mis. ${baseKey(example)} = semua bentuk)` : ""}`,
  };
}

/** Customer as typed: trimmed; empty = every customer (null). */
export const customerOf = (raw: unknown): string | null => String(raw ?? "").trim() || null;

/** The database compares customers case-insensitively (`sales_line_in_scope`); two assignments that differ only in case are one. */
export const sameCustomer = (a: string | null | undefined, b: string | null | undefined): boolean => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export const emailOf = (a: { email: string | null }): string => (a.email ?? "").trim().toLowerCase();

/** The same assignment: same e-mail, same customer (case apart), same key. Another `sales_rep` spelling does not make it another one. */
export const sameAssignment = (a: AssignmentRow, x: { email: string; customer: string | null; key: string | null }): boolean =>
  emailOf(a) === x.email && sameCustomer(a.customer, x.customer) && (a.key ?? null) === (x.key ?? null);

/**
 * The `sales_rep` of a new row: the one the e-mail already has (the oldest row, active or not) — a rep named two ways would be
 * two reps in the scorecard and in `repOf` of the order — else the name of the user, else the e-mail.
 */
export function salesRepFor(user: SalesUser, rows: readonly AssignmentRow[]): string {
  const mine = rows.filter((r) => emailOf(r) === user.email).sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  return mine[0]?.sales_rep || user.name?.trim() || user.email;
}

/** Active first, then Sales, key, customer. */
export function sortAssignments<T extends AssignmentRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Number(b.active) - Number(a.active)
    || a.sales_rep.localeCompare(b.sales_rep) || (a.key ?? "").localeCompare(b.key ?? "") || (a.customer ?? "").localeCompare(b.customer ?? "") || a.id.localeCompare(b.id));
}

export interface CoverLine {
  email: string;
  /** Name of the user (or the rep name of the row when the user is not in the list). */
  name: string;
  active: number;
  inactive: number;
  /** One line: "RPA|Karkas = semua bentuk · RPA|Sayap|Fresh = hanya Fresh (PT A)"; empty when no assignment is active. */
  line: string;
  /** Not an active Sales user (any more), but still has rows. */
  orphan: boolean;
}

/**
 * Per Sales user, one line of what the active assignments cover (O21(b) wording: "RPA|Karkas = semua bentuk"). A Sales user
 * without an active assignment sees no SKU at all (default deny): the line says so instead of staying empty.
 */
export function coverLines(users: readonly SalesUser[] | null, rows: readonly AssignmentRow[]): CoverLine[] {
  const byEmail = new Map<string, AssignmentRow[]>();
  for (const r of rows) byEmail.set(emailOf(r), [...(byEmail.get(emailOf(r)) ?? []), r]);
  const people = new Map<string, { name: string; orphan: boolean }>();
  for (const u of users ?? []) people.set(u.email, { name: u.name?.trim() || u.email, orphan: false });
  // `users` null = the user list could not be read: the people are the e-mails of the rows, none is called an orphan
  for (const [email, rs] of byEmail) if (!people.has(email)) people.set(email, { name: rs[0].sales_rep || email, orphan: users !== null });
  return [...people.entries()].map(([email, p]) => {
    const rs = sortAssignments(byEmail.get(email) ?? []);
    const on = rs.filter((r) => r.active);
    const items = on.map((r) => `${r.key ?? "semua SKU"} = ${scopeText(r.key)}${r.customer ? ` (hanya ${r.customer})` : ""}`);
    return { email, name: p.name, active: on.length, inactive: rs.length - on.length, line: items.join(" · "), orphan: p.orphan };
  }).sort((a, b) => Number(a.orphan) - Number(b.orphan) || a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

export const DENIED = "Tidak berwenang: hanya Admin dan Kepala Sales yang mengatur penugasan Sales";
export const DENIED_OR_GONE = "Tidak berwenang mengubah penugasan ini (hanya Admin dan Kepala Sales), atau penugasannya sudah tidak ada";

/** A database error of a write, as Kepala Sales reads it: RLS → "Tidak berwenang", a duplicate, else the database's own message. */
export function writeErrorText(err: { message: string; code?: string }): string {
  if (err.code === "42501" || /row-level security|permission denied/i.test(err.message)) return `${DENIED} (${err.message})`;
  if (err.code === "23505") return `Penugasan yang sama (Sales, pelanggan, key) sudah ada (${err.message})`;
  return `Penugasan tidak disimpan: ${err.message}`;
}

/** What to tell after saving a key with a form suffix: Sales commit per base key (Q-v5.2-53). */
export const SUFFIX_NOTE = "Key ini hanya mencakup satu bentuk: Sales yang membuat komitmen minggu depan perlu key dasar tanpa bentuk (Q-v5.2-53).";
export const hasFormSuffix = (key: string): boolean => FORM_SUFFIX.test(key);
