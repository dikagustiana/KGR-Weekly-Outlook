import { ActionForm, type ActionState } from "@/components/ActionForm";

export interface OverrideRow { id: string; code: string; reason: string; evidence: string; created_by: string | null; created_role: string | null }

/**
 * PRD v4 §7.2: why a release is refused, per control, and the override of one control with reason and evidence for the
 * role the policy names. A control no role may override (C32, C45, C48, STALE) only says what to fix.
 */
export function OverridePanel({
  rejections, overrides, policy, role, action, hidden, v4,
}: {
  rejections: { code: string; label: string; overridable: boolean }[];
  overrides: OverrideRow[];
  policy: Record<string, string[]>;
  role: string;
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  v4?: boolean;
}) {
  const fields = Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  const mine = rejections.filter((r) => r.overridable && (policy[r.code] ?? []).includes(role));
  return (
    <div className="override">
      {rejections.length ? (
        <ul>
          {rejections.map((r) => (
            <li key={r.code}>
              {r.label}
              {r.overridable ? ` · override oleh ${(policy[r.code] ?? []).join(", ")}` : " · tidak bisa di-override"}
            </li>
          ))}
        </ul>
      ) : null}
      {mine.length ? (
        <ActionForm action={action} submit="Catat override" v4={v4} className="row">
          {fields}
          <label>Kontrol <select name="code">{mine.map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}</select></label>
          <label>Alasan <input name="reason" required minLength={10} size={36} placeholder="mengapa rilis tetap benar" /></label>
          <label>Bukti <input name="evidence" required minLength={3} size={18} placeholder="voucher, file, tautan" /></label>
        </ActionForm>
      ) : null}
      {overrides.length ? (
        <table className="t compact">
          <thead><tr><th>Kontrol</th><th>Alasan</th><th>Bukti</th><th>Oleh</th><th /></tr></thead>
          <tbody>
            {overrides.map((o) => (
              <tr key={o.id}>
                <td>{o.code}</td><td>{o.reason}</td><td>{o.evidence}</td><td>{o.created_role ?? ""}</td>
                <td>{(policy[o.code] ?? []).includes(role) ? (
                  <ActionForm action={action} submit="Tarik" v4={v4} confirm={`Tarik override ${o.code}?`}>{fields}<input type="hidden" name="id" value={o.id} /></ActionForm>
                ) : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
