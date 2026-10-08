import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static shell + streamed Suspense holes. Reading request data outside
  // <Suspense> is a build error, which enforces the no-loading.tsx architecture.
  cacheComponents: true,
  // One App Shell prefetch per route instead of one per link. It was off in 16.3.8, which re-requested
  // every link's route tree in a loop with it on (~650 req/s on the Library, Phase 1 QA). 16.4 fixed that,
  // and now loops with it off instead: one template row re-requests the @modal [...catchAll] segment
  // (~2,000 req/s, still in 16.5.0-canary.2). e2e/phase-1.spec.ts "router prefetch" guards both.
  partialPrefetching: true,
  typedRoutes: true,
  devIndicators: false, // keeps the dev badge off the sidebar in screenshots
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
