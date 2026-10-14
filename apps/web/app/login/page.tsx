import { LoginForm } from "./LoginForm";
import { signInGoogle } from "./actions";

const ERR: Record<string, string> = {
  "not-allowed": "E-mail ini belum terdaftar atau tidak aktif di KGR Weekly Outlook. Minta Admin menambahkan Anda.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = sp.next ?? "/";
  const google = process.env.NEXT_PUBLIC_AUTH_GOOGLE === "1";
  return (
    <div className="login">
      <div className="card">
        <h1>KGR Weekly Outlook</h1>
        <p className="muted">PT Karya Gudang Rabat · SAMB Group</p>
        {sp.error ? <div className="msg err">{ERR[sp.error] ?? sp.error}</div> : null}
        <LoginForm next={next} />
        {google ? (
          <form action={signInGoogle} style={{ marginTop: 10 }}>
            <input type="hidden" name="next" value={next} />
            <button className="b sec">Masuk dengan Google Workspace</button>
          </form>
        ) : null}
        <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
          Akses hanya untuk e-mail yang didaftarkan Admin. Lupa kata sandi? Minta Admin mengatur ulang di menu Admin → Pengguna.
        </p>
      </div>
    </div>
  );
}
