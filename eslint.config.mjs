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
const noComponents = {
  group: ["@/components", "@/components/*"],
  message:
    "src/server must not import the React UI. Shared types and constants go in src/domain; pure helpers a screen and the server both use go in @/editor/model/*.",
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
    ignores: ["src/components/device/**/*"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [noSimulatorData] }],
    },
  },
  {
    // The phone kit is shared by Stencil's preview and Coral's phone, and Coral may not reach Stencil's
    // internals: it draws resolved strings, with the generated ui/, the primitives and the motion presets only.
    files: ["src/components/device/**/*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            noSimulatorData,
            { group: ["@/domain", "@/domain/*", "@/server", "@/server/*", "@/editor", "@/editor/*", "@/app/*"], message: "The phone kit takes resolved strings as props: no Stencil internals (Coral uses it too)." },
            { regex: "^@/components/(?!(ui|primitives|motion|device)(/|$))", message: "The phone kit may use only @/components/ui, primitives and motion." },
          ],
        },
      ],
    },
  },
  {
    // Server code doesn't read the simulator's tables either, takes the editor's server-safe modules
    // directly, and never imports the React UI (what a screen and the server both need goes in
    // src/domain, or in @/editor/model/*). The "@/editor" barrel was removed (it compiled the whole
    // editor UI into every route that reached it); this rule keeps one from coming back here.
    // (domain/ is held tighter above: the editor's pure model only.)
    files: ["src/server/**/*"],
    ignores: ["src/server/seed/**/*", "src/server/reset.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [noEditorBarrel], patterns: [noSimulatorData, noComponents] }],
    },
  },
  {
    // The seed and the reset write the simulator's tables, so the simulator rule doesn't apply to them.
    files: ["src/server/seed/**/*", "src/server/reset.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [noEditorBarrel], patterns: [noComponents] }],
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
    // "use server" makes every export of a file (or the one function it opens) a public POST endpoint that
    // takes any input and runs one at a time with the page's other actions. Only mutations are server
    // actions, and they live in src/server/actions/, each parsing its input with zod. A read the browser
    // asks for is a GET route handler (src/app/api/templates/[templateId]/) or props from a server component.
    // The simulator, a separate app, keeps its own writes in src/simulator/actions.ts and nothing else: lint
    // can't tell a read from a write inside a file, so actions.test.ts pins the file's exports to the four
    // writes. Its reads are GET routes (src/app/(simulator)/sim/templates/search, .../deliveries/[id]/view).
    files: ["src/**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["src/server/actions/**", "src/simulator/actions.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExpressionStatement[directive='use server']",
          message:
            '"use server" belongs only in src/server/actions/ (mutations, each parsing its input with zod). Serve a read through a GET route handler or a server component\'s props.',
        },
      ],
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
