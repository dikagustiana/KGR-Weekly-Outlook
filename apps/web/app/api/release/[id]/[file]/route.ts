import { NextResponse } from "next/server";
import { getViewer } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params;
  const { viewer } = await getViewer();
  if (!viewer) return new NextResponse("Tidak berwenang", { status: 401 });
  const sb = await supabaseServer();
  const { data } = await sb.from("release").select("pdf_path").eq("id", id).maybeSingle();
  if (!data?.pdf_path) return new NextResponse("Rilis tidak ada", { status: 404 });
  const path = file === "json" ? String(data.pdf_path).replace(/\.pdf$/, ".json") : String(data.pdf_path);
  const dl = await sb.storage.from("releases").download(path);
  if (dl.error || !dl.data) return new NextResponse("File tidak ditemukan", { status: 404 });
  return new NextResponse(dl.data, {
    headers: {
      "Content-Type": file === "json" ? "application/json" : "application/pdf",
      "Content-Disposition": `${file === "json" ? "attachment" : "inline"}; filename="${path.split("/").pop()}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
