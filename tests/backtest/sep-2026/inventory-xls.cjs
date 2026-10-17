const XLSX = require('xlsx');
const path = require('path');
const dir = process.env.BACKTEST_DIR || 'C:\\Users\\USER\\Downloads\\Back test';
const files = ['GL KGR Rev 1.xls', 'Detail Sales September.xls', 'Valuation detail.xls'];
for (const f of files) {
  let wb;
  try { wb = XLSX.readFile(path.join(dir, f)); } catch (e) { console.log('=====', f, 'ERROR', e.message, '====='); continue; }
  console.log('=====', f, '=====');
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const nonEmpty = rows.filter((r) => r.some((x) => x !== ''));
    console.log(`  sheet '${sn}' rows=${rows.length} nonEmpty=${nonEmpty.length}`);
    // print rows 2..5 (likely header + first data)
    for (let i = 2; i < Math.min(6, nonEmpty.length); i++) {
      const r = nonEmpty[i];
      console.log(`    [${i}]`, r.slice(0, 26).map((x) => String(x).slice(0, 22)));
    }
  }
}
