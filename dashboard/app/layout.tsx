import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dashboard - TimescaleDB vs PostgreSQL",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-sm text-slate-900 dark:bg-slate-950 dark:text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
