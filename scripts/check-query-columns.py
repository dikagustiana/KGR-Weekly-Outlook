#!/usr/bin/env python3
"""Every table, column and RPC that apps/web asks PostgREST for exists in the migrated schema.

    python3 -I scripts/check-query-columns.py <columns.txt> <functions.txt>

columns.txt: "table|column" per line (information_schema.columns of public); functions.txt: one function name per
line. Reads each `sb.from("t")` chain in apps/web (tests excluded): the literal `.select("…")` columns and the column
of `.eq/.neq/.is/.gte/.lte/.gt/.lt/.in/.not/.order/.like/.ilike/.contains/.match("col", …)`, and each `.rpc("f")`.
The unit tests mock Supabase and cannot see a column that is not there (v4/3 read sku_key.replacement_buy_price,
which lives on sku_price); test-rls.sh runs this against the database it has just migrated.
"""
import collections
import glob
import re
import sys

FILTERS = {"eq", "neq", "is", "gte", "lte", "gt", "lt", "in", "not", "order", "like", "ilike", "contains", "match"}


def call_args(src: str, i: int) -> tuple[str, int]:
    """src[i] is "(": the text up to the matching ")" (strings and template literals skipped) and the index after it."""
    depth, j, quote = 0, i, None
    while j < len(src):
        c = src[j]
        if quote:
            if c == "\\":
                j += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return src[i + 1:j], j + 1
        j += 1
    return src[i + 1:], len(src)


def select_columns(sel: str) -> list[str]:
    sel = re.sub(r"[\w!:]+\((?:[^()]|\([^()]*\))*\)", "", sel)  # embedded resources: name(cols), alias:name!fk(cols)
    out = []
    for part in (p.strip() for p in sel.split(",")):
        if not part or part == "*":
            continue
        part = part.split("::")[0].strip()
        if ":" in part:
            part = part.split(":", 1)[1].strip()
        out.append(part.split("->")[0].strip())
    return [c for c in out if c]


def main() -> int:
    cols: dict[str, set[str]] = collections.defaultdict(set)
    for line in open(sys.argv[1], encoding="utf-8"):
        if "|" in line:
            t, c = line.rstrip("\n").split("|", 1)
            cols[t].add(c)
    fns = {l.strip() for l in open(sys.argv[2], encoding="utf-8") if l.strip()}
    files = [f for f in glob.glob("apps/web/**/*.ts*", recursive=True)
             if "node_modules" not in f and "/.next/" not in f and ".test." not in f and "/test-support/" not in f]
    bad = []
    for f in sorted(files):
        src = open(f, encoding="utf-8").read()
        line = lambda k: src.count("\n", 0, k) + 1  # noqa: E731
        for m in re.finditer(r'(\.storage)?\.from\(\s*"([a-z_0-9]+)"\s*\)', src):
            if m.group(1):
                continue  # a storage bucket
            t = m.group(2)
            if t not in cols:
                bad.append(f"{f}:{line(m.start())} table {t} does not exist")
                continue
            k = m.end()
            while True:  # the chain: .method(args) .method(args) … across lines
                n = re.match(r"\s*\.(\w+)\s*(?=\()", src[k:])
                if not n:
                    break
                args, k = call_args(src, k + n.end())
                name = n.group(1)
                lit = re.match(r'\s*"([^"]*)"', args) or re.match(r"\s*`([^`$]*)`", args)
                if name == "select" and lit:
                    for c in select_columns(lit.group(1)):
                        if c not in cols[t]:
                            bad.append(f"{f}:{line(m.start())} {t}.{c} (select)")
                elif name in FILTERS and lit and re.fullmatch(r"[a-z_][a-z0-9_]*", lit.group(1)):
                    if lit.group(1) not in cols[t]:
                        bad.append(f"{f}:{line(m.start())} {t}.{lit.group(1)} (.{name})")
        for m in re.finditer(r'\.rpc\(\s*"([a-z_0-9]+)"', src):
            if m.group(1) not in fns:
                bad.append(f"{f}:{line(m.start())} rpc {m.group(1)} does not exist")
    for b in sorted(set(bad)):
        print(b)
    print(f"check-query-columns: {len(files)} files, {len(set(bad))} unknown table/column/rpc")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
