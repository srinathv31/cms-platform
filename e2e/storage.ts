import path from "node:path";

// Where e2e keeps its data: its own database file and uploads folder, never the demo's
// (`data/ucomp.db`, `data/uploads`). `playwright.config.ts` hands these to the server it starts as
// `DATABASE_URL` and `UPLOADS_DIR`, and every helper that opens the database or the uploads folder
// reads them from here, so the server and the specs always see the same files.
//
// Set `E2E_DATABASE_URL` or `E2E_UPLOADS_DIR` to use others. Against a server you started yourself
// (`E2E_PORT=3000`), start it with the same `DATABASE_URL` and `UPLOADS_DIR`.

const fromEnv = (name: string, fallback: string) => process.env[name] || fallback;

/** `file:/abs/path` whatever the working directory; a non-file URL (libsql://…) passes through. */
function absoluteFileUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  return `file:${path.resolve(process.cwd(), url.slice("file:".length))}`;
}

export const E2E_DATABASE_URL = absoluteFileUrl(fromEnv("E2E_DATABASE_URL", "file:./data/e2e.db"));

export const E2E_UPLOADS_DIR = path.resolve(process.cwd(), fromEnv("E2E_UPLOADS_DIR", "./data/e2e-uploads"));
