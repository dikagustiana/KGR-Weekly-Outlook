/**
 * Management View v2 R5: the engine's sheet names (Excel vocabulary) in plain words for the management view.
 * The preparer view keeps the sheet names.
 */
const NAMES: [RegExp, string][] = [
  [/I_Parameter minggu lalu/g, "Parameter minggu lalu"],
  [/I_Parameter/g, "Parameter harian"],
  [/O_Stok/g, "Stok hari ini"],
  [/T_Batch/g, "Rencana batch"],
  [/T_Penjualan/g, "Penjualan"],
  [/T_Penerimaan/g, "Penerimaan"],
  [/T_Kas_Rencana/g, "Rencana kas"],
  [/T_GL/g, "Jurnal"],
  [/I_Master/g, "Master SKU"],
  [/I_Item/g, "Master item"],
  [/I_COA/g, "Master akun"],
  [/I_TB/g, "Neraca saldo"],
  [/O_PnL/g, "Laba rugi"],
  [/O_BS/g, "Neraca"],
  [/O_CF/g, "Arus kas"],
  [/O_Outlook/g, "Outlook"],
];

/** Replace every sheet name; anything left that still looks like one loses its prefix. */
export function humanize(text: string): string;
export function humanize(text: string | undefined): string | undefined;
export function humanize(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  let out = text;
  for (const [re, name] of NAMES) out = out.replace(re, name);
  return out.replace(/(?<![A-Za-z0-9])[IOTBZ]_([A-Za-z])/g, "$1");
}
