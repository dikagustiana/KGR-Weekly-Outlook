#!/usr/bin/env python3
"""Extract the example week from reference/KGR_Weekly_Outlook.xlsx.

Writes fixtures/week-<start>/*.json (engine inputs, taken from the I_* and T_*
input columns) and golden.json (cached values of every formula cell in the
O_* sheets, Z_Kontrol, I_Parameter and the derived columns of the T_* sheets).

Usage: python3 -I scripts/extract_fixtures.py [path/to/workbook.xlsx]

v3 fixtures (docs/PLAN-v3.md, golden data for the new engine modules; files in reference/ are read as-is):
  python3 -I scripts/extract_fixtures.py v3        all of the below
  python3 -I scripts/extract_fixtures.py costing   reference/202609_Data_COGS_LB.xlsx            -> fixtures/costing-2026-09/
  python3 -I scripts/extract_fixtures.py demand    reference/KGR_Demand_Forecast.xlsx            -> fixtures/demand-2026-09/
  python3 -I scripts/extract_fixtures.py fs        reference/09._Laporan_Keuangan_Per_Sep_...    -> fixtures/fs-2026-09/
  python3 -I scripts/extract_fixtures.py month     fixtures/week-2026-08-24 + FS Aug             -> fixtures/month-2026-08/
"""
import hashlib
import datetime as dt
import json
import os
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "reference", "KGR_Weekly_Outlook.xlsx")


def iso(v):
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    raise ValueError(f"not a date: {v!r}")


