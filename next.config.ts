import type { NextConfig } from "next";

// The sandbox preview is embedded cross-origin. Keep clickjacking protection
// enabled everywhere else, including production, unless explicitly in dev preview.
const allowPreviewEmbedding = process.env.NODE_ENV === "development" && process.env.LANDIQ_PREVIEW_EMBED === "1";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(allowPreviewEmbedding ? [] : [{ key: "X-Frame-Options", value: "SAMEORIGIN" }]),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://connect.facebook.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https:; frame-src https:; form-action 'self'; base-uri 'self'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The media form allows 20 MiB files; leave room for multipart overhead.
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/p/:path*", headers: [{ key: "X-Robots-Tag", value: "index, follow, max-snippet:-1" }] },
      // These URLs carry private tracking or password-reset capabilities.
      { source: "/order-confirmed", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "private, no-store" }] },
      { source: "/track/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "private, no-store" }] },
      { source: "/reset-password", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
