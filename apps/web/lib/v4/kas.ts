/**
 * Model of the management page "Kas & solvabilitas" (PRD v4 §6.3). Pure: the cash mart row of the day (with the
 * horizon the rebuild wrote: 13 weeks, 12 months, accounts, drivers), the CCC row and the solvency rows in; one tile
 * list out. Operations and affiliate funding are shown apart and the lowest balance is stated both with and without the
 * affiliate facility (G6, §3.7); the scenario's assumption is on the card. A month without a basis outlook reads
 * "tidak tersedia", never a flat line (G6). The fixture harness builds the same model from fixtures/fs-2026-09.
 */
import { D, Decimal, simulateCcc, toFixedString, type CashSplit, type CccResult, type ControlV3, type cashProjection12m } from "@kgr/engine";
import { jtV4, num, pctV4, tgl, tglShort } from "../fmt";
import type { ChartPoint } from "@/components/v4/Chart";
import type { Col, TRow } from "@/components/v4/Table";
import { monthsToNegative, type TileModel } from "./minggu-ini";
import type { TilePos } from "@/components/v4/Tile";

/**
 * R65 (F13): how the monthly cash change of the 12-month projection is made while v5_pl is on — the NIBT after fixed costs
 * plus the costs that are not cash (depreciation, amortised prepaid). `nibt` null = unknown (no fixed nominal): no projection.
 */
export interface CashRecon {
  nibt: string | null;
  depreciation: string;
  prepaid: { pl_line: string; amount: string }[];
  change: string | null;
}

export interface KasHorizon {
  as_of: string;
  accounts: { account_no: string; bank: string | null; closing: string | null; date: string; carried: boolean }[];
  missing_days: string[];
  /** affiliate_received: the affiliate funding already in the balance of the week of as_of (the scenario takes it out too). */
  weeks: { week_start: string; closing: string | null; closing_without: string | null; operating_in: string | null; operating_out: string | null; affiliate_net: string | null; affiliate_received?: string | null }[];
  months: { month: string; change: string | null; closing: string | null }[] | null;
  /** R65: the reconciliation of `months` (v5_pl on); absent in rows built before v5.2 or with v5_pl off. */
  monthsRecon?: CashRecon | null;
  drivers: { description: string; amount: string | null }[];
  affiliate_received: string | null;
  lowest: { date: string; balance: string | null };
  lowest_without: { date: string; balance: string | null };
  controls: { code: string; status: string }[];
}

const f2 = (x: Decimal | null | undefined) => (x === null || x === undefined ? null : toFixedString(x, 2));

/**
 * The horizon the cash rebuild writes next to the day's row (cash_position_daily.horizon): what the management page
 * shows beyond the day itself. Pure; the rebuild job (lib/v3/cash.ts) and the fixture harness call it the same way.
 */
export function kasHorizon(x: {
  date: string;
  position: { account_no: string; closing: Decimal; date: string; carried: boolean }[];
  banks: Record<string, string | null>;
  controls: ControlV3[];
  split: CashSplit;
  months: ReturnType<typeof cashProjection12m> | null;
  monthsRecon?: CashRecon | null;
  affiliateReceived: Decimal;
}): KasHorizon {
  return {
    as_of: x.date,
    accounts: x.position.map((b) => ({ account_no: b.account_no, bank: x.banks[b.account_no] ?? null, closing: f2(b.closing), date: b.date, carried: b.carried })),
    missing_days: x.controls.find((c) => c.code === "C36")?.detail ?? [],
    weeks: x.split.weeks.map((w, i) => ({
      week_start: w.week_start, closing: f2(w.closing), closing_without: f2(w.closingWithout), operating_in: f2(w.operatingIn), operating_out: f2(w.operatingOut), affiliate_net: f2(w.affiliateNet),
      affiliate_received: i === 0 ? f2(x.affiliateReceived) : null,
    })),
    months: x.months ? x.months.map((m) => ({ month: m.month, change: f2(m.change), closing: f2(m.closing) })) : null,
    ...(x.monthsRecon ? { monthsRecon: x.monthsRecon } : {}),
    drivers: x.split.drivers.map((d) => ({ description: d.description, amount: f2(d.amount) })),
    affiliate_received: f2(x.affiliateReceived),
    lowest: { date: x.split.lowest.date, balance: f2(x.split.lowest.balance) },
    lowest_without: { date: x.split.lowestWithout.date, balance: f2(x.split.lowestWithout.balance) },
    controls: x.controls.map((c) => ({ code: c.code, status: c.status })),
  };
}

