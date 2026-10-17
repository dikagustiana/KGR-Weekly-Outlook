import "server-only";
/**
 * Upload kinds of the monthly outlook (PRD v4 §3.3, §4.4): `fixed_cost` (template 8.3, one row per COA per period) and
 * `budget` (month × segment × metric). Both go through the same wizard as the other kinds (file → preview → commit),
 * are idempotent (a stable code / version per content) and list the marts they will rebuild before the commit.
 */
import { D, addDays, firstOfMonth, jakartaToday } from "@kgr/engine";
import { budgetMonthFirst, normBudgetMetric, normDayBasis, parseV3Table } from "@kgr/parsers";
import { WriteError } from "../write";
import { plan0, registerV3Kind, type Row } from "../v3/uploads";
import { inChunks, mustRows } from "../loader";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** First days of the months from `from` to `to` inclusive (the months whose pl_daily_v4 is rebuilt after a commit). */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = firstOfMonth(from); m <= to && out.length < 24; m = firstOfMonth(addDays(m, 32))) out.push(m);
  return out;
}

// ------------------------------------------------------------------------------------------------ fixed_cost (template 8.3)

registerV3Kind({
  kind: "fixed_cost", module: "m5_drivers", label: "Finance — biaya tetap (template 8.3)", source: "Manual",
  target: "fixed_cost_schedule", roles: ["admin", "finance"],
  description: "Satu baris per COA per periode: COA berdriver Tetap, nominal per bulan (> 0), berlaku dari / sampai, basis bagi (kalender / kerja), jadwal posting, dasar, pemilik, versi, catatan. Baris dengan COA, periode dan nominal yang sama tidak berubah; nominal baru pada COA dan periode yang sama menaikkan versi.",
  async stage({ sb, sheets }) {
    const p = parseV3Table("fixed_cost", sheets);
    const issues = [...p.issues];
    const ok = p.rows.filter((r) => !r.issues.length);
    const accounts = [...new Set(ok.map((r) => String(r.values.account).trim()))];
    const coaRows = accounts.length ? await inChunks(accounts, async (c) => mustRows(await sb.from("coa_map").select("account, name, pl_line, driver_type").in("account", c).is("deleted_at", null), "uploads-month.coa")) : [];
    const coa = new Map((coaRows as Row[]).map((c) => [String(c.account), c]));
    const have = accounts.length ? await inChunks(accounts, async (c) => mustRows(await sb.from("fixed_cost_schedule").select("id, code, account, amount_per_month, start_date, end_date, version, day_basis").in("account", c).is("deleted_at", null), "uploads-month.fixed_cost")) : [];
    const existing = new Map((have as Row[]).filter((h) => s(h.code)).map((h) => [String(h.code), h]));

    const rows: { target: string; data: Row }[] = [];
    const seen: { account: string; start: string; end: string | null; line: number }[] = [];
    let inserts = 0, updates = 0, unchanged = 0;
    for (const r of ok) {
      const v = r.values as Record<string, string | null>;
      const account = String(v.account).trim();
      const where = `Baris ${r.rowNo}`;
      const c = coa.get(account);
      if (!c) { issues.push(`${where}: COA ${account} tidak ada di master akun`); continue; }
      if (String(c.driver_type) !== "fixed") { issues.push(`${where}: COA ${account} berdriver ${String(c.driver_type ?? "belum ada")}, bukan Tetap`); continue; }
      const amount = D(String(v.amount_per_month));
      if (!amount.gt(0)) { issues.push(`${where}: nominal per bulan harus lebih dari 0`); continue; }
      const start = String(v.start_date), end = s(v.end_date);
      if (end && end < start) { issues.push(`${where}: berlaku sampai sebelum berlaku dari`); continue; }
      const basis = normDayBasis(v.day_basis);
      if (!basis) { issues.push(`${where}: basis bagi "${v.day_basis}" tidak dikenal (kalender atau kerja)`); continue; }
      const posting = v.posting_day === null || v.posting_day === undefined || v.posting_day === "" ? null : Number(v.posting_day);
      if (posting !== null && (!Number.isInteger(posting) || posting < 1 || posting > 31)) { issues.push(`${where}: jadwal posting harus tanggal 1–31`); continue; }
      const clash = seen.find((q) => q.account === account && q.start <= (end ?? "9999-12-31") && start <= (q.end ?? "9999-12-31"));
      if (clash) { issues.push(`${where}: periode tumpang tindih dengan baris ${clash.line} untuk COA ${account}`); continue; }
      seen.push({ account, start, end, line: r.rowNo });
      const code = `T83|${account}|${start}`;
      const cur = existing.get(code);
      const same = cur && D(String(cur.amount_per_month ?? 0)).eq(amount) && s(cur.end_date) === end && String(cur.day_basis) === basis;
      if (!cur) inserts += 1; else if (same) unchanged += 1; else updates += 1;
      rows.push({
        target: "fixed",
        data: {
          code, account, pl_line: String(c.pl_line), description: s(v.basis_doc) ?? `${String(c.name ?? account)} (template 8.3)`, amount_per_month: amount.toFixed(2),
          start_date: start, end_date: end, day_basis: basis, posting_day: posting, basis_doc: s(v.basis_doc), owner: s(v.owner), note: s(v.note),
          version: cur ? (same ? Number(cur.version ?? 1) : Number(cur.version ?? 1) + 1) : Math.max(1, Number(v.version ?? 1) || 1),
        },
      });
    }
    // fixed cost below the month's budget (informational): compared per month in the Finance page, not blocked here
    const pl = plan0("fixed_cost_schedule", "Biaya tetap (template 8.3)", rows.length ? [`pl_daily_v4 dibangun ulang untuk bulan ${monthsBetween(rows.map((x) => String(x.data.start_date)).sort()[0], jakartaToday()).map((m) => m.slice(0, 7)).join(", ") || "-"}`] : []);
    pl.inserts = inserts; pl.updates = updates; pl.unchanged = unchanged;
    const starts = rows.map((x) => String(x.data.start_date)).sort();
    return {
      rows, plan: [pl], issues, note: `${rows.length} baris biaya tetap`, dateFrom: starts[0] ?? null, dateTo: rows.map((x) => s(x.data.end_date) ?? String(x.data.start_date)).sort().pop() ?? null,
      sample: rows.slice(0, 25).map((x) => x.data), unmappedItems: [],
    };
  },
  async commit({ sb, viewer, uploadId, rows }) {
    const recs: Row[] = rows.map((r) => ({ ...r.data, active: true, source: "Manual", upload_id: uploadId, deleted_at: null, updated_by: viewer.email }));
    if (!recs.length) return { inserted: 0, updated: 0, deleted: 0, message: "Tidak ada baris biaya tetap", dates: [] };
    const { error } = await sb.from("fixed_cost_schedule").upsert(recs, { onConflict: "code" });
    if (error) throw new WriteError(`fixed_cost_schedule: ${error.message}`);
    const from = recs.map((x) => String(x.start_date)).sort()[0];
    return { inserted: recs.length, updated: 0, deleted: 0, dates: monthsBetween(from, jakartaToday()), message: `Biaya tetap disimpan (${recs.length} baris)` };
  },
});

