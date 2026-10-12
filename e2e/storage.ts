import path from "node:path";

// Where e2e keeps its data: its own database file and uploads folder per worker, never the demo's
// (`data/ucomp.db`, `data/uploads`). A run starts one server per worker (`playwright.config.ts`), each on its own
// port, database (`data/e2e-<slot>.db`) and uploads folder (`data/e2e-uploads-<slot>`), so spec files running side
// by side never see each other's data. The slot is Playwright's `TEST_PARALLEL_INDEX`: it is set in every worker
// process before the config and the specs load, and a worker that Playwright restarts after a failure keeps it.
// The config process has no slot and reads 0, which only matters for the first server.
//
// `playwright.config.ts` hands these to the server it starts as `DATABASE_URL` and `UPLOADS_DIR`, and every
// helper that opens the database or the uploads folder reads them from here, so a worker's server and its specs
// always see the same files.
//
// Set `E2E_DATABASE_URL` or `E2E_UPLOADS_DIR` to use others: the run then has one worker and one database
// (`E2E_PORT`, a server you started yourself, does the same). Start that server with the same `DATABASE_URL` and
// `UPLOADS_DIR`.

const fromEnv = (name: string) => process.env[name] || undefined;

/** `file:/abs/path` whatever the working directory; a non-file URL (libsql://…) passes through. */
function absoluteFileUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  return `file:${path.resolve(process.cwd(), url.slice("file:".length))}`;
}

/** The port of the first server; the others follow it (`E2E_GATE_PORT`, 3100 by default). */
export const E2E_GATE_PORT = Number(process.env.E2E_GATE_PORT ?? 3100);

/** A server started outside Playwright (`E2E_PORT`, e.g. a dev server on 3000), or undefined when Playwright starts them. */
export const E2E_EXTERNAL_PORT = process.env.E2E_PORT && Number(process.env.E2E_PORT) !== E2E_GATE_PORT ? Number(process.env.E2E_PORT) : undefined;

/** True when the run has one database or one server that Playwright does not own: it cannot be split across workers. */
export const E2E_SHARED_STORAGE = E2E_EXTERNAL_PORT !== undefined || Boolean(fromEnv("E2E_DATABASE_URL") || fromEnv("E2E_UPLOADS_DIR"));

export const e2ePort = (slot: number) => E2E_EXTERNAL_PORT ?? E2E_GATE_PORT + slot;

export const e2eDatabaseUrl = (slot: number) => absoluteFileUrl(fromEnv("E2E_DATABASE_URL") ?? `file:./data/e2e-${slot}.db`);

export const e2eUploadsDir = (slot: number) => path.resolve(process.cwd(), fromEnv("E2E_UPLOADS_DIR") ?? `./data/e2e-uploads-${slot}`);

/** This worker's slot: 0 to workers - 1. */
export const E2E_SLOT = Number(process.env.TEST_PARALLEL_INDEX ?? 0);

export const E2E_DATABASE_URL = e2eDatabaseUrl(E2E_SLOT);

export const E2E_UPLOADS_DIR = e2eUploadsDir(E2E_SLOT);
