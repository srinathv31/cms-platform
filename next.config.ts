import type { NextConfig } from "next";

// Security headers on every response.
//   - Framing: same origin only (`X-Frame-Options`). Coral's customer view frames
//     `/sim/deliveries/{id}/file` (the web page, the email and the PDF) from this origin, and the previews
//     are `srcdoc` frames; nothing else frames the app. Not `frame-ancestors`: a header set here replaces a
//     route's own header of the same name, and the rendered HTML's scriptless Content-Security-Policy
//     (`render-http.ts`, Coral's file route) must stay (e2e/security-headers.spec.ts checks it does).
//   - Referrer: sent to this origin only. `same-origin`, not `no-referrer`, which would also blank the
//     Origin header a server action's POST is checked by.
//   - Left out: a Content-Security-Policy for scripts (Next's inline scripts need a per-request nonce,
//     which needs dynamic rendering and fights the static shells Cache Components builds; a hash-based
//     CSP or `'strict-dynamic'` is a decision of its own), and Strict-Transport-Security, which belongs to
//     the TLS terminator in front of the app (set here, it would pin HTTPS on every port of the host).
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // Static shell + streamed Suspense holes. Reading request data outside
  // <Suspense> is a build error, which enforces the no-loading.tsx architecture.
  cacheComponents: true,
  // partialPrefetching is off: in 16.3.8 it re-requests every link's route tree in a loop in this app
  // (~650 req/s on the Library, Phase 1 QA). Default prefetching stays on.
  typedRoutes: true,
  devIndicators: false, // keeps the dev badge off the sidebar in screenshots
  serverExternalPackages: ["@libsql/client", "libsql"],
  headers: async () => [{ source: "/:path*", headers: SECURITY_HEADERS }],
};

export default nextConfig;
