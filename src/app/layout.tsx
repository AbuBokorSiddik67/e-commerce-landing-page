import type { Metadata } from "next";
import "./globals.css";
import { siteUrl } from "@/lib/config";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "LANDIQ — E-commerce Landing Page Software", template: "%s | LANDIQ" },
  description: "Self-hosted, single-business e-commerce landing page management software. Products, landing pages, orders, COD and analytics in one dashboard.",
  openGraph: { siteName: "LANDIQ", type: "website" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
