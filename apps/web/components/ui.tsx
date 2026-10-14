import type { ReactNode } from "react";
import type { Decimal } from "@kgr/engine";
import { isNeg, num, pct } from "@/lib/fmt";

type V = Decimal | number | string | null | undefined;

/** A computed number: house format, red when negative, tooltip naming its rule (the Excel's "Cara hitung"). */
export function N({ v, dp = 0, tip, percent, warnNeg = true, className }: { v: V; dp?: number; tip?: string; percent?: boolean; warnNeg?: boolean; className?: string }) {
  const text = percent ? pct(v, dp || 1) : num(v, dp);
  const cls = [warnNeg && isNeg(v) && text.startsWith("-") ? "neg" : "", tip ? "tip" : "", className ?? ""].join(" ").trim();
  return (
    <span className={cls || undefined} data-tip={tip} title={tip ? undefined : undefined} tabIndex={tip ? 0 : undefined}>
      {text}
    </span>
  );
}

/** Numeric table cell. */
export const Td = Object.assign(TdCell, { Inner: N });

function TdCell({ v, dp = 0, tip, percent, warnNeg = true, className }: { v: V; dp?: number; tip?: string; percent?: boolean; warnNeg?: boolean; className?: string }) {
  return (
    <td className={`n ${className ?? ""}`}>
      <N v={v} dp={dp} tip={tip} percent={percent} warnNeg={warnNeg} />
    </td>
  );
}

export function Badge({ s, children }: { s: string; children?: ReactNode }) {
  return <span className={`badge ${s.replace(/[^A-Za-z]+/g, "-").replace(/-+$/, "")}`}>{children ?? s}</span>;
}

export function Chip({ source }: { source: string | null | undefined }) {
  if (!source) return null;
  return <span className={`chip ${source}`}>{source}</span>;
}

export function Card({ title, children, id, extra }: { title?: ReactNode; children: ReactNode; id?: string; extra?: ReactNode }) {
  return (
    <section className="card" id={id}>
      {title ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>{title}</h2>
          {extra}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Msg({ kind = "info", children }: { kind?: "ok" | "err" | "info"; children: ReactNode }) {
  return <div className={`msg ${kind}`}>{children}</div>;
}

export function statusClass(text: string): string {
  if (text.startsWith("TUNDA")) return "bad";
  if (text.startsWith("KURANGI") || text.startsWith("POTONG")) return "mid";
  return "good";
}
