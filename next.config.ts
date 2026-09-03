import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baseline security headers, applied platform-agnostically (works the
  // same via `next start` and via the Netlify Next.js Runtime, which
  // translates this into its own header rules at build time). A real
  // Content-Security-Policy is deliberately NOT set here — this app hasn't
  // been observed in production long enough to enumerate every script/
  // connect-src it legitimately needs (Next.js hydration, Supabase SSR,
  // future ad-platform SDKs), and a guessed CSP that's too strict silently
  // breaks the app rather than failing loudly. Add one only after a real
  // audit of what the deployed app actually loads.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Safe here: this app is only ever served over HTTPS (Netlify's
          // default domain and any custom domain both terminate TLS at the
          // edge) — there is no plain-HTTP deployment target to break.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
