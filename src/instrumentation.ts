// Next.js calls `register()` once when the server starts, before it takes a request
// (node_modules/next/dist/docs/01-app/02-guides/instrumentation.md). Loading the configuration here makes
// a setting that isn't valid (`DEMO_MODE=banana`) stop the server at boot, with the message. Without it
// the server reports Ready, and every page whose route module imports `@/server/config` throws at its
// first request, so the operator learns of it from users.
//
// The process exits rather than rethrows: in Next 16 a throw from `register()` is logged as "Failed to
// prepare server", and the process stays up answering 500 to every request, `/api/v1` included. A
// supervisor (systemd, a container) restarts or reports an exit; it can't tell that server from a healthy one.
//
// Node.js only: the configuration reads `process.env`, and this app has no Edge code.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    await import("@/server/config");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Stencil did not start. ${reason}`);
    process.exit(1);
  }
}
