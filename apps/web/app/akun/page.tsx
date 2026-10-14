import { plainContext } from "@/lib/page";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { ROLE_LABEL } from "@/lib/roles";
import { changePassword } from "./actions";

export const dynamic = "force-dynamic";

export default async function AkunPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { viewer, weeks, week } = await plainContext(sp.week);
  return (
    <Shell viewer={viewer} weeks={weeks} week={week} active="akun">
      <h1>Akun</h1>
      <Card>
        <p><b>{viewer.fullName ?? viewer.email}</b> · {viewer.email} · {ROLE_LABEL[viewer.role]}</p>
        <ActionForm action={changePassword} submit="Ganti kata sandi" className="row">
          <div className="field"><label>Kata sandi baru</label><input className="in" type="password" name="password" minLength={10} required autoComplete="new-password" /></div>
          <div className="field"><label>Ulangi</label><input className="in" type="password" name="password2" minLength={10} required autoComplete="new-password" /></div>
        </ActionForm>
      </Card>
    </Shell>
  );
}
