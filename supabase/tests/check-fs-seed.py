#!/usr/bin/env python3
"""Evidence for the seed of fs_line_map (supabase/migrations/20261025000500_v52_fs.sql, PRD v5.2-B B-R86).

Reads the seed rows from the migration and checks, one by one:
  1. the row number and label (comment after each row) against column B of the workbook sheets
     "PL - Management Report" and "BS - Management Report";
  2. that column K of those sheets is 31 Aug 2026 and column L is 30 Sep 2026, and prints both cells;
  3. the pair (statement, row_no, app_line, sign, note) against FS_MIN_MAP of packages/engine/src/fs-map.ts (PRD A R68).
Exit 0 only when every row passes. Not part of test:rls (needs openpyxl and the workbook).

    python3 -I supabase/tests/check-fs-seed.py reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx
"""
import datetime
import hashlib
import re
import sys

import openpyxl

xlsx = sys.argv[1] if len(sys.argv) > 1 else "reference/09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx"
mig = "supabase/migrations/20261025000500_v52_fs.sql"
fsmap = "packages/engine/src/fs-map.ts"
SHEET = {"PL": "PL - Management Report", "BS": "BS - Management Report"}
COL_AUG, COL_SEP = 10, 11  # zero-based: K and L

sql = open(mig, encoding="utf-8").read()
seed = []
for m in re.finditer(r"\('(PL|BS)',\s*(\d+),\s*'([a-z_]+)',\s*(-?1),\s*(null|'(?:[^']|'')*'),\s*'draft',\s*'migrasi v52_fs'\)[^\n]*?--\s*\"([^\"]*)\"", sql):
    st, row, app, sign, note, label = m.groups()
    seed.append(dict(statement=st, row_no=int(row), app_line=app, sign=int(sign),
                     note=None if note == "null" else note[1:-1].replace("''", "'"), label=label))

ts = open(fsmap, encoding="utf-8").read()
a4 = {}
for m in re.finditer(r'\{\s*statement:\s*"(PL|BS)",\s*row_no:\s*(\d+),\s*fs_line:\s*"([^"]*)",\s*app_line:\s*"([a-z_]+)",\s*sign:\s*(-?1),\s*note:\s*(null|"(?:[^"\\]|\\.)*")\s*\}', ts):
    st, row, fs_line, app, sign, note = m.groups()
    a4[(st, int(row))] = dict(app_line=app, sign=int(sign), note=None if note == "null" else note[1:-1], label=fs_line)

wb = openpyxl.load_workbook(xlsx, data_only=True, read_only=True)
sheets = {}
for st, name in SHEET.items():
    rows = {i: r for i, r in enumerate(wb[name].iter_rows(min_row=1, max_row=90, values_only=True), start=1)}
    sheets[st] = rows
    dates = rows[10]
    ok = (isinstance(dates[COL_AUG], datetime.datetime) and dates[COL_AUG].date() == datetime.date(2026, 8, 31)
          and isinstance(dates[COL_SEP], datetime.datetime) and dates[COL_SEP].date() == datetime.date(2026, 9, 30))
    print(f'{name}: K10={dates[COL_AUG]:%Y-%m-%d} L10={dates[COL_SEP]:%Y-%m-%d} -> {"ok" if ok else "FAIL"}')
    if not ok:
        sys.exit(1)

sha = hashlib.sha256(open(xlsx, "rb").read()).hexdigest()
print(f"workbook {xlsx} sha256 {sha}")
print(f"seed rows in {mig}: {len(seed)}; FS_MIN_MAP rows in {fsmap}: {len(a4)}")

bad = 0
if len(seed) != 15 or len(a4) != 15:
    bad += 1
    print("FAIL: expected 15 seed rows and 15 FS_MIN_MAP rows")
print(f'{"row":<7}{"app_line":<28}{"FS label (workbook col B)":<38}{"Aug (col K), Rp":>20}{"Sep (col L), Rp":>20}  checks')
for s in seed:
    r = sheets[s["statement"]].get(s["row_no"])
    wb_label = (r[1] if r else None)
    wb_label = str(wb_label) if wb_label is not None else ""
    checks = []
    if wb_label.strip() != s["label"].strip():
        checks.append(f'label {wb_label!r} != {s["label"]!r}')
    a = a4.get((s["statement"], s["row_no"]))
    if a is None:
        checks.append("not in FS_MIN_MAP")
    else:
        for k in ("app_line", "sign", "note"):
            if a[k] != s[k]:
                checks.append(f"{k}: sql {s[k]!r} != fs-map.ts {a[k]!r}")
        if a["label"].strip() != wb_label.strip():
            checks.append(f'fs-map.ts label {a["label"]!r} != workbook {wb_label!r}')
    aug, sep = (r[COL_AUG], r[COL_SEP]) if r else (None, None)
    for nm, v in (("Aug", aug), ("Sep", sep)):
        if not isinstance(v, (int, float)):
            checks.append(f"{nm} cell is not a number: {v!r}")
    bad += bool(checks)
    fmt = lambda v: f"{v:,.2f}" if isinstance(v, (int, float)) else str(v)
    print(f'{s["statement"]} b.{s["row_no"]:<3}{s["app_line"]:<28}{wb_label.strip():<38}{fmt(aug):>20}{fmt(sep):>20}  {"ok" if not checks else "FAIL " + "; ".join(checks)}')
extra = set(a4) - {(s["statement"], s["row_no"]) for s in seed}
if extra:
    bad += 1
    print("FAIL: in FS_MIN_MAP but not in the seed:", sorted(extra))

# the figures PRD B-R91 quotes as check numbers (Rp juta)
pl, bs = sheets["PL"], sheets["BS"]
jt = lambda v: round(v / 1e6, 1)
print("check numbers (Rp jt): "
      f"Aug revenue {jt(pl[12][COL_AUG])}, GP {jt(pl[15][COL_AUG])}, NIBT {jt(pl[51][COL_AUG])}, kas {jt(bs[14][COL_AUG])}, ekuitas {jt(bs[77][COL_AUG])}; "
      f"Sep revenue {jt(pl[12][COL_SEP])}, GP {jt(pl[15][COL_SEP])}, NIBT {jt(pl[51][COL_SEP])}, kas {jt(bs[14][COL_SEP])}, ekuitas {jt(bs[77][COL_SEP])}")
print("seed check:", "OK" if not bad else f"FAILED ({bad})")
sys.exit(1 if bad else 0)
