"use client";
export function PrintButton() {
  return <button className="b small noprint" onClick={() => window.print()}>Cetak</button>;
}
