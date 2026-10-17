import openpyxl, json, os, datetime
p = r'C:\Users\USER\Downloads\Back test\09. Laporan Keuangan Per Sep 2026 PT KGR v2.xlsx'
wb = openpyxl.load_workbook(p, read_only=True, data_only=True)

SEP = 12  # 1-based column L = September 2026 (row10 date 2026-09-30)

def colval(sheet, row, col):
    ws = wb[sheet]
    v = ws.cell(row=row, column=col).value
    return v

pl = wb['PL - Management Report']
bs = wb['BS - Management Report']

expected = {
  "pl_sep": {}, "bs_30sep": {}, "checks": {},
  "source": "09. Laporan Keuangan Per Sep 2026 PT KGR v2.xlsx (PL/BS - Management Report, September = kolom L)",
}
for r in range(12, 60):
    label = pl.cell(row=r, column=2).value
    v = pl.cell(row=r, column=SEP).value
    if label and v is not None and str(v) not in ("", "0"):
        expected["pl_sep"][f"PL!B{r}"] = {"label": str(label).strip(), "value": v}

for r in range(14, 80):
    label = bs.cell(row=r, column=2).value
    v = bs.cell(row=r, column=SEP).value
    if label and v is not None and str(v) not in ("", "0"):
        expected["bs_30sep"][f"BS!B{r}"] = {"label": str(label).strip(), "value": v}

# key checks (from the doc)
def mv(x):  # millions, 1 decimal
    return round(float(x)/1e6, 1)
expected["checks"] = {
  "revenue_jt": mv(colval('PL - Management Report', 12, SEP)),
  "cogs_jt": mv(colval('PL - Management Report', 13, SEP)),
  "gp_jt": mv(colval('PL - Management Report', 15, SEP)),
  "nibt_jt": mv(colval('PL - Management Report', 51, SEP)),
  "net_income_jt": mv(colval('PL - Management Report', 58, SEP)),
  "kas_jt": mv(colval('BS - Management Report', 14, SEP)),
  "inventory_product_jt": mv(colval('BS - Management Report', 23, SEP)),
  "inventory_trading_jt": mv(colval('BS - Management Report', 24, SEP)),
  "equity_jt": mv(colval('BS - Management Report', 77, SEP)),
}

os.makedirs(r'C:\Users\USER\Documents\KGR-Weekly-Outlook\docs\v5.2\backtest-sep', exist_ok=True)
with open(r'C:\Users\USER\Documents\KGR-Weekly-Outlook\docs\v5.2\backtest-sep\expected.json', 'w', encoding='utf-8') as f:
    json.dump(expected, f, indent=1, ensure_ascii=False, default=str)

print("checks:", json.dumps(expected["checks"], ensure_ascii=False))
print("pl_sep lines:", len(expected["pl_sep"]), "bs_30sep lines:", len(expected["bs_30sep"]))
print("--- DI - Note sheet names/dims ---")
for s in ['DI - Note', 'DI - Sep wp', 'TB Accurate', 'Stock', 'INVENTORY']:
    ws = wb[s]
    print(s, "dims", ws.max_row, "x", ws.max_column)
