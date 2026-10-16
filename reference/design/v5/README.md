# Mockup v5 — KGR Management View v2 (Claude Design, versi 21)

Enam artboard, satu file per layar. Format `.dc.html` (Claude Design): markup di dalam `<x-dc>`, data dan logika di `<script type="text/x-dc">` (`class Component extends DCLogic`, `renderVals()`).

File ini tidak bisa dibuka langsung di browser: runtime `support.js` milik Claude Design tidak ikut. Baca sebagai spec:
- tata letak tile: atribut `grid-column` / `grid-row` di tiap `<section class="kgr-tile">`;
- teks dan label: markup;
- angka dan aturan tampilan: konstanta dan `renderVals()` di blok script.

| File | Layar | PRD v5 |
|---|---|---|
| Main.dc.html | Manajemen · Minggu ini | §6.1 |
| Commercial.dc.html | Commercial | §6.2 |
| PPIC.dc.html | PPIC · Rencana | §6.3 |
| Input.dc.html | Input · tugas per role (validasi upload ada di fungsi `validate`) | §6.4, §4.9 |
| Bulanan.dc.html | Outlook bulan | §6.5 |
| Kas.dc.html | Kas & solvabilitas | §6.6 |

`Input.dc.html` memuat `/_blob/d86ba60ac49ecb7b0d308d34033e0336` = SheetJS 0.18.5 `xlsx.mini.min.js` (dari npm). Angka bertanda ilustrasi di PRD v5 Lampiran D tidak boleh dipakai sebagai seed atau golden.