def num(v):
    """Numbers are written as decimal strings so no consumer has to trust a float."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        raise ValueError(v)
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        r = repr(v)
        if "e" in r or "E" in r:
            r = format(v, ".15f").rstrip("0").rstrip(".")
        return r
    raise ValueError(f"not a number: {v!r}")


def text(v):
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return num(v)
    return str(v)


def rows(ws, first, last_col):
    out = []
    for r in range(first, ws.max_row + 1):
        vals = [ws.cell(row=r, column=c).value for c in range(1, last_col + 1)]
        out.append((r, vals))
    return out


def main():
    wbf = openpyxl.load_workbook(SRC)
    wbv = openpyxl.load_workbook(SRC, data_only=True)

    p = wbv["I_Parameter"]
    update_date = iso(p["C4"].value)
    week_start = iso(p["C5"].value)
    week_end = iso(p["C6"].value)
    outdir = os.path.join(ROOT, "fixtures", f"week-{week_start}")
    os.makedirs(outdir, exist_ok=True)

    def cell(ref):
        return p[ref].value

    week = {
        "week_start": week_start,
        "week_end": week_end,
        "update_date": update_date,
        "tb_opening_date": iso(cell("C47")),
        "source": "reference/KGR_Weekly_Outlook.xlsx",
    }
    parameters = {
        "horizon_fresh_days": num(cell("C7")),
        "target_shrink": num(cell("C8")),
        "freight_plan_per_kg_lb": num(cell("C9")),
        "maklon_per_kg_processed": num(cell("C10")),
        "lb_price_today": num(cell("C11")),
        "min_trading_spread": num(cell("C12")),
        "stock_age_limit_days": num(cell("C13")),
        "terms_lb_days": num(cell("C14")),
        "terms_trading_days": num(cell("C15")),
        "terms_freight_maklon_days": num(cell("C48")),
        "yield_default": {
            "karkas": num(cell("D19")),
            "kepala": num(cell("D20")),
            "ceker": num(cell("D21")),
            "usus": num(cell("D22")),
            "hja": num(cell("D23")),
            "lemak": num(cell("D24")),
        },
        "last_week": {
            "RPA": {"kg": num(cell("C38")), "revenue": num(cell("D38")), "gp": num(cell("E38"))},
            "Trading": {"kg": num(cell("C39")), "revenue": num(cell("D39")), "gp": num(cell("E39"))},
        },
        "accurate_sales_kg": num(cell("C43")),
        "accurate_opening_stock_value": num(cell("C44")),
    }

    ws = wbv["I_Master"]
    sku_keys = []
    for r, v in rows(ws, 6, 8):
        if v[0] is None:
            continue
        sku_keys.append({
            "key": v[0], "segment": v[1], "sku": v[2], "form": v[3], "decision_group": v[4],
            "ref_sell_price": num(v[5]), "replacement_buy_price": num(v[6]), "note": text(v[7]),
        })

    ws = wbv["I_Item"]
    item_map = [
        {"item_code": v[0], "item_name": v[1], "key": v[2]}
        for r, v in rows(ws, 6, 3) if v[0] is not None
    ]

    ws = wbv["I_COA"]
    coa_map = []
    for r, v in rows(ws, 6, 8):
        if v[0] is None:
            continue
        coa_map.append({
            "account": text(v[0]), "name": v[1], "type": v[2], "pl_line": v[3], "bs_line": v[4],
            "cf_category_as_counter": v[5], "is_cash": v[6] == "Y", "fs_mapping_reference": v[7],
        })

    ws = wbv["I_Stok_Awal"]
    opening_stock = []
    for r, v in rows(ws, 6, 8):
        if v[0] is None or r >= 306:
            continue
        opening_stock.append({
            "row": r, "item_code": text(v[0]), "item_name": v[1], "kg": num(v[3]), "value": num(v[4]),
            "avg_age_days": num(v[5]), "kg_over_age_limit": num(v[6]), "note": text(v[7]),
        })

    ws = wbv["T_Penjualan"]
    sales = []
    for r, v in rows(ws, 6, 11):
        if all(x is None for x in v):
            continue
        sales.append({
            "row": r, "date": iso(v[0]), "status": v[1], "document_ref": text(v[2]), "customer": text(v[3]),
            "item_code": text(v[4]), "key_manual": text(v[5]), "kg": num(v[7]), "price": num(v[8]),
            "hpp_actual": num(v[10]),
        })

    ws = wbv["T_Penerimaan"]
    receipts = []
    for r, v in rows(ws, 6, 10):
        if all(x is None for x in v):
            continue
        receipts.append({
            "row": r, "date": iso(v[0]), "status": v[1], "receipt_source": v[2], "document_ref": text(v[3]),
            "supplier": text(v[4]), "item_code": text(v[5]), "key_manual": text(v[6]), "kg": num(v[8]),
            "unit_cost": num(v[9]),
        })

    ws = wbv["T_Batch"]
    batches = []
    for r, v in rows(ws, 6, 17):
        if all(x is None for x in v):
            continue
        batches.append({
            "row": r, "date": iso(v[0]), "status": v[1], "batch_ref": text(v[2]), "supplier": text(v[3]),
            "lb_kg": num(v[4]), "lb_price": num(v[5]), "freight": num(v[6]), "maklon": num(v[7]),
            "processed_kg": num(v[8]),
            "output": {
                "karkas_fresh": num(v[9]), "karkas_frozen": num(v[10]), "kepala": num(v[11]),
                "ceker": num(v[12]), "usus": num(v[13]), "hja": num(v[14]), "lemak": num(v[15]),
                "other": num(v[16]),
            },
        })

    ws = wbv["T_GL"]
    gl = []
    for r, v in rows(ws, 6, 18):
        if all(x is None for x in v[:9]):
            continue
        gl.append({
            "row": r, "date": iso(v[0]), "voucher_no": text(v[1]), "voucher_type": text(v[2]),
            "account": text(v[3]), "account_name": text(v[4]), "description": text(v[5]),
            "debit": num(v[6]), "credit": num(v[7]), "party": text(v[8]), "cf_override": text(v[17]),
        })

    ws = wbv["I_TB"]
    tb = []
    for r, v in rows(ws, 6, 3):
        if v[0] is None or r >= 266:
            continue
        tb.append({"row": r, "account": text(v[0]), "name": v[1], "balance": num(v[2])})

    ws = wbv["I_RunRate"]
    runrate = []
    for r, v in rows(ws, 6, 4):
        if v[0] is None:
            continue
        runrate.append({"pl_line": v[0], "monthly_amount": num(v[1]), "week_adjustment": num(v[2]), "basis": text(v[3])})

    ws = wbv["T_Kas_Rencana"]
    cash_plan = []
    for r, v in rows(ws, 6, 5):
        if all(x is None for x in v):
            continue
        cash_plan.append({
            "row": r, "date": iso(v[0]), "cf_category": v[1], "bs_counter_line": v[2], "description": text(v[3]),
            "amount": num(v[4]),
        })

    files = {
        "week.json": week, "parameters.json": parameters, "sku_keys.json": sku_keys, "item_map.json": item_map,
        "coa_map.json": coa_map, "opening_stock.json": opening_stock, "sales_lines.json": sales,
        "receipt_lines.json": receipts, "batches.json": batches, "gl_lines.json": gl, "tb_opening.json": tb,
        "runrate.json": runrate, "cash_plan.json": cash_plan,
    }

    # Golden: cached value of every formula cell in the output sheets and the derived input columns.
    golden = {}
    full = ["O_Outlook", "O_Stok", "O_PnL", "O_BS", "O_CF", "Z_Kontrol", "I_Parameter"]
    derived = {
        "T_Penjualan": (6, 6 + len(sales) - 1),
        "T_Penerimaan": (6, 6 + len(receipts) - 1),
        "T_Batch": (6, 6 + len(batches) - 1),
        "T_GL": (6, 6 + len(gl) - 1),
        "T_Kas_Rencana": (6, 6 + len(cash_plan) - 1),
        "I_Stok_Awal": (6, 306),
        "I_TB": (6, 266),
        "I_Item": (6, 6 + len(item_map) - 1),
    }
    for s in full + list(derived):
        wf, wv = wbf[s], wbv[s]
        lo, hi = derived.get(s, (1, wf.max_row))
        for row in wf.iter_rows(min_row=lo, max_row=hi):
            for c in row:
                if isinstance(c.value, str) and c.value.startswith("="):
                    v = wv[c.coordinate].value
                    if v is None:
                        val = None
                    elif isinstance(v, (dt.datetime, dt.date)):
                        val = iso(v)
                    elif isinstance(v, bool):
                        val = v
                    elif isinstance(v, (int, float)):
                        val = num(v)
                    else:
                        val = str(v)
                    golden[f"{s}!{c.coordinate}"] = val
    files["golden.json"] = golden

    for name, data in files.items():
        with open(os.path.join(outdir, name), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=False)
            f.write("\n")
    print(f"wrote {len(files)} files to {os.path.relpath(outdir, ROOT)}; golden cells: {len(golden)}")


# ---------------------------------------------------------------------------------------------------- v3 fixtures

REF = os.path.join(ROOT, "reference")
V3_SOURCES = {
    "costing": ("costing-2026-09", ["202609_Data_COGS_LB.xlsx"]),
    "demand": ("demand-2026-09", ["KGR_Demand_Forecast.xlsx"]),
    "fs": ("fs-2026-09", ["09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx"]),
    "month": ("month-2026-08", ["KGR_Weekly_Outlook.xlsx", "09._Laporan_Keuangan_Per_Sep_2026_PT_KGR_v2.xlsx"]),
}
V3_EXTRACTORS = {}


def _cell_num(v):
    return num(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def extract_costing():
    """202609_Data_COGS_LB.xlsx: every Pot_* batch sheet with the WP layout (header row 'Produk' in column A).

    batches.json: per sheet the header (supplier, cut date, kg LB, kg hasil potong, cost lines, documents) and the
    SKU rows (product, price list Rp/kg, kg non-blasting F, item code G, item name H, kg I) as the costing_wp parser
    reads them. golden.json: the cached value of column L (COGS/kg, relative sales value) for every row with kg,
    plus the totals K (sales value), M (allocated cost) and F (cost pool) of each sheet.
    """
    path = os.path.join(REF, "202609_Data_COGS_LB.xlsx")
    wbf = openpyxl.load_workbook(path)
    wbv = openpyxl.load_workbook(path, data_only=True)
    batches, golden = [], {}
    for name in wbf.sheetnames:
        if not name.startswith("Pot_"):
            continue
        wf, wv = wbf[name], wbv[name]
        hdr = next((r for r in range(1, 25) if wv.cell(r, 1).value == "Produk"), None)
        tot = (hdr or 0) + 1
        if hdr is None or not isinstance(wv.cell(tot, 6).value, (int, float)):
            continue  # e.g. "Pot_ISA (2)": a scenario layout without a cost pool, not a batch costing sheet
        costs = []
        for r in range(3, hdr):
            lab = wv.cell(r, 1).value
            amt = wv.cell(r, 2).value
            if isinstance(lab, str) and lab.strip() and lab.strip().lower() != "total" and isinstance(amt, (int, float)):
                costs.append({"label": lab.strip(), "amount": num(amt), "document": text(wv.cell(r, 7).value), "pi": text(wv.cell(r, 8).value)})
        bl = None
        for r in range(3, hdr):
            for c in range(1, 8):
                if isinstance(wv.cell(r, c).value, str) and wv.cell(r, c).value.strip().lower() == "biaya bl":
                    bl = _cell_num(wv.cell(r, c + 1).value)
        def lab_val(label):
            for r in range(1, hdr):
                for c in range(1, 16):
                    v = wv.cell(r, c).value
                    if isinstance(v, str) and v.strip().lower() == label:
                        return wv.cell(r, c + 1).value
            return None
        date = lab_val("tgl. potong")
        rows = []
        for r in range(tot + 1, wv.max_row + 1):
            a = wv.cell(r, 1).value
            if isinstance(a, str) and a.strip().lower().startswith(("dibuat", "diperiksa", "disetujui")):
                break
            f_kg, i_kg = _cell_num(wv.cell(r, 6).value), _cell_num(wv.cell(r, 9).value)
            if not float(f_kg or 0) and not float(i_kg or 0):
                continue  # rows without kg carry no cost (column L = 0)
            lf = wf.cell(r, 12).value
            row = {
                "row": r, "product": text(a), "price": _cell_num(wv.cell(r, 2).value), "unit": text(wv.cell(r, 3).value),
                "sku_fresh": text(wv.cell(r, 5).value), "kg_non_blasting": f_kg, "item_code": text(wv.cell(r, 7).value),
                "item_name": text(wv.cell(r, 8).value), "kg": i_kg,
                "boneless_pool": isinstance(lf, str) and "Boneless" in lf,
            }
            rows.append(row)
            kg = (float(f_kg or 0) + float(i_kg or 0))
            if kg > 0:
                golden[f"{name}!L{r}"] = _cell_num(wv.cell(r, 12).value)
                golden[f"{name}!M{r}"] = _cell_num(wv.cell(r, 13).value)
        golden[f"{name}!K{tot}"] = _cell_num(wv.cell(tot, 11).value)
        golden[f"{name}!M{tot}"] = _cell_num(wv.cell(tot, 13).value)
        golden[f"{name}!F{tot}"] = _cell_num(wv.cell(tot, 6).value)
        golden[f"{name}!I{tot}"] = _cell_num(wv.cell(tot, 9).value)
        k5 = wv.cell(5, 11).value
        batches.append({
            "sheet": name, "header_row": hdr, "total_row": tot,
            "supplier": text(lab_val("supplier")), "date": iso(date) if isinstance(date, (dt.date, dt.datetime)) else None,
            "lb_kg": _cell_num(lab_val("total kg lb")), "processed_kg": _cell_num(k5),
            "dead_head": _cell_num(wv.cell(5, 14).value) if wv.cell(4, 14).value == "Ayam Mati" else None,
            "dead_kg": _cell_num(wv.cell(5, 15).value) if wv.cell(4, 15).value == "KG Mati" else None,
            "costs": costs, "cost_bl": bl, "total_cost": _cell_num(wv.cell(tot, 6).value), "rows": rows,
        })
    return {"batches.json": batches, "golden.json": golden}


V3_EXTRACTORS["costing"] = extract_costing


def extract_demand():
    """KGR_Demand_Forecast.xlsx: inputs of the forecast + joint-production optimizer and the stock allocation sheet.

    inputs.json mirrors the I_* sheets (and the hard-coded inputs of O_Demand_Forecast, O_Scenario_Multipliers,
    O_Optimizer, B_Alokasi_Stok); golden.json holds the cached value of every formula cell of O_Demand_Rate,
    O_Scenario_Multipliers, O_Demand_Forecast, O_Optimizer, B_Purchase_Plan and B_Alokasi_Stok.
    """
    path = os.path.join(REF, "KGR_Demand_Forecast.xlsx")
    wbf = openpyxl.load_workbook(path)
    wbv = openpyxl.load_workbook(path, data_only=True)
    v = lambda sh, c: wbv[sh][c].value
    prods = []
    ws = wbv["I_Products"]
    for r in range(4, ws.max_row + 1):
        if not ws.cell(r, 1).value:
            continue
        prods.append({
            "sku": ws.cell(r, 1).value, "name": ws.cell(r, 2).value, "cut_type": ws.cell(r, 3).value,
            "fresh_shelf_days": num(ws.cell(r, 4).value), "frozen_capable": ws.cell(r, 5).value == "Y",
            "frozen_shelf_days": num(ws.cell(r, 6).value), "sell_price": num(ws.cell(r, 7).value),
            "frozen_price_factor": num(ws.cell(r, 8).value), "tier": ws.cell(r, 9).value,
        })
    yld = []
    ws = wbv["I_Yield"]
    for r in range(6, ws.max_row + 1):
        if ws.cell(r, 1).value in (None, "TOTAL"):
            continue
        yld.append({"part": ws.cell(r, 1).value, "sellable": ws.cell(r, 3).value == "Y", "yield_pct": num(ws.cell(r, 4).value)})
    hist = []
    ws = wbv["I_Sales_History"]
    for r in range(4, ws.max_row + 1):
        if ws.cell(r, 1).value is None:
            continue
        hist.append({"date": iso(ws.cell(r, 1).value), "sku": ws.cell(r, 2).value, "kg": num(ws.cell(r, 4).value), "flag": ws.cell(r, 5).value})
    ws = wbv["I_Market_Intelligence"]
    season = {ws.cell(r, 1).value: num(ws.cell(r, 2).value) for r in range(6, 13)}
    overrides = [{"date": iso(ws.cell(r, 1).value), "uplift": num(ws.cell(r, 2).value), "note": ws.cell(r, 3).value}
                 for r in range(17, ws.max_row + 1) if isinstance(ws.cell(r, 1).value, (dt.date, dt.datetime))]
    ws = wbv["O_Scenario_Multipliers"]
    tiers = {ws.cell(r, 1).value: {"bear": num(ws.cell(r, 2).value), "bull": num(ws.cell(r, 3).value)} for r in range(5, 8)}
    lb = wbv["I_Live_Bird"]
    inputs = {
        "products": prods, "yield": yld, "sales_history": hist,
        "live_bird": {
            "avg_weight_kg": num(lb["B3"].value), "price_per_kg": num(lb["B4"].value), "cut_cost_per_head": num(lb["B6"].value),
            "freezer_capacity_kg": num(lb["B8"].value), "frozen_handling_per_kg": num(lb["B9"].value), "salvage_per_kg": num(lb["B10"].value),
            "cut_capacity_per_day": num(lb["B11"].value), "window_days": num(lb["B14"].value), "trend_mode": lb["B15"].value,
            "trend_clamp": num(lb["B16"].value), "mev_overlay": lb["B17"].value,
        },
        "seasonality": season, "overrides": overrides, "tiers": tiers,
        "mev": {"bear": num(v("O_Scenario_Multipliers", "B10")), "base": num(v("O_Scenario_Multipliers", "B11")), "bull": num(v("O_Scenario_Multipliers", "B12"))},
        "wow_trend": {wbv["O_Demand_Rate"].cell(r, 1).value: num(wbv["O_Demand_Rate"].cell(r, 6).value) for r in range(4, 12)},
        "forecast_days": [iso(wbv["O_Demand_Forecast"].cell(6, c).value) for c in range(4, 11)],
        "scenario_weights": {"bear": num(v("O_Optimizer", "B39")), "base": num(v("O_Optimizer", "C39")), "bull": num(v("O_Optimizer", "D39"))},
        "stock_on_hand": [{"sku": wbv["B_Alokasi_Stok"].cell(r, 2).value, "kg": num(wbv["B_Alokasi_Stok"].cell(r, 4).value)} for r in range(6, 14)],
        "stock_allocations": [
            {"no": num(wbv["B_Alokasi_Stok"].cell(r, 1).value), "sku": wbv["B_Alokasi_Stok"].cell(r, 2).value, "customer": wbv["B_Alokasi_Stok"].cell(r, 4).value,
             "kg": num(wbv["B_Alokasi_Stok"].cell(r, 5).value), "price": num(wbv["B_Alokasi_Stok"].cell(r, 6).value), "note": wbv["B_Alokasi_Stok"].cell(r, 8).value}
            for r in range(19, 49) if wbv["B_Alokasi_Stok"].cell(r, 2).value],
    }
    golden = {}
    for sh in ["O_Demand_Rate", "O_Scenario_Multipliers", "O_Demand_Forecast", "O_Optimizer", "B_Purchase_Plan", "B_Alokasi_Stok"]:
        for row in wbf[sh].iter_rows():
            for c in row:
                if isinstance(c.value, str) and c.value.startswith("="):
                    val = wbv[sh][c.coordinate].value
                    golden[f"{sh}!{c.coordinate}"] = num(val) if isinstance(val, (int, float)) and not isinstance(val, bool) else (iso(val) if isinstance(val, (dt.date, dt.datetime)) else val)
    return {"inputs.json": inputs, "golden.json": golden}


V3_EXTRACTORS["demand"] = extract_demand


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_fixture(name, files):
    outdir = os.path.join(ROOT, "fixtures", name)
    os.makedirs(outdir, exist_ok=True)
    for fname, data in files.items():
        with open(os.path.join(outdir, fname), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=False)
            f.write("\n")
    return outdir


def v3_source(name, srcs):
    out = {"fixture": name, "generated_by": "scripts/extract_fixtures.py", "sources": []}
    for s in srcs:
        path = os.path.join(REF, s)
        wb = openpyxl.load_workbook(path, read_only=True)
        out["sources"].append({"file": f"reference/{s}", "sha256": sha256(path), "sheets": wb.sheetnames})
        wb.close()
    return out


def main_v3(cmd):
    cmds = list(V3_SOURCES) if cmd == "v3" else [cmd]
    for c in cmds:
        name, srcs = V3_SOURCES[c]
        files = {"source.json": v3_source(name, srcs)}
        if c in V3_EXTRACTORS:
            files.update(V3_EXTRACTORS[c]())
        outdir = write_fixture(name, files)
        print(f"{c}: wrote {len(files)} files to {os.path.relpath(outdir, ROOT)}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and (sys.argv[1] == "v3" or sys.argv[1] in V3_SOURCES):
        main_v3(sys.argv[1])
    else:
        main()
