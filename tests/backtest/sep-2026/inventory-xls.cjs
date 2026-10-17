const XLSX = require('xlsx');
const path = require('path');
const dir = process.env.BACKTEST_DIR || 'C:\\Users\\USER\\Downloads\\Back test';
for (const f of ['Detail Sales September.xls', 'Valuation detail.xls']) {
  const wb = XLSX.readFile(path.join(dir, f));
  console.log('=====', f, '=====');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  for (let i = 2; i < Math.min(9, rows.length); i++) {
    const r = rows[i];
    const full = r.map((x, j) => (x !== '' && x != null ? `${j}:${String(x).slice(0, 26)}` : '')).filter(Boolean);
    console.log(`  [${i}]`, full.join(' | '));
  }
}
