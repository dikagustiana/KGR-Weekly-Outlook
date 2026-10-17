import type { ControlV3 } from "@kgr/engine";
import { Card, N, Td } from "@/components/ui";
import { ControlsV3Table } from "@/components/v3/ControlsV3Table";
import type { V5BatchCost } from "@/lib/v5/costing";
import { tgl } from "@/lib/fmt";

/**
 * PRD v5 §4.1 on the costing page (flag v5_costing): status of every RPA batch's cost and the planCost numbers the
 * ledger and Commercial carry (estimasi / sementara), with C53, C54, C57. Every number comes from @kgr/engine.
 */
export function CostingV5({ batches, controls, showControls }: { batches: V5BatchCost[]; controls: ControlV3[]; showControls: boolean }) {
  const open = batches.filter((b) => b.result);
  return (
    <>
      <Card title={open.length ? `${open.length} batch belum final: biaya dari costing rencana` : "Semua batch minggu ini sudah final"}>
        <p className="muted">Biaya batch yang belum diposting = kg LB × (harga LB + tarif angkut dan potong), dibagi ke SKU menurut nilai jual pada harga acuan. Estimasi: kg LB × yield standar; sementara: output WP potong; final: alokasi M1 yang diposting.</p>
        <table className="t compact">
          <thead><tr><th>Tanggal</th><th>Batch</th><th>Status biaya</th><th>Harga LB dari</th><th className="n">kg LB</th><th className="n">Harga LB</th><th className="n">Cost pool</th><th className="n">Nilai jual</th><th className="n">k</th><th className="n">Breakeven Rp/kg LB</th><th className="n">Margin Rp/kg LB</th><th>Harga acuan</th></tr></thead>
          <tbody>
            {batches.map((b) => {
              const r = b.result;
              return (
                <tr key={b.batch_id}>
                  <td>{tgl(b.date)}</td><td>{b.batch_ref}</td><td>{b.status}{b.costCheck ? ` · ${b.costCheck}` : ""}</td>
                  <td>{r ? b.lbPriceSource : b.lbPriceSource === "belum ada" ? "harga LB belum ada (C57)" : ""}</td>
                  {!r && b.lbPriceSource === "belum ada" ? (
                    // K50: no LB price = no cost, never Rp 0
                    <><td className="n">—</td><td className="n">belum diisi</td><td className="n">belum diisi</td><td className="n">—</td><td className="n">—</td><td className="n">—</td><td className="n">—</td><td>{b.priceSource}</td></>
                  ) : (
                    <><Td v={r?.kgLb} dp={2} /><Td v={r?.lbPrice} /><Td v={r?.costPool} /><Td v={r?.value} />
                      <Td v={r?.k} dp={4} /><Td v={r?.breakeven} /><Td v={r?.marginPerKgLb} /><td>{r ? b.priceSource : ""}</td></>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {open.length ? (
        <Card title="Biaya per SKU dari batch yang belum final">
          <table className="t compact">
            <thead><tr><th>Batch</th><th>SKU</th><th className="n">kg</th><th className="n">Harga acuan</th><th className="n">Biaya Rp/kg</th><th className="n">Margin Rp/kg</th></tr></thead>
            <tbody>
              {open.flatMap((b) => b.result!.lines.map((l) => (
                <tr key={`${b.batch_id}|${l.key}`}>
                  <td>{b.batch_ref}</td><td>{l.key}</td><Td v={l.kg} dp={2} />
                  {l.priceRef === null ? <td className="n">belum ada</td> : <Td v={l.priceRef} />}
                  {l.costPerKg === null ? <td className="n">—</td> : <Td v={l.costPerKg} />}
                  {l.marginPerKg === null ? <td className="n">—</td> : <td className="n"><N v={l.marginPerKg} /></td>}
                </tr>
              )))}
            </tbody>
          </table>
        </Card>
      ) : null}
      {showControls ? <Card title="Kontrol costing v5"><ControlsV3Table controls={controls} /></Card> : null}
    </>
  );
}
