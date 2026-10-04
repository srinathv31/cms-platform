import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static shell + streamed Suspense holes. Reading request data outside
  // <Suspense> is a build error, which enforces the no-loading.tsx architecture.
  cacheComponents: true,
  // partialPrefetching is off: in 16.3.8 it re-requests every link's route tree in a loop in this app
  // (~650 req/s on the Library, Phase 1 QA). Default prefetching stays on.
  typedRoutes: true,
  devIndicators: false, // keeps the dev badge off the sidebar in screenshots
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
