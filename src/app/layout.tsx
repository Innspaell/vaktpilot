import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vaktpilot",
  description: "Vaktplan, bemanning og timer",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Vaktpilot", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1f5fbf",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nb">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
