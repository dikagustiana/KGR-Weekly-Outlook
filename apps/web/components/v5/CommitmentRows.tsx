"use client";
import { useEffect, useState } from "react";
import { numInput } from "@/lib/fmt";
import type { KomersialV5Input } from "@/lib/v5/komersial";

/** The lock form; the "harga frozen" inputs of the commitment rows belong to it (sent with the lock, K46). */
export const LOCK_FORM = "kunci-komitmen";

/** R55: a row changed when any of its inputs differs from the value it was rendered with (text compared after trim). */
export const rowDirty = (inputs: { value: string; initial: string }[]): boolean => inputs.some((i) => i.value.trim() !== i.initial.trim());

/**
 * The rows of the commitment form (PRD v5.2 R55): the form sends only the rows that changed. A row is identified by its
 * hidden `key_<i>`; after the page is interactive an unchanged row has none, so the action never sees it. Before hydration
 * (and without scripts) every row carries its key — the action compares with the database as well, so that sends nothing new.
 */
export function CommitmentRows({ c }: { c: KomersialV5Input["commitment"] }) {
  const [live, setLive] = useState(false);
  const [dirty, setDirty] = useState<Record<number, boolean>>({});
  useEffect(() => setLive(true), []);
  return (
    <>
      {c.rows.map((r, i) => {
        // PRD v5.1 R15: one rule for every input of a row — a locked commitment is changed by the commercial lead
        // (a new version with a reason); the frozen price goes with the lock (lock_commitments), so only the lead
        // fills it, and not for a price list row already locked
        const off = r.status === "locked" && !c.canLock;
        return (
          <span
            key={r.key}
            onInput={(e) => {
              const inputs = [...e.currentTarget.querySelectorAll<HTMLInputElement>("input[data-cm]")].map((x) => ({ value: x.value, initial: x.defaultValue }));
              const d = rowDirty(inputs);
              setDirty((p) => (p[i] === d ? p : { ...p, [i]: d }));
            }}
          >
            {!live || dirty[i] ? <input type="hidden" name={`key_${i}`} value={r.key} /> : null}
            <label>{r.key.split("|")[1]} fresh <input data-cm="" name={`fresh_${i}`} size={6} defaultValue={r.fresh ? numInput(r.fresh, 0) : ""} disabled={off} /></label>
            <label> frozen <input data-cm="" name={`frozen_${i}`} size={6} defaultValue={r.frozen ? numInput(r.frozen, 0) : ""} disabled={off} /></label>
            <label> harga <input data-cm="" name={`price_${i}`} size={7} defaultValue={r.price ? numInput(r.price, 0) : ""} disabled={off} /></label>
            <label> harga frozen <input form={LOCK_FORM} name={`price_frozen|${r.key}`} size={7} defaultValue={r.priceFrozen && r.priceFrozenSource === "form" ? numInput(r.priceFrozen, 0) : ""} placeholder="acuan" disabled={off || !c.canLock || !!r.listLocked} /></label>
          </span>
        );
      })}
    </>
  );
}
