/**
 * Q-v5.2-52: the action behind "Bangun ulang antrean (sampai hari ini)" on the allocation screen. The role is checked in the
 * action (PPIC and Admin; every other role is refused before anything is read); the rebuild runs through lib/rebuild-until.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WriteError } from "../write";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
let who = "ppic";
const until = vi.fn(async (_sb: unknown, _s: unknown, _d: string) => ({ queued: 10, done: 7, failed: 0, left: 3, notes: [] as string[] }));
vi.mock("@/lib/supabase", () => ({ supabaseServer: async () => ({}) }));
vi.mock("@/lib/modules", () => ({
  moduleSettings: async () => ({}),
  requireModuleAction: async (_key: string, roles: string[]) => {
    if (!roles.includes(who)) throw new WriteError("Peran Anda tidak boleh melakukan ini");
    return { email: `${who}@x.test`, role: who };
  },
}));
vi.mock("@/lib/rebuild", () => ({ moduleSettingsGlobal: (s: unknown) => s }));
vi.mock("@/lib/rebuild-until", () => ({ rebuildQueueUntil: (sb: unknown, s: unknown, d: string) => until(sb, s, d) }));
vi.mock("@/lib/v3/allocation", () => ({ allocateDay: async () => "", cutoffDay: async () => "" }));
vi.mock("@/lib/v3/delivery", () => ({ recordDelivery: async () => "" }));
const { rebuildQueueAction } = await import("@/app/hari/[date]/alokasi/actions");

afterEach(() => { who = "ppic"; until.mockClear(); });
const form = (date: string) => { const d = new FormData(); d.append("date", date); return d; };

describe("Q-v5.2-52: rebuildQueueAction", () => {
  for (const role of ["ppic", "admin"]) {
    it(`${role}: dibangun ulang sampai tanggal layar, hasilnya dilaporkan`, async () => {
      who = role;
      const r = await rebuildQueueAction({}, form("2026-08-27"));
      expect(until).toHaveBeenCalledTimes(1);
      expect(until.mock.calls[0][2]).toBe("2026-08-27");
      expect(r.error).toBeUndefined();
      expect(r.ok).toBe("Antrean dibangun ulang sampai 2026-08-27: 7 selesai; 3 tanggal tersisa, tekan lagi.");
    });
  }
  for (const role of ["sales", "commercial_lead", "finance", "inventory_accounting", "cost_accounting", "purchasing", "management", "operations_director"]) {
    it(`${role}: ditolak di action, antrean tidak disentuh`, async () => {
      who = role;
      const r = await rebuildQueueAction({}, form("2026-08-27"));
      expect(r.error).toMatch(/tidak boleh/);
      expect(until).not.toHaveBeenCalled();
    });
  }
  it("tanggal tidak valid ditolak", async () => {
    expect((await rebuildQueueAction({}, form("besok"))).error).toBe("Tanggal tidak valid");
    expect(until).not.toHaveBeenCalled();
  });
  it("antrean sudah kosong sampai tanggal itu: pesan yang menunjuk tanggal gagal di Admin → Modul", async () => {
    until.mockResolvedValueOnce({ queued: 0, done: 0, failed: 0, left: 0, notes: [] });
    expect((await rebuildQueueAction({}, form("2026-08-27"))).ok).toMatch(/Tidak ada tanggal di antrean sampai 2026-08-27.*Admin → Modul/);
  });
  it("skema tertinggal: pesan banner sampai ke layar, tidak ada yang dibangun", async () => {
    until.mockRejectedValueOnce(new WriteError("Skema database belum diperbarui ke v5.2.0; hubungi Admin (schema_version())"));
    expect((await rebuildQueueAction({}, form("2026-08-27"))).error).toMatch(/^Skema database belum diperbarui/);
  });
});
