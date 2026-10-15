import Link from "next/link";
import type { WeekResult } from "@kgr/engine";
import { isNeg, jt, mrd, num, pct } from "@/lib/fmt";

/**
 * Management View v2 R2: three figures above the fold, read from the same fields as the tables below
 * (block 1 TOTAL KGR, block 2 action, block 4 "di atas batas umur") — nothing is recomputed here.
 */
export function Headline({ r, week }: { r: WeekResult; week: string }) {
  const total = r.block1.find((s) => s.segment === "TOTAL KGR")!;
  const aged = r.block4.find((s) => s.status === "PERHATIAN")!;
  const neg = (v: Parameters<typeof isNeg>[0]) => (isNeg(v) ? "neg" : undefined);
  return (
    <section className="headline" data-headline aria-label="Ringkasan untuk manajemen">
      <div className="hl">
        <div className="hl-label">GP proyeksi minggu ini</div>
        <div className="hl-value">
          <span className={neg(total.gpProjection)}>Rp {jt(total.gpProjection)}</span>{" "}
          <span className={neg(total.gpPct)}>({pct(total.gpPct)})</span>
        </div>
        <div className="hl-sub">Δ vs minggu lalu <span className={neg(total.deltaGpPerKg)}>{num(total.deltaGpPerKg)}/kg</span></div>
      </div>
      <div className="hl">
        <div className="hl-label">Keputusan RPA hari ini</div>
        <div className="hl-value hl-reco" data-reco>{r.block2.action.text}</div>
      </div>
      <div className="hl">
        <div className="hl-label">Stok di atas batas umur</div>
        <div className="hl-value">Rp {mrd(aged.value)} · {num(aged.kgToday)} kg · {aged.keys} SKU</div>
        <div className="hl-sub"><Link href={`/w/${week}/stok?status=PERHATIAN`} data-detail-sku>detail per SKU →</Link></div>
      </div>
    </section>
  );
}
