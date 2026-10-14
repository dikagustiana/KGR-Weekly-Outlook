# Prompt — Management View v2

Paste ke Claude Code dari root repo. Spec: `docs/PRD-management-view-v2.md`.

---

Kamu bekerja di repo KGR Weekly Outlook (pnpm workspace: `apps/web`, `packages/engine`, `packages/parsers`). Tugas: implementasi `docs/PRD-management-view-v2.md`. Ini refactor tampilan berbasis role — BUKAN perubahan logika perhitungan.

Sebelum menulis kode:

1. Inspeksi repo. Laporkan dalam ≤15 baris: framework `apps/web`, cara routing `/w/[week]/outlook`, di mana role user disimpan dan diteruskan ke page, di mana komponen seksi ringkasan / RPA / stok / peringatan hidup, dan di mana `packages/engine` menghasilkan `warnings` dan `recommendation`. Baca filenya, jangan asumsi.
2. Buat baseline: jalankan engine untuk minggu 2026-08-24 (pakai fixtures yang ada) dan simpan output JSON ke `tests/snapshots/outlook-2026-08-24.before.json`. Ini harus identik di akhir kecuali field yang diizinkan PRD §5.
3. Berhenti. Tunjukkan rencana file-per-file sebelum mengubah apa pun.

Batasan keras:

- Angka, rumus, yield, breakeven, logika kontrol di `packages/engine`: tidak disentuh, kecuali dua tambahan field (`warning.audience`, `recommendation.action`). Kalau requirement lain terasa butuh menyentuh engine, berhenti dan tanya.
- Golden tests v1 harus tetap hijau.
- Tidak ada redesign palet/font/grid. Pakai token CSS existing. Token baru (mis. `--surface-2`) ditambah di file token existing, tidak hardcode.
- Tidak ada ikon baru kecuali satu ikon `?` untuk tooltip R5. Tidak ada emoji.
- Tab INPUT dan ADMIN tidak disentuh selain disembunyikan dari role manajemen (R13).
- Satu PR per tahap PRD §6 (4 PR). Jangan gabung.

Urutan kerja (PRD §6):

- Tahap 1 — R1. `viewMode: 'management' | 'preparer'` diturunkan dari role existing, plus toggle untuk preparer. Belum ada perubahan visual selain toggle.
- Tahap 2 — R2, R4, R9 (baris nol). Sebelum R4: konfirmasi aturan prioritas NEGOSIASI > TUNDA (PRD §7) — jangan implementasi sebelum dijawab.
- Tahap 3 — R3, R5, R10, R12, R13.
- Tahap 4 — R6, R7, R8, R11, R14, R15, R16.

Setiap PR ditutup dengan:

- Diff JSON engine vs baseline: harus kosong kecuali `warning.audience` dan `recommendation.action`.
- Screenshot `/w/2026-08-24/outlook` di 1366×768 untuk kedua role.
- Checklist PRD §5 dengan PASS/FAIL per item dan bukti (selector DOM, hasil grep, ukuran viewport). Item tanpa bukti = belum dicek; tulis begitu, jangan tandai PASS.
- Bahasa UI: Indonesia, konsisten dengan string existing. Jangan terjemahkan ulang label yang sudah dipakai.

Kalau ada ambiguitas di PRD, tanya satu pertanyaan per tahap. Jangan menebak, jangan memperluas scope.
