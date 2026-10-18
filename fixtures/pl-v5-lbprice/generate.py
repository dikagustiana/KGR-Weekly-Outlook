#!/usr/bin/env python3
"""golden.json of fixtures/pl-v5-lbprice, computed with decimal arithmetic independent of the engine (PRD v5.2-A R67).

  python3 -I fixtures/pl-v5-lbprice/generate.py            # prints the golden
  python3 -I fixtures/pl-v5-lbprice/generate.py --write    # rewrites golden.json

Formula (PRD v5 §4.1, planCost on a 1 kg LB basis):
  tariff = freight + maklon x (1 - shrink);  V = sum(yield_i x ref_price_i);  k = (LB price + tariff) / V
  cost per kg of SKU i = k x ref_price_i;  GP forecast = sum(kg x (sell price - cost per kg))
  LB +Rp 1.000/kg  ->  GP forecast changes by -1.000 x sum(kg x ref_price) / V
"""
import json
import os
import sys
from decimal import Decimal as D, getcontext

getcontext().prec = 40
here = os.path.dirname(os.path.abspath(__file__))
inp = json.load(open(os.path.join(here, "inputs.json")))
t = inp["tariff"]
tariff = D(t["freight_plan_per_kg_lb"]) + D(t["maklon_per_kg_processed"]) * (1 - D(t["target_shrink"]))
V = sum(D(inp["yields_std"][k]) * D(inp["ref_prices"][k]) for k in inp["yields_std"])


def costs(lb):
    k = (D(lb) + tariff) / V
    return {key: k * D(p) for key, p in inp["ref_prices"].items()}


def gp(lb):
    c = costs(lb)
    return sum(D(o["kg"]) * (D(o["price"]) - c[o["key"]]) for o in inp["orders"])


q = lambda v, p: str(v.quantize(D(p)))
base, up = gp(inp["lb_price_base"]), gp(inp["lb_price_up"])
ref_value = sum(D(o["kg"]) * D(inp["ref_prices"][o["key"]]) for o in inp["orders"])
golden = {
    "tariff_per_kg_lb": q(tariff, "0.0001"),
    "value_per_kg_lb": q(V, "0.01"),
    "k_base": q((D(inp["lb_price_base"]) + tariff) / V, "0.0000000001"),
    "cost_per_kg_base": {k: q(v, "0.01") for k, v in costs(inp["lb_price_base"]).items()},
    "cost_per_kg_up": {k: q(v, "0.01") for k, v in costs(inp["lb_price_up"]).items()},
    "gp_forecast_base": q(base, "0.01"),
    "gp_forecast_up": q(up, "0.01"),
    "gp_forecast_delta": q(up - base, "0.01"),
    "check_delta_formula": q(-(D(inp["lb_price_up"]) - D(inp["lb_price_base"])) * ref_value / V, "0.01"),
}
text = json.dumps(golden, indent=2, ensure_ascii=False) + "\n"
if "--write" in sys.argv:
    open(os.path.join(here, "golden.json"), "w").write(text)
else:
    print(text, end="")
