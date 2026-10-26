import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "ProofGate — verification layer for AI-generated code",
  description:
    "Run deterministic checks on a unified diff, review heuristic findings and export an evidence-backed report. No uploaded code is executed.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07080b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}