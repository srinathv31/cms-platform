import { execSync } from "node:child_process";
import path from "node:path";
import { test } from "@playwright/test";
import { E2E_DATABASE_URL, E2E_UPLOADS_DIR } from "../../storage";

/**
 * Re-seeds the database the server runs on (e2e's own, see e2e/storage.ts; the reset reads `DATABASE_URL` and
 * `UPLOADS_DIR`, which only the server was given), and so puts the clock back. For the specs that advance the
 * clock, change the approval chain or create what they cannot remove by hand: whatever runs after them expects
 * the starting data. Called from beforeAll and afterAll. A backend that owns its data offers a test-only reset.
 */
export function resetDemoData() {
  const root = path.dirname(
    test.info().config.configFile ??
      path.join(process.cwd(), "playwright.config.ts"),
  );
  // The database file is shared with whatever else has it open (the server, a dev server on the same
  // worktree), and has no busy timeout: if someone is writing at that moment, wait a moment and go again.
  for (let attempt = 1; ; attempt++) {
    try {
      // `execSync`, not `execFileSync("npm", …)`: on Windows npm is `npm.cmd`, which Node won't start without a
      // shell. The command is a fixed string, so running it through the shell (cmd.exe or sh) is safe.
      execSync("npm run db:reset", {
        cwd: root,
        stdio: "pipe",
        env: {
          ...process.env,
          DATABASE_URL: E2E_DATABASE_URL,
          UPLOADS_DIR: E2E_UPLOADS_DIR,
        },
      });
      return;
    } catch (error) {
      if (
        attempt >= 5 ||
        !/SQLITE_BUSY|database is locked/i.test(
          String(
            (error as { stderr?: unknown; message?: unknown }).stderr ?? "",
          ) + String((error as Error).message),
        )
      )
        throw error;
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        1500 * attempt,
      );
    }
  }
}
