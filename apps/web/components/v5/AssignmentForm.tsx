"use client";
import { startTransition, useActionState, useState } from "react";
import { scopeText } from "@/lib/v5/assignment";
import type { ActionState } from "@/components/ActionForm";

export interface AssignmentFormProps {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  users: { email: string; name: string | null }[];
  /** Base keys ("RPA|Karkas": every form) and SKU keys of the master, for the suggestions of the key field. */
  bases: string[];
  skus: string[];
  customers: string[];
  /** The assignment being changed (field `id`); absent = a new one. */
  edit?: { id: string; email: string; key: string; customer: string; note: string } | null;
}

/**
 * A7: the add / change form of /komersial/assignment. Unlike `ActionForm` it keeps what was typed when the server refuses it
 * (an unknown key must not cost Kepala Sales the Sales user, the customer and the note: React empties a `<form action>` after
 * every action, an error included); after a saved new assignment it keeps the Sales user and clears key, customer and note,
 * because the next key is usually for the same Sales user.
 */
export function AssignmentForm({ action, users, bases, skus, customers, edit }: AssignmentFormProps) {
  const [email, setEmail] = useState(edit?.email ?? "");
  const [key, setKey] = useState(edit?.key ?? "");
  const [customer, setCustomer] = useState(edit?.customer ?? "");
  const [note, setNote] = useState(edit?.note ?? "");
  const [state, run, pending] = useActionState(async (prev: ActionState, fd: FormData): Promise<ActionState> => {
    const r = await action(prev, fd);
    if (r.ok && !edit) { setKey(""); setCustomer(""); setNote(""); }
    return r;
  }, {});
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => run(fd)); }}>
      {edit ? <input type="hidden" name="id" value={edit.id} /> : null}
      <div className="field"><label htmlFor="as-email">Sales</label>
        <select id="as-email" className="in" name="email" required value={email} onChange={(e) => setEmail(e.target.value)}>
          <option value="" disabled>pilih Sales</option>
          {users.map((u) => <option key={u.email} value={u.email}>{u.name ? `${u.name} (${u.email})` : u.email}</option>)}
        </select></div>
      <div className="field"><label htmlFor="as-key">Key SKU (key dasar = semua bentuk)</label>
        <input id="as-key" className="in" name="key" list="as-keys" required autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="RPA|Karkas" style={{ width: 280 }} />
        <datalist id="as-keys">
          {bases.map((k) => <option key={`b|${k}`} value={k} label={scopeText(k)} />)}
          {skus.map((k) => <option key={`s|${k}`} value={k} label={scopeText(k)} />)}
        </datalist></div>
      <div className="field"><label htmlFor="as-customer">Pelanggan (kosong = semua)</label>
        <input id="as-customer" className="in" name="customer" list="as-customers" autoComplete="off" value={customer} onChange={(e) => setCustomer(e.target.value)} style={{ width: 200 }} />
        <datalist id="as-customers">{customers.map((c) => <option key={c} value={c} />)}</datalist></div>
      <div className="field"><label htmlFor="as-note">Catatan</label>
        <input id="as-note" className="in" name="note" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 220 }} /></div>
      <button className="b" disabled={pending}>{pending ? "Memproses…" : edit ? "Simpan perubahan" : "Simpan penugasan"}</button>
      {state.ok ? <div className="msg ok">{state.ok}</div> : null}
      {state.error ? <div className="msg err">{state.error}</div> : null}
    </form>
  );
}
