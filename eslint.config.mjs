import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Used by more than one block below. Flat config keeps one set of options per rule: a later block that
// sets no-restricted-imports replaces an earlier block's for the files both match, so the blocks below
// cover disjoint files and each lists everything that applies to it.
const noSimulatorData = {
  group: ["**/schema/sim", "@/server/db/schema/sim", "@/simulator", "@/simulator/*"],
  message: "UCOMP code must not read simulator (Coral) data.",
};
const noEditorBarrel = {
  name: "@/editor",
  message:
    "There is no @/editor barrel (it was removed: it loaded the React editor UI). Import the server-safe modules that define what you need: @/editor/schema, @/editor/model/*, @/editor/paste/*.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // ── Architecture boundaries (implementation plan §5) ──────────
  {
    // The editor is a portable production module: React, TipTap, shadcn ui, lucide, motion, zustand only.
    files: ["src/editor/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["next", "next/*"], message: "The editor must stay framework-agnostic (no next/*)." },
            { group: ["@/server", "@/server/*", "@/domain", "@/domain/*", "@/app/*", "@/simulator/*"], message: "The editor may not import app code. Pass data in via props." },
            { regex: "^@/components/(?!ui(/|$))", message: "The editor may only use shadcn primitives from @/components/ui." },
          ],
        },
      ],
    },
  },
  {
    // Domain rules are pure TypeScript, portable to Spring Boot.
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react/*", "next", "next/*", "drizzle-orm", "drizzle-orm/*", "@/server/*", "@/components/*", "@/app/*", "@/simulator/*"], message: "domain/ is pure TypeScript." },
            { regex: "^@/editor(?!/model(/|$))", message: "domain/ may only use the editor's pure model." },
          ],
        },
      ],
    },
  },
  {
    // UCOMP never reads the consumer simulator's tables.
    // (editor/ and domain/ already forbid @/server and @/simulator above; flat config would override them here.)
    files: ["src/app/(product)/**/*", "src/app/api/**/*", "src/components/**/*"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noSimulatorData] }],
    },
  },
  {
    // Server code doesn't read the simulator's tables either, and takes the editor's server-safe modules
    // directly. The "@/editor" barrel was removed (it compiled the whole editor UI into every route that
    // reached it); this rule keeps one from coming back here.
    // (domain/ is held tighter above: the editor's pure model only.)
    files: ["src/server/**/*"],
    ignores: ["src/server/seed/**/*", "src/server/reset.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [noEditorBarrel], patterns: [noSimulatorData] }],
    },
  },
  {
    // The seed and the reset write the simulator's tables, so only the editor rule applies to them.
    files: ["src/server/seed/**/*", "src/server/reset.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [noEditorBarrel] }],
    },
  },
  {
    // The published /api/v1 wire contract: self-contained types both UCOMP and the simulator compile against.
    files: ["src/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ regex: ".*", message: "src/contracts is self-contained: no imports." }] }],
    },
  },
  {
    // The simulator talks to UCOMP over /api/v1 only, like Coral would.
    files: ["src/simulator/**/*", "src/app/(simulator)/**/*"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ regex: "^@/(server(?!/db/schema/sim$)|domain|editor)(/|$)", message: "The simulator reaches UCOMP only through /api/v1 (it may use its own sim schema)." }] },
      ],
    },
  },

  // .agents/ holds vendored agent skills and .claude/ holds local agent worktrees: neither is this app's code.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "data/**", "playwright-report/**", "test-results/**", ".agents/**", ".claude/**"]),
]);

export default eslintConfig;
