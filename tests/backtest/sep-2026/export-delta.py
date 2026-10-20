#!/usr/bin/env python3
"""Rows that tests/backtest/sep-2026/load-sep.ts wrote in the LOCAL copy of KGR-OS, as SQL for KGR-OS (via the connector).

  python3 -I tests/backtest/sep-2026/export-delta.py snapshot   # before load-sep.ts: copy public.* to schema pre_sep
  python3 -I tests/backtest/sep-2026/export-delta.py export OUT # after: OUT/NN-<table>.sql + OUT/manifest.json

The database is $E2E_PG_URL (the local e2e stack; never KGR-OS). What the load wrote is found by comparing public.* with
pre_sep: new rows per table (foreign-key order) and the one changed row (week 24 Aug, closed by the rollover). A row that
disappeared stops the script (the app soft-deletes).

Compact, because every byte goes through the connector:
  - rows are JSON arrays; every value that is not a number is a reference into one dictionary per file;
  - created_at / updated_at / created_by / updated_by are left to the target's defaults and triggers (not compared);
    every other timestamp becomes the target's now() where the local value is set (the local clock is the test clock;
    compared as set / not set);
    a table that no other table references gets its id from the target (gen_random_uuid());
  - the copies the rollover makes of week 24 Aug (tb_opening, runrate, sku_price) are made again on the target from its
    own week 24 Aug, after checking here that every local copy equals that week row for row (minus id and week_id;
    runrate with week_adjustment reset to 0, as rolloverWeek does);
  - upload_row (the staged preview rows) is not exported: the committed rows carry the upload_id and the upload row keeps
    the file sha256, plan and issues.
00-guard.sql checks the target's starting state (week 24 Aug as in pre_sep, no September week); every table ends with a
check file whose columns must all be true (row count and md5 over the exported columns equal the local copy).
"""
import json, os, subprocess, sys

DB = os.environ.get("E2E_PG_URL", "")
SKIP = {"audit_log", "rebuild_queue", "data_status", "week_snapshot", "schema_registry", "upload_row"}
STAMPS = {"created_at", "updated_at", "created_by", "updated_by"}
COPIES = {"tb_opening", "runrate", "sku_price"}
BASE_WEEK = "2026-08-24"
CHUNK = int(os.environ.get("EXPORT_CHUNK", "30000"))
NUMERIC = ("numeric", "integer", "bigint", "smallint", "double precision", "real")


def psql(sql):
    r = subprocess.run(["psql", DB, "-v", "ON_ERROR_STOP=1", "-AtqX"], input=sql, capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr)
    return r.stdout.strip()


def tables():
    return psql("select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname = 'public'").split(",")


def snapshot():
    if not DB.startswith("postgresql://postgres@127.0.0.1"):
        sys.exit("E2E_PG_URL is not the local stack")
    psql("drop schema if exists pre_sep cascade; create schema pre_sep")
    for t in tables():
        psql(f"create table pre_sep.{t} as table public.{t}")
    print(f"pre_sep: {len(tables())} tables")


def columns(t):
    out = psql(f"""select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ';' order by a.attnum)
                   from pg_attribute a where a.attrelid = 'public.{t}'::regclass and a.attnum > 0 and not a.attisdropped
                   and a.attgenerated = ''""")
    return [tuple(c.split(":", 1)) for c in out.split(";")]


def pk(t):
    return psql(f"""select string_agg(a.attname, ',' order by array_position(i.indkey, a.attnum)) from pg_index i
                    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                    where i.indrelid = 'public.{t}'::regclass and i.indisprimary""").split(",")


def fks():
    return [e.split(">") for e in psql("""select string_agg(conrelid::regclass::text || '>' || confrelid::regclass::text, ' ')
                    from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace""").replace("public.", "").split()]


def fk_order(ts):
    deps = {t: set() for t in ts}
    for a, b in fks():
        if a in deps and b in deps and a != b:
            deps[a].add(b)
    out, seen = [], set()
    def visit(t):
        if t not in seen:
            seen.add(t)
            for d in sorted(deps[t]):
                visit(d)
            out.append(t)
    for t in sorted(ts):
        visit(t)
    return out


