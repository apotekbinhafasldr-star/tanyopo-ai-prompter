import type { NextConfig } from "next";

// Enforced security headers. Only headers that cannot break rendering are enforced.
// Camera, microphone and geolocation are not used anywhere in this app (verified by
// code search), so they are denied. If a feature ever needs one, relax it here.
const enforcedSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

// Content-Security-Policy is REPORT-ONLY: violations are logged in the browser console
// but nothing is blocked. Next.js needs inline scripts/styles, and checkout uses Midtrans
// Snap, so enforcing blind could break pages. Tighten, then switch to
// "Content-Security-Policy" only after a clean console on the main flows (see docs/RUNBOOK.md).
export const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://app.sandbox.midtrans.com https://app.midtrans.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.midtrans.com",
  "frame-src 'self' https://*.midtrans.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...enforcedSecurityHeaders, { key: "Content-Security-Policy-Report-Only", value: cspReportOnly }],
      },
    ];
  },
};

export default nextConfig;
