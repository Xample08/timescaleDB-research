import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Simulator - TimescaleDB vs PostgreSQL",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-sm text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
