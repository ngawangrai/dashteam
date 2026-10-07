import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // Standalone output keeps the app runnable on any Node host, not only Vercel.
  output: "standalone",
  poweredByHeader: false,
  typedRoutes: true,
  // CLAUDE.md is ours; stop `next dev` from appending its own agent rules to it.
  agentRules: false,
  // react-pdf renders payslips on the server; it runs as plain Node, not bundled.
  serverExternalPackages: ["@react-pdf/renderer", "xlsx"],
  // Read from disk at runtime, so a standalone build must carry them: the payslip's fonts (and logo,
  // once added) and DRC's IT-1(a) template.
  outputFileTracingIncludes: { "/**": ["./src/modules/documents/fonts/**", "./src/modules/documents/assets/**", "./src/modules/filing/template/**"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
