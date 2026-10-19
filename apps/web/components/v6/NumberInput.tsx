"use client";
import { useId, useState } from "react";
import { parseNumber } from "@kgr/parsers/values";

/**
 * PRD v6 K92 / R144: a number cell. `inputMode="decimal"` (number keyboard on Android), comma for decimals, dot for
 * thousands only; on blur the cell says what it read ("dibaca: 24.600") or why it could not ("tidak terbaca: …"). A cell
 * that cannot be read is `aria-invalid` with a red border, and ActionForm holds the submit while one is (the server
 * refuses it again with the cell's name). The accessible name names row and column ("Harga jual BLD frozen").
 */
export function NumberInput({ name, label, defaultValue, form, disabled, size }: {
  name: string;
  /** Row and column of the cell, e.g. "Harga jual BLD frozen". */
  label: string;
  defaultValue?: string | number | null;
  form?: string;
  disabled?: boolean;
  size?: number;
}) {
  const id = useId();
  const [read, setRead] = useState<{ ok: boolean; text: string } | null>(null);
  const check = (raw: string) => {
    if (raw.trim() === "") { setRead(null); return; }
    try {
      const v = parseNumber(raw);
      setRead({ ok: true, text: `dibaca: ${v === null ? "kosong" : shown(v)}` });
    } catch (e) {
      setRead({ ok: false, text: `tidak terbaca: ${(e as Error).message.replace(/^Bukan angka: /, "")}` });
    }
  };
  return (
    <span className="ni">
      <input
        type="text" inputMode="decimal" autoComplete="off" name={name} form={form} disabled={disabled} size={size}
        defaultValue={defaultValue ?? ""} aria-label={label} aria-invalid={read && !read.ok ? true : undefined}
        aria-describedby={read ? `${id}-o` : undefined} data-number-input=""
        onBlur={(e) => check(e.currentTarget.value)}
      />
      {read ? <output id={`${id}-o`} className={read.ok ? undefined : "bad"} aria-live="polite">{read.text}</output> : null}
    </span>
  );
}

/** "24600.5" → "24.600,5" (house notation, minus U+2212). */
function shown(v: string): string {
  const neg = v.startsWith("-");
  const [i, d] = (neg ? v.slice(1) : v).split(".");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "−" : ""}${int}${d ? `,${d}` : ""}`;
}