def is_num(ty):
    return ty.startswith(NUMERIC)


def is_ts(ty):
    return ty.startswith("timestamp")


def md5_sql(rel, cols, where, subst=None):
    subst = dict(subst or {})
    for c, ty in cols:
        if is_ts(ty) and c not in subst:
            subst[c] = f"{c} is not null"
    expr = "concat_ws(chr(31), " + ", ".join(f"coalesce(({subst.get(c, c)})::text, chr(30))" for c, _ in cols) + ")"
    return f"select md5(coalesce(string_agg(x, chr(29) order by x collate \"C\"), '')) from (select {expr} x from {rel} where {where}) z"


def encode(t, cols, where):
    """Rows of public.t (local) as (dictionary, rows); every non-number is an index into the dictionary."""
    sel = ", ".join(f"{c}::text" for c, _ in cols)
    rows = json.loads(psql(f"select coalesce(json_agg(json_build_array({sel}) order by {', '.join(c + '::text' for c, _ in cols)}), '[]') from public.{t} where {where}"))
    d, idx, out = [], {}, []
    for r in rows:
        er = []
        for (c, ty), v in zip(cols, r):
            if v is None:
                er.append(None)
            elif is_ts(ty):
                er.append(1)
            elif is_num(ty):
                er.append(Num(v))
            else:
                if v not in idx:
                    idx[v] = len(d)
                    d.append(v)
                er.append(idx[v])
        out.append(er)
    return d, out


def decode_select(cols, fixed=None):
    fixed = fixed or {}
    return ", ".join(fixed[c] if c in fixed else (f"case when e->>{i} is not null then now() end" if is_ts(ty) else f"(e->>{i})::{ty}" if is_num(ty) else f"(d.v->>((e->>{i})::int))::{ty}")
                     for i, (c, ty) in enumerate(cols))


class Num(str):
    """A number exactly as PostgreSQL printed it (scale and every digit kept; no float on the way)."""


def dump(obj):
    if isinstance(obj, Num):
        return obj if obj.lstrip("-").replace(".", "", 1).isdigit() else json.dumps(str(obj))
    if isinstance(obj, list):
        return "[" + ",".join(dump(x) for x in obj) + "]"
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def lit(obj):
    s = dump(obj)
    if "$j$" in s:
        sys.exit("data holds $j$")
    return "$j$" + s + "$j$"


def scope_sql(t, nw):
    """The rows of t that belong to the load, by their parent (the same predicate locally and on KGR-OS)."""
    if t == "week":
        return f"id in ({nw})"
    bw = f"(select id from public.batch where week_id in ({nw}))"
    if t == "cost_pool":
        # checked before its lines go in: the new pools by id
        return "id in (" + psql("select coalesce(string_agg(quote_literal(id::text), ','), 'null') from public.cost_pool c where not exists (select 1 from pre_sep.cost_pool p where p.id = c.id)") + ")"
    cols = {c for c, _ in columns(t)}
    ors = []
    if "week_id" in cols:
        ors.append(f"week_id in ({nw})")
    if "upload_id" in cols:
        ors.append(f"upload_id in (select id from public.upload where week_id in ({nw}))")
    if "batch_id" in cols:
        ors.append(f"batch_id in {bw}")
    if "allocation_run_id" in cols:
        ors.append(f"allocation_run_id in (select id from public.allocation_run where batch_id in {bw})")
    if not ors:
        sys.exit(f"{t}: no scope")
    return "(" + " or ".join(ors) + ")"


