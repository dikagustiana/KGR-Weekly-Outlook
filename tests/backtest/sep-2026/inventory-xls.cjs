const XLSX = require('xlsx');
const path = require('path');
const dir = process.env.BACKTEST_DIR || 'C:\\Users\\USER\\Downloads\\Back test';
for (const f of ['Detail Sales September.xls', 'Valuation detail.xls', 'GL KGR.xls']) {
  const wb = XLSX.readFile(path.join(dir, f));
  console.log('=====', f, '=====');
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const ne = rows.filter((r) => r.some((x) => x !== ''));
    console.log(`  sheet '${sn}' rows=${rows.length} nonEmpty=${ne.length}`);
    for (let i = 0; i < Math.min(5, ne.length); i++) {
      console.log(`    [${i}]`, ne[i].slice(0, 26).map((x) => String(x).slice(0, 20)));
    }
  }
}