export interface KasInput {
  today: string;
  /** The latest cash_position_daily row; null = nothing built yet. */
  row: { date: string; totalClosing: string | null; lowest: string | null; lowestDate: string | null; lowestWithout: string | null; lowestWithoutDate: string | null; assumption: string | null; horizon: KasHorizon | null } | null;
  solvency: { label: string; month: string; equity: string; paidIn: string; affiliate: string | null; months: string | null; basis?: string | null; prevAffiliate: string | null; interestRows: { actual: string | null; forecast: string | null }[] | null } | null;
  ccc: { date: string; dio: string | null; dso: string | null; dpo: string | null; ccc: string | null; workingCapital: string | null; cogsPerDay: string | null; revenuePerDay: string | null; windowDays: number | null } | null;
  /** What-if from the query string: termin LB, termin trading, porsi LB, target hari stok. */
  sim: { lb: string; tr: string; share: string; stock: string };
  base: string;
}

export interface KasModel { title: string; tiles: TileModel[]; hidden: string[] }

const P = (x: number, y: number, w: number, h: number): TilePos => ({ x, y, w, h });
const tone = (v: Decimal | null | undefined): "neg" | undefined => (v !== null && v !== undefined && v.lt(0) ? "neg" : undefined);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const dn = (v: string | null | undefined) => (v === null || v === undefined ? null : D(v));
/** A cash plan description is a bank memo: the part after "—" when there is one, cut to 40 characters. */
const short = (s: string) => { const t = (s.includes("—") ? s.split("—").slice(1).join("—") : s).trim().replace(/\s+/g, " "); return t.length > 40 ? `${t.slice(0, 39)}…` : t; };