// ------------------------------------------------------------------------------------------------ budget

registerV3Kind({
  kind: "budget", module: "m4_monthly", label: "Finance — budget bulanan", source: "Manual",
  target: "budget", roles: ["admin", "finance"],
  description: "Satu baris per bulan × segmen × metrik (kg, revenue, gp, opex, nibt). Isi yang sama dengan versi terakhir bulan itu tidak berubah; isi yang berbeda menjadi versi baru bulan itu (revisi).",
  async stage({ sb, sheets }) {
    const p = parseV3Table("budget", sheets);
    const issues = [...p.issues];
    const ok = p.rows.filter((r) => !r.issues.length);
    const rows: { target: string; data: Row }[] = [];
    const keys = new Set<string>();
    for (const r of ok) {
      const v = r.values as Record<string, string | null>;
      const where = `Baris ${r.rowNo}`;
      const month = budgetMonthFirst(String(v.month));
      const metric = normBudgetMetric(v.metric);
      if (!month) { issues.push(`${where}: bulan tidak valid`); continue; }
      if (!metric) { issues.push(`${where}: metrik "${v.metric}" tidak dikenal (kg, revenue, gp, opex, nibt)`); continue; }
      const segment = String(v.segment).trim();
      const key = `${month}|${segment}|${metric}`;
      if (keys.has(key)) { issues.push(`${where}: ${segment} ${metric} ${month.slice(0, 7)} muncul dua kali`); continue; }
      keys.add(key);
      rows.push({ target: "budget", data: { month, segment, metric, value: D(String(v.value)).toFixed(2) } });
    }
    const months = [...new Set(rows.map((r) => String(r.data.month)))].sort();
    const have = months.length ? await inChunks(months, async (c) => mustRows(await sb.from("budget").select("month, version, segment, metric, value").in("month", c).is("deleted_at", null), "uploads-month.budget")) : [];
    const byMonth = new Map<string, Row[]>();
    for (const h of have as Row[]) byMonth.set(String(h.month), [...(byMonth.get(String(h.month)) ?? []), h]);
    let inserts = 0, unchanged = 0;
    const notes: string[] = [];
    for (const m of months) {
      const cur = byMonth.get(m) ?? [];
      const latest = cur.reduce((a, h) => Math.max(a, Number(h.version)), 0);
      const latestRows = cur.filter((h) => Number(h.version) === latest);
      const mine = rows.filter((r) => String(r.data.month) === m);
      const same = latest > 0 && latestRows.length === mine.length && mine.every((r) => latestRows.some((h) => String(h.segment) === r.data.segment && String(h.metric) === r.data.metric && D(String(h.value)).eq(D(String(r.data.value)))));
      if (same) unchanged += mine.length; else { inserts += mine.length; notes.push(`${m.slice(0, 7)}: versi ${latest + 1}${latest ? ` (menggantikan versi ${latest})` : ""}`); }
      for (const r of mine) r.data.version = same ? latest : latest + 1;
    }
    const pl = plan0("budget", "Budget", [...notes, ...(months.length ? [`pl_daily_v4 dibangun ulang untuk bulan ${months.map((m) => m.slice(0, 7)).join(", ")}`] : [])]);
    pl.inserts = inserts; pl.unchanged = unchanged;
    return { rows, plan: [pl], issues, note: `${rows.length} baris budget, ${months.length} bulan`, dateFrom: months[0] ?? null, dateTo: months[months.length - 1] ?? null, sample: rows.slice(0, 25).map((r) => r.data), unmappedItems: [] };
  },
  async commit({ sb, viewer, uploadId, rows }) {
    const fresh: Row[] = [];
    for (const r of rows) fresh.push({ ...r.data, approved_by: viewer.email, approved_at: new Date().toISOString(), source: "Manual", upload_id: uploadId, deleted_at: null });
    if (!fresh.length) return { inserted: 0, updated: 0, deleted: 0, message: "Tidak ada baris budget", dates: [] };
    const { error } = await sb.from("budget").upsert(fresh, { onConflict: "version,month,segment,metric" });
    if (error) throw new WriteError(`budget: ${error.message}`);
    return { inserted: fresh.length, updated: 0, deleted: 0, dates: [...new Set(fresh.map((x) => String(x.month)))], message: `Budget disimpan (${fresh.length} baris)` };
  },
});
