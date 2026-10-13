import "server-only";
import { z } from "zod";

// The server's configuration: every setting the deployment chooses, read from the environment in this one
// file, once, typed and validated. Nothing else in the app reads a setting from `process.env`
// (`db/client.ts` and `import/store.ts` still read their own, `DATABASE_URL` and `UPLOADS_DIR`, and move
// here when they are next touched). A setting that is not valid throws when this module loads, naming the
// variable, rather than falling back to a value nobody chose. `src/instrumentation.ts` loads this module
// when the server starts, so a bad value stops the server at boot instead of failing the first request.
//
// To add a setting: give it a field in `Schema` that reads its variable, then export it below.
//
// DEMO_MODE turns on the demo tools: the data reset, the clock advance, the persona switcher and the Demo
// pill (decision 0051). Unset means off, and a production build with no environment set has none of them. It
// is read when the server starts, not when the app is built, so one build runs either way. That holds only
// while a component reads it at request time: in the static shell, `await connection()` first
// (`DemoPillHole` does), or the build's value is baked into the page.
//
//   `npm run dev`      `.env.development`, which only `next dev` reads, turns it on.
//   `npm run demo`     the script sets it for `next start`.
//   e2e                `webServer.env` in playwright.config.ts sets it for each worker's server.
//   unit tests         the test says which: `vi.mock("@/server/config", …)`.
//   deployment         never set.
//
// STENCIL_BACKEND picks the implementation behind the service interfaces (src/server/services/README.md):
// `local`, this app's own Drizzle code over SQLite, and the default. It is the only working value until the
// HTTP implementation for the Java API exists; anything else stops the server at boot rather than run a
// backend nobody built.

const FLAG_VALUES = ["", "0", "false", "1", "true"] as const;

/** A flag: unset, empty, `0` or `false` is off; `1` or `true` is on; anything else is a mistake. */
const flag = (variable: string) =>
  z
    .string()
    .optional()
    .transform((value) => (value ?? "").trim().toLowerCase())
    .pipe(
      z.enum(FLAG_VALUES, {
        error: () => `${variable} must be 1, true, 0 or false, or left unset.`,
      }),
    )
    .transform((value) => value === "1" || value === "true");

/** The implementations of the service interfaces this build can run on. `http` (the Java API) joins later. */
export const BACKENDS = ["local"] as const;
export type Backend = (typeof BACKENDS)[number];

const backend = z
  .string()
  .optional()
  .transform((value) => (value ?? "").trim().toLowerCase() || "local")
  .pipe(
    z.enum(BACKENDS, {
      error: () =>
        `STENCIL_BACKEND must be local, or left unset (the HTTP backend isn't built yet).`,
    }),
  );

const Schema = z.object({
  demoMode: flag("DEMO_MODE"),
  backend,
});

export type Config = z.output<typeof Schema>;

/** Parses an environment into the configuration; throws one error naming every variable that is wrong. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = Schema.safeParse({
    demoMode: env.DEMO_MODE,
    backend: env.STENCIL_BACKEND,
  });
  if (!parsed.success)
    throw new Error(
      `Invalid configuration. ${parsed.error.issues.map((issue) => issue.message).join(" ")}`,
    );
  return parsed.data;
}

const config = parseConfig(process.env);

/** The demo tools are on. Off unless `DEMO_MODE` is set. */
export const DEMO_MODE = config.demoMode;

/** Which implementation the service interfaces run on (`services()` in src/server/services). */
export const BACKEND: Backend = config.backend;