def export(outdir):
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):
        os.remove(os.path.join(outdir, f))
    refd = {b for _, b in fks()}
    base = psql(f"select id from public.week where week_start = '{BASE_WEEK}'")
    nw = psql("select string_agg(quote_literal(id::text), ',' order by week_start) from public.week w where not exists (select 1 from pre_sep.week p where p.id = w.id)")
    touched, man = [], {}
    for t in tables():
        if t in SKIP:
            continue
        on = " and ".join(f"p.{c} is not distinct from r.{c}" for c in pk(t))
        new = int(psql(f"select count(*) from public.{t} r where not exists (select 1 from pre_sep.{t} p where {on})"))
        chg = int(psql(f"select count(*) from public.{t} r join pre_sep.{t} p on {on} where to_jsonb(p) <> to_jsonb(r)"))
        gone = int(psql(f"select count(*) from pre_sep.{t} p where not exists (select 1 from public.{t} r where {on})"))
        if gone:
            sys.exit(f"{t}: {gone} rows deleted (the app soft-deletes; not exported)")
        if chg and t != "week":
            sys.exit(f"{t}: {chg} existing rows changed; only week {BASE_WEEK} may change")
        if new or chg:
            touched.append(t)
            man[t] = {"new": new, "changed": chg}
    files = []
    wcols = [(c, ty) for c, ty in columns("week") if c not in STAMPS]
    files.append(("00-guard.sql", f"""-- titik awal KGR-OS = salinan lokal sebelum pemuatan September (tests/backtest/sep-2026/export-delta.py)
do $g$ begin
  if exists (select 1 from public.week where id in ({nw}) or week_start between '2026-08-31' and '2026-09-28') then
    raise exception 'minggu September sudah ada: bundel sudah diterapkan (atau dibuat lewat app); berhenti';
  end if;
  if ({md5_sql('public.week', wcols, f"id = '{base}'")}) is distinct from '{psql(md5_sql('pre_sep.week', wcols, f"id = '{base}'"))}' then
    raise exception 'minggu {BASE_WEEK} di KGR-OS berbeda dari salinan lokal; berhenti';
  end if;
end $g$;
select 'guard' langkah, true lulus;
"""))
    order = fk_order(touched)
    for t in order:
        if t in COPIES:
            continue
        leaf = t not in refd
        cols = [(c, ty) for c, ty in columns(t) if c not in STAMPS and not (leaf and c == "id")]
        on = " and ".join(f"p.{c} is not distinct from {t}.{c}" for c in pk(t))
        where = f"not exists (select 1 from pre_sep.{t} p where {on})"
        d, rows = encode(t, cols, where)
        chunks, cur, size = [], [], 0
        for r in rows:
            s = len(dump(r)) + 8
            if cur and size + s > CHUNK:
                chunks.append(cur)
                cur, size = [], 0
            cur.append(r)
            size += s
        if cur:
            chunks.append(cur)
        fixed = {"status": "'open'::text"} if t == "week" else {}
        done = 0
        for ci, part in enumerate(chunks):
            dict_col = lambda ty: not is_num(ty) and not is_ts(ty)
            used = sorted({v for r in part for (c, ty), v in zip(cols, r) if v is not None and dict_col(ty)})
            remap = {o: n for n, o in enumerate(used)}
            prow = [[(remap[v] if (v is not None and dict_col(ty)) else v) for (c, ty), v in zip(cols, r)] for r in part]
            name = f"{len(files):02d}-{t}{'-' + str(ci + 1) if len(chunks) > 1 else ''}.sql"
            files.append((name, f"-- {t}: baris {done + 1}–{done + len(part)} dari {len(rows)} (baru){' · minggu baru masuk open, status akhir di berkas terakhir' if t == 'week' else ''}\n"
                                f"insert into public.{t} ({', '.join(c for c, _ in cols)})\n"
                                f"select {decode_select(cols, fixed)}\n  from (select {lit([d[o] for o in used])}::jsonb v) d,\n"
                                f"       jsonb_array_elements({lit(prow)}::jsonb) e;\n"))
            done += len(part)
        cmp_cols = [(c, ty) for c, ty in cols if not (t == "week" and c == "status")]
        scope = scope_sql(t, nw)
        local = psql(md5_sql(f"public.{t}", cmp_cols, scope))
        if local != psql(md5_sql(f"public.{t}", cmp_cols, where)):
            sys.exit(f"{t}: the scope predicate does not select exactly the new rows")
        man[t].update({"rows": len(rows), "files": len(chunks), "md5": local, "id_from_target": leaf})
        files.append((f"{len(files):02d}-{t}-cek.sql", f"select '{t}' tabel, count(*) baris, count(*) = {len(rows)} jumlah_sama, ({md5_sql(f'public.{t}', cmp_cols, scope)}) = '{local}' isi_sama from public.{t} where {scope};\n"))
    for t in [x for x in order if x in COPIES]:
        cols = [(c, ty) for c, ty in columns(t) if c not in STAMPS and c not in ("id", "week_id")]
        act = " and deleted_at is null" if any(c == "deleted_at" for c, _ in cols) else ""
        subst = {"week_adjustment": "0::numeric(18,2)"} if t == "runrate" else {}
        if subst:
            typ = dict(cols)["week_adjustment"]
            subst = {"week_adjustment": f"0::{typ}"}
        base_md5 = psql(md5_sql(f"pre_sep.{t}", cols, f"week_id = '{base}'{act}", subst))
        weeks = psql(f"select string_agg(distinct week_id::text, ',') from public.{t} where week_id in ({nw})").split(",")
        if len(weeks) != len(nw.split(",")):
            sys.exit(f"{t}: not every new week has rows")
        for w in weeks:
            if psql(md5_sql(f"public.{t}", cols, f"week_id = '{w}'")) != base_md5:
                sys.exit(f"{t}: the rows of week {w} are not a copy of week {BASE_WEEK}")
        n = int(psql(f"select count(*) from pre_sep.{t} where week_id = '{base}'{act}"))
        sel = ", ".join(f"{subst[c]}" if c in subst else f"s.{c}" for c, _ in cols)
        files.append((f"{len(files):02d}-{t}.sql", f"""-- {t}: salinan minggu {BASE_WEEK} ke {len(weeks)} minggu September, seperti rolloverWeek (dicek di lokal: tiap minggu = salinan baris demi baris)
insert into public.{t} (week_id, {', '.join(c for c, _ in cols)})
select w.id, {sel} from public.{t} s cross join (select unnest(array[{nw}]::uuid[]) id) w where s.week_id = '{base}'{act.replace('deleted_at', 's.deleted_at')};
select '{t}' tabel, w.id minggu, count(*) = {n} jumlah_sama, ({md5_sql(f'public.{t}', cols, 'week_id = w.id')}) = '{base_md5}' isi_sama
  from (select unnest(array[{nw}]::uuid[]) id) w join public.{t} r on r.week_id = w.id group by w.id;
"""))
        man[t].update({"copy_of": BASE_WEEK, "weeks": len(weeks), "rows_per_week": n, "md5": base_md5})
    allw = f"id in ({nw}, '{base}')"
    d, rows = encode("week", wcols, allw)
    files.append((f"{len(files):02d}-week-final.sql", f"""-- week: nilai akhir = salinan lokal (status ditutup rollover, tanggal update, lw_*)
update public.week w set {', '.join(f'{c} = r.{c}' for c, _ in wcols if c != 'id')}
  from (select {decode_select(wcols)} from (select {lit(d)}::jsonb v) d, jsonb_array_elements({lit(rows)}::jsonb) e) r({', '.join(c for c, _ in wcols)})
 where w.id = r.id;
select 'week' tabel, ({md5_sql('public.week', wcols, allw)}) = '{psql(md5_sql('public.week', wcols, allw))}' isi_sama;
"""))
    for name, body in files:
        open(os.path.join(outdir, name), "w").write(body)
    json.dump({"order": order, "tables": man, "files": [[n, len(b)] for n, b in files]}, open(os.path.join(outdir, "manifest.json"), "w"), indent=1)
    for n, b in files:
        print(f"{n:34s} {len(b):8d}")
    print("total", sum(len(b) for _, b in files))


if __name__ == "__main__":
    {"snapshot": lambda: snapshot(), "export": lambda: export(sys.argv[2])}[sys.argv[1]]()
