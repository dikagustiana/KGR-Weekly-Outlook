import Link from "next/link";

export function MasterTabs({ active, week }: { active: string; week?: string }) {
  const q = week ? `?week=${week}` : "";
  return (
    <div className="row" style={{ marginBottom: 8 }}>
      <Link href={`/master/item${q}`} className={`b small ${active === "item" ? "" : "sec"}`}>Kode item → key (I_Item)</Link>
      <Link href={`/master/coa${q}`} className={`b small ${active === "coa" ? "" : "sec"}`}>Akun → laporan (I_COA)</Link>
      <Link href={`/master/sku${q}`} className={`b small ${active === "sku" ? "" : "sec"}`}>Key SKU (I_Master)</Link>
    </div>
  );
}
