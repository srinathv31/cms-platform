// What `register()` (instrumentation.ts) runs in the Node.js runtime: load the server's configuration, whose
// module throws, naming the variable, when a setting isn't valid (`src/server/config.ts`).
//
// The process exits rather than rethrows: in Next 16 a throw from `register()` is logged as "Failed to
// prepare server", and the process stays up answering 500 to every request, `/api/v1` included. A
// supervisor (systemd, a container) restarts or reports an exit; it can't tell that server from a healthy one.

export async function checkConfiguration() {
  try {
    await import("@/server/config");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Stencil did not start. ${reason}`);
    process.exit(1);
  }
}
