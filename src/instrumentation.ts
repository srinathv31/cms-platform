// Next.js calls `register()` once when the server starts, before it takes a request
// (node_modules/next/dist/docs/01-app/02-guides/instrumentation.md). It loads the configuration check, so
// a setting that isn't valid (`DEMO_MODE=banana`) stops the server at boot, with the message. Without it
// the server reports Ready, and every page whose route module imports `@/server/config` throws at its
// first request, so the operator learns of it from users.
//
// Node.js only, and in its own file (`instrumentation-node.ts`) as Next's guide shows: the check reads
// `process.env` and calls `process.exit`, which the Edge analysis of this file would warn about.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkConfiguration } = await import("./instrumentation-node");
    await checkConfiguration();
  }
}
