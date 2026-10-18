#!/usr/bin/env python3
"""Static checks for apps/web (PRD v5.2-A: K41/K56 R43, K42 R47). Exits 1 when any rule is broken.

  python3 -I scripts/lint.py k41 [dir ...]      fail-closed reads
  python3 -I scripts/lint.py k42 [dir ...]      stable pagination and chunked .in()
  python3 -I scripts/lint.py missing [dir ...]  missing is not zero (R64): no `?? 0`, `?? "0"`, `|| 0`, `|| "0"`

Default dir: apps/web (missing: apps/web/lib and apps/web/app). Test files (*.test.*, *.spec.*) are skipped. A line may opt out of one rule with a marker
comment that names the reason, e.g. `// k41-ok: cookies() is read-only in a Server Component`. The marker without a
reason is itself a hit. K41 also skips lib/clock.ts and lib/loader.ts (PRD v5.2-A Bab 5.3).

The `missing` rule (PRD v5.2-A R64) has no whitelist: a default of zero on money, kg or a rate hides a missing value, so
the code turns it into null with "belum ada" / "belum diisi" or a control. A zero that is not a missing value (a count, an
index, a sort result, the start of an accumulator) says why on the same line: `// missing-ok: jumlah baris, bukan uang`.
Zero written as 0, 0.0, 0.00 (also as "0", '0', `0`) after `??` or `||` is a hit; 0.5 is not; text inside "…" and '…' is not code.
Not covered: a default written as D(0) / ZERO (accumulators and counters of maps; reviewed by hand, docs/v5.2/a3.md).

K42 reads the unique keys of every table from supabase/migrations: a fetchAll builder must order by one of them, so
page boundaries never duplicate or drop a row (R47).
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
K41_SKIP = ("apps/web/lib/clock.ts", "apps/web/lib/loader.ts")


def source_files(dirs):
    for d in dirs:
        for base, subdirs, files in os.walk(d):
            subdirs[:] = [s for s in subdirs if s not in ("node_modules", ".next")]
            for f in sorted(files):
                if not f.endswith((".ts", ".tsx")) or ".test." in f or ".spec." in f:
                    continue
                yield os.path.join(base, f)


def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def marker(line, rule):
    """None when the line has no marker for `rule`; True with a reason; False for a marker without a reason."""
    m = re.search(r"%s-ok:(.*)" % rule, line)
    if not m:
        return None
    return bool(m.group(1).strip(" */}"))


class Report:
    def __init__(self, rule):
        self.rule, self.hits = rule, 0

    def hit(self, path, lineno, msg, text):
        self.hits += 1
        print("%s %s:%d: %s — %s" % (self.rule.upper(), rel(path), lineno, msg, text.strip()[:160]))

    def check(self, path, lines, lineno, msg):
        """Report unless the line carries a marker with a reason."""
        m = marker(lines[lineno - 1], self.rule)
        if m is True:
            return
        self.hit(path, lineno, msg if m is None else "penanda %s-ok tanpa alasan" % self.rule, lines[lineno - 1])


def line_of(text, pos):
    return text.count("\n", 0, pos) + 1


# ---------------------------------------------------------------- K41
K41_DESTRUCT = re.compile(r"(?:const|let) \{([^}]*)\} = (?:[^;=]*?\? )?await ([^;]*)")


def k41(dirs):
    rep = Report("k41")
    for path in source_files(dirs):
        if rel(path) in K41_SKIP:
            continue
        text = open(path, encoding="utf-8").read()
        lines = text.split("\n")
        for i, line in enumerate(lines, 1):
            # 1) `const { data } = await …` (or `{ data: x }`, `{ data, count }`) without `error` in the same destructuring.
            #    supabase.auth.getUser(): a null user is the fail-closed "not signed in" state, not a swallowed error.
            for m in K41_DESTRUCT.finditer(line):
                names = [n.strip().split(":")[0].strip() for n in m.group(1).split(",")]
                if "data" in names and "error" not in names and ".auth.getUser(" not in m.group(2):
                    rep.check(path, lines, i, "baca tanpa cek error")
            # 3) .catch(() => …) swallows the error
            if re.search(r"\.catch\(\(\) =>", line):
                rep.check(path, lines, i, ".catch tanpa error")
            # 4) data ?? [] after a query
            if re.search(r"\bdata \?\? \[\]", line):
                rep.check(path, lines, i, "data ?? [] menelan error")
        # 6) `x.data ?? {}` / `x.data ?? []` on a result whose `x.error` is never looked at in the file
        for m in re.finditer(r"\b(\w+)\.data \?\? ", text):
            name = m.group(1)
            if re.search(r"\b%s\.error\b|must(?:Rows)?\(%s\b|orMissingTable\(%s\b" % (name, name, name), text):
                continue
            rep.check(path, lines, line_of(text, m.start()), "%s.data dibaca tanpa cek %s.error" % (name, name))
        # 7) a write or rpc whose result is thrown away: `await sb.from(…).update(…);` as a statement
        for m in re.finditer(r"(?m)^[ \t]*(?:await|void) [\w.]+\.(?:from\([^)]*\)[^;]*?\.(?:insert|update|upsert|delete)\(|rpc\()", text):
            rep.check(path, lines, line_of(text, m.start()), "hasil tulis/rpc dibuang (error tidak dicek)")
        # 2) `catch {` (no binding) whose block does not rethrow
        for m in re.finditer(r"catch (\(\) )?\{", text):
            body = text[m.end():m.end() + 400]
            depth, end = 1, 0
            for j, ch in enumerate(body):
                depth += ch == "{"
                depth -= ch == "}"
                if depth == 0:
                    end = j
                    break
            if "throw " not in body[:end]:
                rep.check(path, lines, line_of(text, m.start()), "catch menelan error")
        # 5) `if (error …) return {}` (also over two lines)
        for m in re.finditer(r"if \(error[^)]*\)\s*\{?\s*return \{\}", text):
            rep.check(path, lines, line_of(text, m.start()), "error dibaca sebagai objek kosong")
    return rep.hits


# ---------------------------------------------------------------- K42
def strip_sql_comments(sql):
    return re.sub(r"--[^\n]*", "", sql)


def split_top(s):
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return [p.strip() for p in out if p.strip()]


def cols_of(s):
    cols = [c.strip().strip('"') for c in s.split(",")]
    return frozenset(cols) if all(re.fullmatch(r"[a-z_][a-z0-9_]*", c) for c in cols) else None


def table_keys(migrations):
    """table → set of unique column sets (primary keys, unique constraints, non-partial unique indexes)."""
    keys = {}
    ident = r'(?:public\.)?"?([a-z_][a-z0-9_]*)"?'
    for f in sorted(os.listdir(migrations)):
        if not f.endswith(".sql"):
            continue
        sql = strip_sql_comments(open(os.path.join(migrations, f), encoding="utf-8").read().lower())
        for m in re.finditer(r"create table (?:if not exists )?%s\s*\(" % ident, sql):
            t, depth, j = m.group(1), 1, m.end()
            while depth and j < len(sql):
                depth += sql[j] == "("
                depth -= sql[j] == ")"
                j += 1
            for part in split_top(sql[m.end():j - 1]):
                k = re.match(r"(?:constraint \w+ )?(?:primary key|unique(?: nulls not distinct)?)\s*\(([^)]*)\)", part)
                if k:
                    c = cols_of(k.group(1))
                elif re.search(r"\b(primary key|unique)\b", part) and not part.startswith(("constraint", "check", "foreign", "unique", "primary")):
                    c = cols_of(part.split()[0])
                else:
                    c = None
                if c:
                    keys.setdefault(t, set()).add(c)
        for m in re.finditer(r"alter table (?:only )?(?:if exists )?%s\s+add (?:constraint \w+ )?(?:primary key|unique)\s*\(([^)]*)\)" % ident, sql):
            c = cols_of(m.group(2))
            if c:
                keys.setdefault(m.group(1), set()).add(c)
        for m in re.finditer(r"alter table (?:only )?(?:if exists )?%s\s+add column (?:if not exists )?([a-z_][a-z0-9_]*)[^,;]*\bprimary key" % ident, sql):
            keys.setdefault(m.group(1), set()).add(frozenset([m.group(2)]))
        for m in re.finditer(r"create unique index (?:if not exists )?\w+\s+on %s\s*(?:using \w+\s*)?\(([^;]*?)\)\s*(where\b)?" % ident, sql):
            c = cols_of(m.group(2))
            if c and not m.group(3):
                keys.setdefault(m.group(1), set()).add(c)
    return keys


# views that return at most one row per row of their base table (security filters only), so the base table's keys hold
VIEW_BASE = {
    "commercial_daily_sales": "commercial_daily",  # 20261017000200_v4_security.sql
    "commercial_daily_sales_v5": "commercial_daily",  # 20261024000200_v51_security.sql (cross join lateral = one row)
}


def query_before(text, pos):
    """The query builder that ends at `pos`: from its `.from(` (searched back over 600 characters)."""
    start = text.rfind(".from(", max(0, pos - 600), pos)
    return text[start:pos] if start >= 0 else text[max(0, pos - 200):pos]


def k42(dirs):
    rep = Report("k42")
    keys = table_keys(os.path.join(ROOT, "supabase", "migrations"))
    for path in source_files(dirs):
        text = open(path, encoding="utf-8").read()
        lines = text.split("\n")
        builders = []
        # 3) fetchAll / fetchAllOrMissing: the builder orders by a unique key of its table
        for m in re.finditer(r"\bfetchAll(?:OrMissing)?(?:<(?:[^<>()]|<[^<>()]*>)*>)?\(", text):
            if text[max(0, m.start() - 9):m.start()] == "function ":
                continue
            if re.match(r"[a-z]\w*[,)]", text[m.end():]):
                continue  # a wrapper passing its own `page` on (fetchAllOrMissing); its callers are checked
            r = text.find(".range(", m.end())
            seg = text[m.end():r if r >= 0 else m.end()]
            builders.append((m.end(), r))
            ln = line_of(text, m.start())
            fm = re.search(r"\.from\(([^)]*)\)", seg)
            if r < 0 or not fm or "fetchAll" in seg:
                rep.check(path, lines, ln, "builder fetchAll tidak bisa diperiksa (from/range tidak terbaca)")
                continue
            ordered = set(re.findall(r'\.order\("([a-z_0-9]+)"', seg))
            # a column fixed by .eq() is constant on every page: ordering by the rest of the key is unique
            fixed = set(re.findall(r'\.eq\("([a-z_0-9]+)"', seg))
            if ".limit(" in seg:
                rep.check(path, lines, ln, "limit di builder fetchAll memotong halaman")
            tables = re.findall(r'"([a-z_0-9]+)"', fm.group(1))
            vm = re.fullmatch(r"\s*([a-z]\w*)\s*", fm.group(1))
            if vm:  # `const table = cond ? "a" : "b";` earlier in the function
                dm = re.search(r"const %s = ([^;]*);" % vm.group(1), text[max(0, m.start() - 1500):m.start()])
                expr = dm.group(1) if dm else ""
                tables = re.findall(r'"([a-z_0-9]+)"', expr.split("?", 1)[1] if "?" in expr else expr)
            if not tables:
                # a table chosen at run time: every such caller reads tables keyed by `id`
                if "id" not in ordered:
                    rep.check(path, lines, ln, "fetchAll tabel dinamis tanpa order id")
                continue
            for table in tables:
                tk = keys.get(VIEW_BASE.get(table, table), ())
                if not any(k <= ordered | fixed for k in tk):
                    want = " | ".join(",".join(sorted(k)) for k in sorted(tk, key=len)) or "kunci unik tidak ditemukan di migrasi"
                    rep.check(path, lines, ln, "fetchAll %s tanpa urutan unik (order: %s; kunci: %s)" % (table, ",".join(sorted(ordered)) or "-", want))
        # 1) .limit(n>1) outside fetchAll: only as an ordered top-n
        for m in re.finditer(r"\.limit\((\d+)\)", text):
            if m.group(1) == "1" or any(a <= m.start() < b for a, b in builders):
                continue
            if ".order(" not in query_before(text, m.start()):
                rep.check(path, lines, line_of(text, m.start()), "limit tanpa order (subset acak)")
        # 2) a dynamic `.in("col", list)` goes through inChunks(…, 200) or an explicit 200-slice
        for m in re.finditer(r"\.in\(\"[a-z_]+\", ", text):
            arg = text[m.end():m.end() + 120]
            if (arg.startswith("[") or re.match(r"[A-Z][A-Z0-9_]*\)", arg) or re.match(r"Object\.values\([A-Z][A-Z0-9_]*\)\)", arg)
                    or re.match(r"[A-Za-z_]\w*\.slice\((\w+), \1 \+ 200\)\)", arg)
                    or "inChunks(" in text[max(0, m.start() - 600):m.start()]):
                continue
            rep.check(path, lines, line_of(text, m.start()), ".in() dinamis tanpa inChunks")
    return rep.hits


# ---------------------------------------------------------------- missing (R64)
MISSING_ZERO = re.compile(r"(?:\?\?|\|\|)\s*(?:0(?:\.0+)?|\"0(?:\.0+)?\"|'0(?:\.0+)?'|`0(?:\.0+)?`)(?![\w.])")


def code_part(line):
    """The line without its trailing `// …` comment (a `//` inside a string literal stays); None for a comment line."""
    stripped = line.strip()
    if stripped.startswith(("//", "/*", "*")):
        return None
    quote = None
    for i, ch in enumerate(line):
        if quote:
            if ch == "\\":
                continue
            if ch == quote and line[i - 1] != "\\":
                quote = None
        elif ch in "\"'`":
            quote = ch
        elif line.startswith("//", i):
            return line[:i]
    return line


STRING_LITERAL = re.compile(r"\"(?:[^\"\\\n]|\\.)*\"|'(?:[^'\\\n]|\\.)*'")


def mask_strings(code):
    """Blank the text of "…" and '…' literals so that prose is not read as code; the literal right after `??` / `||` stays (it may be `"0"`)."""
    def blank(m):
        before = code[:m.start()].rstrip()
        if before.endswith(("??", "||")):
            return m.group(0)
        q = m.group(0)[0]
        return q + q
    return STRING_LITERAL.sub(blank, code)


def missing(dirs):
    rep = Report("missing")
    for path in source_files(dirs):
        lines = open(path, encoding="utf-8").read().split("\n")
        for i, line in enumerate(lines, 1):
            code = code_part(line)
            if code is not None:
                code = mask_strings(code)
            if code is None or not MISSING_ZERO.search(code):
                continue
            rep.check(path, lines, i, "nilai kosong dibaca sebagai 0 (?? 0 / || 0)")
    return rep.hits


def main(argv):
    if len(argv) < 2 or argv[1] not in ("k41", "k42", "missing"):
        print(__doc__)
        return 2
    default = [os.path.join(ROOT, "apps", "web", "lib"), os.path.join(ROOT, "apps", "web", "app")] if argv[1] == "missing" else [os.path.join(ROOT, "apps", "web")]
    dirs = argv[2:] or default
    hits = {"k41": k41, "k42": k42, "missing": missing}[argv[1]](dirs)
    print("%s: %d hit" % (argv[1].upper(), hits))
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
