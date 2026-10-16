import type { Metadata, Viewport } from "next";
import "./globals.css";
// PRD v4 grammar, scoped to .v4 (flag v4_design)
import "./v4.css";

export const metadata: Metadata = {
  title: "KGR Weekly Outlook",
  description: "PT Karya Gudang Rabat — outlook mingguan dan keputusan harian",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
