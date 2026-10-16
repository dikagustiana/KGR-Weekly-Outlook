# Banding screenshot: kas-solvabilitas

Mockup `reference/design/kas-solvabilitas.html` lawan halaman `kas-solvabilitas.html` dari harness fixture (`apps/web/scripts/v4-fixture.tsx`), viewport 1366×768. Pasangan gambar di `img/`.

| Mockup (1366×768) | Halaman (1366×768) |
| --- | --- |
| ![mockup](img/kas-solvabilitas-mockup-1366x768.png) | ![halaman](img/kas-solvabilitas-halaman-1366x768.png) |

| Mockup (penuh) | Halaman (penuh) |
| --- | --- |
| ![mockup](img/kas-solvabilitas-mockup-full.png) | ![halaman](img/kas-solvabilitas-halaman-full.png) |

## Above the fold

LULUS: baris 0–3 (headline, c-saldo, c-terendah, c-afiliasi, c-ekuitas, c-bulan-negatif, ch-13minggu, t-rekening) berakhir di atas 768px (paling bawah 679px), scrollY = 0.

## Grep DOM halaman

| Pola | Jumlah | Contoh |
| --- | --- | --- |
| I_, O_, T_ (nama lembar teknis) | 0 |  |
| alamat e-mail | 0 |  |
| "bersumber Ops" | 0 |  |
| "→" | 0 |  |
| "M " sebagai satuan | 0 |  |
| # hex inline (style=) | 0 |  |
| fontSize inline | 0 |  |

## Kontras token (§5.2)

| Pasangan | Rasio | Minimum | |
| --- | --- | --- | --- |
| teks --text di atas --surface | 15,73:1 | 4.5:1 | lulus |
| --muted di atas --surface | 4,98:1 | 4.5:1 | lulus |
| --muted di atas --bg | 4,57:1 | 4.5:1 | lulus |
| --bad (teks) di atas --surface | 5,40:1 | 4.5:1 | lulus |
| --good (teks) di atas --surface | 5,02:1 | 4.5:1 | lulus |
| --accent (teks) di atas --surface | 5,38:1 | 4.5:1 | lulus |
| --accent di atas --accent-soft | 4,67:1 | 4.5:1 | lulus |
| bar --chart-1 vs --surface | 5,38:1 | 3:1 | lulus |
| bar --chart-2 vs --surface | 3,08:1 | 3:1 | lulus |
| bar --chart-3 vs --surface | 4,83:1 | 3:1 | lulus |

## Selisih per tile (3)

Tile di mockup: 11; di halaman: 11.

| Tile | Aspek | Mockup | Halaman |
| --- | --- | --- | --- |
| ccc | catatan | (tanpa catatan) | HPP dan penjualan dari jurnal 30 hari terakhir (maks. 90). |
| t-arus | judul | Arus kas operasi vs pendanaan afiliasi, minggu 24–30 Agu (Rp jt) | Arus kas operasi vs pendanaan afiliasi per minggu (Rp jt) |
| t-arus | nilai |  | tidak ada data untuk periode ini |
