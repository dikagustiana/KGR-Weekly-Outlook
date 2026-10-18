/**
 * A8 (Q-v5.2-114): the draft form of the commitments keeps what was typed after a refusal. The behaviour itself lives in the browser
 * (React empties a `<form action>` after every action; `ActionForm keep` runs the action by hand and resets only after an answer with `ok`)
 * and apps/web has no DOM in vitest, so the behaviour is proven in the e2e journey L (step L4, Chromium); this test fixes the wiring:
 * the draft form is the one that keeps, the lock form is not.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { D } from "@kgr/engine";
import type { KomersialV5Input } from "@/lib/v5/komersial";

const seen: { submit: string; keep: boolean }[] = [];
vi.mock("@/components/ActionForm", () => ({
  ActionForm: (p: { submit: string; keep?: boolean; children?: unknown }) => { seen.push({ submit: p.submit, keep: p.keep === true }); return <form data-submit={p.submit}>{p.children as never}</form>; },
}));
const { CommitmentForm } = await import("./CommitmentForm");

const noop = async () => ({});
const commitment: KomersialV5Input["commitment"] = {
  weekStart: "2026-08-31", weekEnd: "2026-09-06", deadline: "Jum 28/08 17.00", canEdit: true, canLock: true, priceListLocked: false,
  rows: [{ key: "RPA|Karkas", thisWeekKg: D("17346"), fresh: "15000", frozen: "2000", price: "36705", status: "locked", version: 1 }],
};

describe("CommitmentForm keeps the typed values after a refusal (Q-v5.2-114)", () => {
  it("the draft form ('Simpan draft') keeps; the lock form does not", () => {
    seen.length = 0;
    renderToStaticMarkup(<CommitmentForm c={commitment} save={noop} lock={noop} />);
    expect(seen).toEqual([{ submit: "Simpan draft", keep: true }, { submit: "Kunci komitmen dan price list", keep: false }]);
  });
});