export function kasModel(x: KasInput): KasModel {
  const tiles: TileModel[] = [];
  const hidden: string[] = [];
  const row = x.row, h = row?.horizon ?? null, sv = x.solvency;
  const closing = dn(row?.totalClosing), lowest = dn(row?.lowest), lowestWithout = dn(row?.lowestWithout);
  const asOf = row?.date ?? x.today;

  // ---------------------------------------------------------------- headline
  const parts: string[] = [];
  parts.push(closing ? `Kas Rp ${jtV4(closing)} jt per ${tgl(asOf)}` : `Saldo kas per ${tgl(asOf)} belum diisi`);
  if (lowest && row?.lowestDate) parts.push(`terendah 13 minggu Rp ${jtV4(lowest)} jt pada ${tgl(row.lowestDate)}`);
  if (lowestWithout && lowest && !lowestWithout.eq(lowest)) parts.push(`tanpa fasilitas afiliasi Rp ${jtV4(lowestWithout)} jt`);
  let text = parts.join(", ");
  if (sv) text += `; ekuitas Rp ${jtV4(sv.equity)} jt${sv.months !== null ? ` habis dalam ${num(sv.months, 1)} bulan bila rugi ${sv.label.split(" ")[0]} berulang` : ""}`;
  tiles.push({ id: "headline", pos: P(0, 0, 12, 1), kind: "bare", content: { type: "headline", text: `${text}.` } });

  // ---------------------------------------------------------------- cards
  tiles.push({
    id: "c-saldo", pos: P(0, 1, 2, 2), kind: "card", title: `Saldo kas ${tglShort(asOf)}`,
    cara: { title: "Saldo kas", fn: "balancesOn (cash_position_daily.total_closing)", rule: "Jumlah saldo akhir semua rekening pada tanggal itu; rekening tanpa baris hari itu memakai saldo terakhirnya (ditandai).", period: tgl(asOf), basis: "template kas harian", status: "draft", sources: [{ label: "Tabel", value: "cash_position_daily" }] },
    content: closing ? { type: "card", value: jtV4(closing), unit: "Rp jt", negative: closing.lt(0), compare: h ? [{ label: "rekening", value: String(h.accounts.length) }] : [] } : { type: "card", value: null, missing: "belum diisi", compare: [] },
  });
  tiles.push({
    id: "c-terendah", pos: P(2, 1, 3, 2), kind: "card", title: "Terendah 13 minggu",
    cara: { title: "Terendah 13 minggu", fn: "cashProjectionSplit", rule: "Saldo hari ini ditambah rencana kas dan jadwal biaya tetap yang belum direncanakan; skenario tanpa fasilitas mengeluarkan semua arus 'Pinjaman afiliasi (net)' yang direncanakan dan yang sudah diterima.", period: `${tgl(asOf)} + 13 minggu`, basis: "saldo aktual, rencana kas", status: "assumption", sources: [{ label: "Tabel", value: "cash_position_daily (horizon)" }, { label: "Asumsi", value: row?.assumption ?? "belum ada" }] },
    content: lowest && row?.lowestDate
      ? {
          type: "card", value: jtV4(lowest), unit: "Rp jt", negative: lowest.lt(0),
          compare: [
            { label: "tanggal", value: tgl(row.lowestDate) },
            ...(lowestWithout && row.lowestWithoutDate ? [{ label: "tanpa fasilitas afiliasi", value: `${jtV4(lowestWithout)} jt`, tone: tone(lowestWithout) } as const] : []),
          ],
        }
      : { type: "card", value: null, missing: "tidak tersedia", compare: [] },
  });
  if (sv) {
    const aff = D(sv.affiliate), prev = dn(sv.prevAffiliate);
    // Interest Expense of the month (actual + forecast rows of pl_daily_v4), a cost: shown positive
    // (a row carries its actual or its forecast; a row with neither has no amount and adds nothing, no interest rows at all = unknown)
    const interestParts = sv.interestRows ? sv.interestRows.flatMap((r) => [r.actual, r.forecast]).filter((v): v is string => v !== null && v !== undefined) : [];
    const interest = interestParts.length ? interestParts.reduce((a, v) => a.plus(D(v)), D(0)).neg() : null;
    tiles.push({
      id: "c-afiliasi", pos: P(5, 1, 3, 2), kind: "card", title: "Utang pihak berelasi",
      cara: { title: "Utang pihak berelasi", fn: "solvency", rule: "Other Payable – Related Parties + Trade Payables – Affiliates dari neraca mingguan terakhir; bunga = Interest Expense outlook bulan ini.", period: sv.label, basis: "neraca mingguan", status: "draft", sources: [{ label: "Tabel", value: "solvency_monthly, pl_daily_v4" }] },
      content: {
        type: "card", value: sv.affiliate === null ? null : jtV4(aff), unit: "Rp jt", missing: sv.affiliate === null ? "belum ada" : undefined,
        compare: [
          ...(prev && sv.affiliate !== null ? [{ label: aff.gte(prev) ? "naik dari bulan lalu" : "turun dari bulan lalu", value: `${jtV4(aff.minus(prev).abs())} jt`, tone: aff.gt(prev) ? "worse" : aff.lt(prev) ? "better" : undefined } as const] : []),
          { label: `bunga ${MONTHS[Number(sv.month.slice(5, 7)) - 1]}`, value: interest === null ? "belum diisi" : `${jtV4(interest)} jt` },
        ],
      },
    });
    tiles.push({
      id: "c-ekuitas", pos: P(8, 1, 2, 2), kind: "card", title: "Ekuitas",
      cara: { title: "Ekuitas", fn: "solvency", rule: "Shareholder Equity + Retained earnings + Current year profit dari neraca mingguan terakhir; persen terhadap modal disetor (Shareholder Equity).", period: sv.label, basis: "neraca mingguan", status: "draft", sources: [{ label: "Tabel", value: "solvency_monthly" }] },
      content: { type: "card", value: jtV4(sv.equity), unit: "Rp jt", negative: D(sv.equity).lt(0), compare: [{ label: "modal disetor", value: pctV4(D(sv.equity).div(D(sv.paidIn)), 0) }] },
    });
    tiles.push({
      id: "c-bulan-negatif", pos: P(10, 1, 2, 2), kind: "card", title: "Bulan sampai ekuitas negatif",
      cara: { title: "Bulan sampai ekuitas negatif", fn: "solvency", rule: "Ekuitas ÷ rugi sebelum pajak bulan ini, hanya bila bulan ini rugi (NIBT outlook bulan berjalan).", period: sv.label, basis: "outlook bulan", status: "draft", sources: [{ label: "Tabel", value: "solvency_monthly" }] },
      content: sv.months === null ? { type: "card", value: null, missing: monthsToNegative(null, sv.basis), compare: [] } : { type: "card", value: num(sv.months, 1), compare: [] },
    });
  } else hidden.push("c-afiliasi", "c-ekuitas", "c-bulan-negatif");

  // ---------------------------------------------------------------- 13 weeks
  if (h && h.weeks.length) {
    const pts: ChartPoint[] = h.weeks.map((w) => {
      const c = dn(w.closing), cw = dn(w.closing_without);
      return {
        key: w.week_start, label: tglShort(w.week_start).replace(" ", " "), bar: c ? Number(c.div(1e6).toFixed(1)) : null, barText: c ? jtV4(c) : undefined, barTone: "s1",
        line: cw ? Number(cw.div(1e6).toFixed(1)) : null, lineText: cw ? jtV4(cw) : undefined,
        title: `Minggu ${tgl(w.week_start)} · saldo akhir Rp ${c ? jtV4(c) : "belum diisi"} jt · tanpa fasilitas afiliasi Rp ${cw ? jtV4(cw) : "belum diisi"} jt`,
      };
    });
    tiles.push({
      id: "ch-13minggu", pos: P(0, 3, 7, 4), kind: "tall", title: "Saldo akhir per minggu, 13 minggu",
      note: `Garis: tanpa fasilitas afiliasi, yaitu arus afiliasi yang direncanakan${h.weeks[0]?.affiliate_received && !D(h.weeks[0].affiliate_received).isZero() ? ` dan Rp ${jtV4(h.weeks[0].affiliate_received)} jt yang sudah masuk minggu ini` : ""} dikeluarkan (asumsi).`,
      cara: { title: "Saldo akhir per minggu", fn: "cashProjectionSplit (cash_position_daily.horizon)", rule: "Batang = saldo akhir minggu dengan rencana kas; garis = skenario tanpa fasilitas afiliasi.", period: `${tgl(asOf)} + 13 minggu`, basis: "saldo aktual, rencana kas", status: "assumption", sources: [{ label: "Tabel", value: "cash_position_daily (horizon)" }] },
      content: { type: "combo", points: pts, labelMax: 13, legend: [{ tone: "s1", label: "dengan pendanaan afiliasi" }, { tone: "ln", label: "tanpa fasilitas afiliasi" }] },
    });
  } else tiles.push({ id: "ch-13minggu", pos: P(0, 3, 7, 4), kind: "tall", title: "Saldo akhir per minggu, 13 minggu", content: { type: "list", items: ["tidak ada data untuk periode ini"] } });

  // ---------------------------------------------------------------- accounts
  {
    const cols: Col[] = [{ key: "a", label: "Rekening", kind: "key" }, { key: "b", label: "Bank", kind: "sup" }, { key: "s", label: "Saldo (Rp jt)", num: true }, { key: "d", label: "Per", kind: "sup" }];
    const rows: TRow[] = (h?.accounts ?? []).map((a) => ({ id: a.account_no, cells: { a: a.account_no, b: a.bank ?? "belum diisi", s: a.closing ? jtV4(a.closing) : "belum diisi", d: a.carried ? tglShort(a.date) : "hari ini" } }));
    const miss = h?.missing_days ?? [];
    tiles.push({
      id: "t-rekening", pos: P(7, 3, 5, 4), kind: "tall", title: "Saldo per rekening",
      note: h ? (miss.length ? `${miss.length} hari kerja tanpa upload kas: ${miss.slice(0, 3).map(tglShort).join(", ")}${miss.length > 3 ? " …" : ""}.` : "Semua hari kerja punya upload kas.") : undefined,
      content: { type: "table", cols, rows, limit: 10 },
    });
  }

  // ---------------------------------------------------------------- 12 months
  if (h?.months) {
    const pts: ChartPoint[] = h.months.map((m) => {
      const ch = dn(m.change), c = dn(m.closing);
      return {
        key: m.month, label: `${MONTHS[Number(m.month.slice(5, 7)) - 1]}`, bar: ch ? Number(ch.div(1e6).toFixed(1)) : null, barText: ch ? jtV4(ch) : undefined, barTone: "s2",
        line: c ? Number(c.div(1e6).toFixed(1)) : null, lineText: c ? jtV4(c) : undefined,
        title: `${m.month.slice(0, 7)} · perubahan kas Rp ${ch ? jtV4(ch) : "belum diisi"} jt · saldo akhir Rp ${c ? jtV4(c) : "belum diisi"} jt`,
      };
    });
    const rc = h.monthsRecon ?? null;
    const reconText = rc && rc.nibt !== null && rc.change !== null
      ? `Perubahan kas per bulan = NIBT setelah beban tetap ${jtV4(rc.nibt)} jt + penyusutan nonkas ${jtV4(rc.depreciation)} jt${rc.prepaid.length ? ` + amortisasi prepaid ${jtV4(rc.prepaid.reduce((a, p) => a.plus(D(p.amount)), D(0)))} jt` : ""} = ${jtV4(rc.change)} jt, dipertahankan tetap.`
      : null;
    tiles.push({
      id: "ch-12bulan", pos: P(0, 7, 6, 4), kind: "tall", title: "Kas 12 bulan",
      note: reconText ?? "Bulan berjalan dan seterusnya: laba sebelum pajak outlook bulan ini ditambah penyusutan, dipertahankan tetap.",
      cara: { title: "Kas 12 bulan", fn: "cashProjection12m", rule: rc ? "Saldo hari ini; tiap bulan berubah sebesar NIBT setelah beban tetap bulan berjalan (v5_pl) ditambah beban nonkas yang ada di dalamnya (penyusutan, amortisasi prepaid: tidak mengurangi kas), dipertahankan tetap. Perkiraan kasar, bukan rencana kas." : "Saldo hari ini; tiap bulan berubah sebesar NIBT outlook bulan berjalan ditambah penyusutan (non-kas), dipertahankan tetap. Perkiraan kasar, bukan rencana kas.", period: "12 bulan dari bulan ini", basis: rc ? "NIBT setelah beban tetap" : "outlook bulan", status: "assumption", sources: [{ label: "Tabel", value: "cash_position_daily (horizon), pl_daily_v4" }] },
      content: { type: "combo", points: pts, labelMax: 12, legend: [{ tone: "s2", label: "perubahan kas" }, { tone: "ln", label: "saldo akhir" }] },
    });
  } else tiles.push({ id: "ch-12bulan", pos: P(0, 7, 6, 4), kind: "tall", title: "Kas 12 bulan", content: { type: "list", items: [h?.monthsRecon && h.monthsRecon.nibt === null ? "tidak tersedia: NIBT setelah beban tetap belum ada (beban tetap bulan ini kosong, C55); NIBT jurnal tidak dipakai sebagai pengganti" : "tidak tersedia: outlook bulanan belum menjadi basis"] } });

  // ---------------------------------------------------------------- CCC
  {
    const c = x.ccc;
    if (c && c.dio !== null && c.dso !== null && c.dpo !== null && c.ccc !== null && c.workingCapital !== null && c.cogsPerDay !== null && c.revenuePerDay !== null) {
      const base: CccResult = { dio: D(c.dio), dso: D(c.dso), dpo: D(c.dpo), ccc: D(c.ccc), cogsPerDay: D(c.cogsPerDay), revenuePerDay: D(c.revenuePerDay), workingCapital: D(c.workingCapital) };
      const sim = simulateCcc(base, { termsLbDays: x.sim.lb, termsTradingDays: x.sim.tr, shareLb: x.sim.share, targetStockDays: x.sim.stock === "" ? null : x.sim.stock });
      const cols: Col[] = [{ key: "k", label: "", kind: "key" }, { key: "n", label: "Sekarang", num: true }, { key: "s", label: "Simulasi", num: true }];
      const d1 = (v: Decimal) => num(v, 1);
      const rows: TRow[] = [
        { id: "dio", cells: { k: "DIO (hari)", n: d1(base.dio), s: d1(sim.dio) } }, { id: "dso", cells: { k: "DSO (hari)", n: d1(base.dso), s: d1(sim.dso) } },
        { id: "dpo", cells: { k: "DPO (hari)", n: d1(base.dpo), s: d1(sim.dpo) } }, { id: "ccc", cells: { k: "CCC (hari)", n: d1(base.ccc), s: d1(sim.ccc) }, kind: "total" },
        { id: "wc", cells: { k: "Modal kerja terikat (Rp jt)", n: jtV4(base.workingCapital), s: jtV4(sim.workingCapital) } },
        { id: "dwc", cells: { k: "Selisih modal kerja (Rp jt)", n: "", s: jtV4(sim.deltaWorkingCapital) } },
      ];
      tiles.push({
        id: "ccc", pos: P(6, 7, 6, 4), kind: "tall", title: "Siklus kas",
        note: c.windowDays ? `HPP dan penjualan dari jurnal ${c.windowDays} hari terakhir (maks. 90).` : "HPP dan penjualan dari jurnal (jumlah hari belum diketahui, maks. 90).",
        cara: { title: "Siklus kas", fn: "ccc, simulateCcc", rule: "DIO = persediaan ÷ HPP per hari; DSO = piutang ÷ penjualan per hari; DPO = utang dagang ÷ HPP per hari; CCC = DIO + DSO − DPO. Simulasi: termin LB dan trading dibobot porsi pembelian menjadi DPO; target hari stok menggantikan DIO.", period: tgl(c.date), basis: "neraca mingguan, jurnal 90 hari", status: "draft", sources: [{ label: "Tabel", value: "ccc_daily" }] },
        content: {
          type: "table", cols, rows,
          form: { method: "get", action: x.base, submit: "Hitung", fields: [{ name: "lb", label: "Termin LB (hari)", value: x.sim.lb, size: 3 }, { name: "tr", label: "Termin trading (hari)", value: x.sim.tr, size: 3 }, { name: "share", label: "Porsi LB (0–1)", value: x.sim.share, size: 3 }, { name: "stock", label: "Target hari stok", value: x.sim.stock, size: 3 }] },
        },
      });
    } else tiles.push({ id: "ccc", pos: P(6, 7, 6, 4), kind: "tall", title: "Siklus kas", content: { type: "list", items: ["Belum ada neraca mingguan atau jurnal untuk menghitung siklus kas."] } });
  }

  // ---------------------------------------------------------------- operations vs affiliate funding
  if (h && h.weeks.length) {
    const cols: Col[] = [
      { key: "w", label: "Minggu", kind: "key" }, { key: "i", label: "Masuk operasi", num: true }, { key: "o", label: "Keluar operasi", num: true }, { key: "n", label: "Arus operasi", num: true },
      { key: "a", label: "Pendanaan afiliasi rencana", num: true, kind: "sup" }, { key: "r", label: "Afiliasi sudah masuk", num: true, kind: "sup" }, { key: "c", label: "Saldo akhir", num: true, kind: "key" }, { key: "x", label: "Tanpa fasilitas", num: true },
    ];
    const rows: TRow[] = h.weeks.map((w) => {
      const i = dn(w.operating_in), o = dn(w.operating_out), na = "belum diisi";
      return { id: w.week_start, cells: { w: `${tglShort(w.week_start)}`, i: i ? jtV4(i) : na, o: o ? jtV4(o) : na, n: i && o ? jtV4(i.plus(o)) : na, a: w.affiliate_net === null || w.affiliate_net === undefined ? na : jtV4(w.affiliate_net), r: w.affiliate_received ? jtV4(w.affiliate_received) : "", c: w.closing ? jtV4(w.closing) : "belum diisi", x: w.closing_without ? jtV4(w.closing_without) : "belum diisi" } };
    });
    const drivers = h.drivers.filter((d) => d.amount !== null).slice(0, 3);
    tiles.push({
      id: "t-arus", pos: P(0, 11, 12, 4), kind: "tall", title: "Arus kas operasi vs pendanaan afiliasi per minggu (Rp jt)",
      note: drivers.length && row?.lowestWithoutDate ? `Terendah tanpa fasilitas ${tglShort(row.lowestWithoutDate)}; pembayaran terbesar hari itu: ${drivers.map((d) => `${short(d.description)} ${jtV4(d.amount)} jt`).join("; ")}.` : undefined,
      content: { type: "table", cols, rows, limit: 8 },
    });
  } else tiles.push({ id: "t-arus", pos: P(0, 11, 12, 4), kind: "tall", title: "Arus kas operasi vs pendanaan afiliasi per minggu (Rp jt)", content: { type: "list", items: ["tidak ada data untuk periode ini"] } });

  return { title: "Kas & solvabilitas", tiles, hidden };
}
