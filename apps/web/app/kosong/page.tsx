import { requireViewer } from "@/lib/session";

export default async function Empty() {
  await requireViewer();
  return (
    <main>
      <div className="card">
        <h1>Belum ada minggu</h1>
        <p>Admin belum membuat minggu pertama. Minta Admin membuka menu Admin → Minggu.</p>
      </div>
    </main>
  );
}
