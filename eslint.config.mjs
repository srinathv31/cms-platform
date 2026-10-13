import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Used by more than one block below. Flat config keeps one set of options per rule: a later block that
// sets no-restricted-imports replaces an earlier block's for the files both match, so the blocks below
// cover disjoint files and each lists everything that applies to it.
const noSimulatorData = {
  group: [
    "**/schema/sim",
    "@/server/db/schema/sim",
    "@/simulator",
    "@/simulator/*",
  ],
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

// The backend seam's import rules (blocks under "The backend seam" below).
const noDatabase = {
  group: [
    "drizzle-orm",
    "drizzle-orm/*",
    "@libsql/*",
    "**/db/client",
    "**/db/schema/*",
  ],
  allowTypeImports: true,
  message:
    "Only the local implementation (src/server/services/local) talks to the database. Reach data through services() (src/server/services/README.md).",
};
const noImplementations = {
  group: [
    "@/server/services/local",
    "@/server/services/local/**",
    "@/server/services/fake",
    "@/server/services/fake/**",
    "**/services/local",
    "**/services/local/**",
    "**/services/fake",
    "**/services/fake/**",
  ],
  message:
    "Reach the backend through services() (src/server/services/index.ts), never an implementation: with another backend configured, the local one isn't there.",
};
const noViewModels = {
  group: [
    "@/server/queries/**",
    "@/server/render/**",
    "@/server/import/**",
    "@/server/starters/**",
    "@/server/api/**",
    "@/components/**",
    "@/domain/golive-types",
    "@/domain/import-types",
  ],
  message:
    "The service interfaces carry facts: not the BFF's view models (worded, with app URLs) or its modules. Declare a facts type beside the interface, or Unsettled<…> until its package settles it (decision 0072).",
};
// Who reads the clock (N1 in the seam's review): the backend does, and the request context never. A read that
// decides by time answers the instant it decided at (`asOf`), and the BFF words its dates from it.
const noClock = {
  group: [
    "@/server/clock",
    "**/server/clock",
    "../clock",
    "@/server/queries/dynamic",
    "**/queries/dynamic",
    "./dynamic",
  ],
  message:
    "Only the backend reads the clock (the local implementation, /api/v1, the sweeps). A read that decides by time answers `asOf`: word dates from it (decision 0072).",
};
// Who decides (N2): the permission check runs behind the service interfaces (decision 0070). Read models and
// components render the decided `can` the services answer; only the domain and the implementations call it.
const decisionsMessage =
  "Permission checks run behind the service interfaces (decision 0070): render the decided `can` a service answers. Only src/domain and the implementations call can() or canSeeSpace().";
const noDecisions = {
  paths: [
    {
      name: "@/domain/permissions",
      importNames: ["can", "canSeeSpace"],
      message: decisionsMessage,
    },
    // `check` and `permit` are can() for a command: the legacy branch of the action kit still decides in the BFF.
    ...["@/server/services/refuse", "@/server/actions/kit", "./kit"].map(
      (name) => ({
        name,
        importNames: ["check", "permit"],
        message: decisionsMessage,
      }),
    ),
  ],
  patterns: [{ group: ["**/require-can"], message: decisionsMessage }],
};
// The backend's own machinery (H4): the reset and the seed belong to the local backend (the demo tools reach them
// through services().demo), and src/server/testing is test support. The BFF imports none of them.
const noBackendInternals = {
  group: [
    "@/server/reset",
    "**/server/reset",
    "../reset",
    "@/server/seed",
    "@/server/seed/**",
    "**/seed/**",
    "@/server/testing/**",
    "**/server/testing/**",
  ],
  message:
    "The BFF doesn't import the backend's own machinery: the reset and the seed are the local backend's (reach the demo tools through services().demo), and src/server/testing is test support.",
};
// The three rules above reuse typescript-eslint's no-restricted-imports under names of their own, so each has its
// own severity per file (flat config keeps one per rule) and its own ratchet below.
const restrictedImports = nextTs.find(
  (config) => config.plugins?.["@typescript-eslint"],
).plugins["@typescript-eslint"].rules["no-restricted-imports"];
const seamPlugin = {
  rules: {
    "no-clock": restrictedImports,
    "no-decisions": restrictedImports,
    "no-backend-internals": restrictedImports,
  },
};

// Not checked by the seam rules: the local implementation and the database itself, the seed and the reset, the
// shared database test support, the simulator (its own app and database), and tests.
const SEAM_EXEMPT = [
  "src/server/services/local/**",
  "src/server/services/index.ts",
  "src/server/db/**",
  "src/server/seed/**",
  "src/server/reset.ts",
  "src/server/testing/**",
  "src/lib/fresh-database.ts",
  "src/lib/serialized-writes.ts",
  "src/simulator/**",
  "src/app/(simulator)/**",
  "src/app/api/v1/**",
  "**/*.test.{ts,tsx}",
];
// The files the seam rules still warn on, until their package moves them (plan.md). Delete a line as you clear it.
const SEAM_NOT_YET = [
  "src/server/access-effects.ts",
  "src/server/access-sweep.ts",
  "src/server/actions/access.ts",
  "src/server/actions/comments.ts",
  "src/server/actions/create-template.ts",
  "src/server/actions/kit.ts",
  "src/server/actions/notifications.ts",
  "src/server/actions/persona.ts",
  "src/server/actions/platform.ts",
  "src/server/actions/review.ts",
  "src/server/actions/templates.ts",
  "src/server/clock.ts",
  "src/server/drafts/apply-patch.ts",
  "src/server/drafts/save-draft.ts",
  "src/server/effects.ts",
  "src/server/import/create.ts",
  "src/server/queries/access.ts",
  "src/server/queries/activity.ts",
  "src/server/queries/audit.ts",
  "src/server/queries/base-version.ts",
  "src/server/queries/compare.ts",
  "src/server/queries/consumer-api.ts",
  "src/server/queries/copilot.ts",
  "src/server/queries/import.ts",
  "src/server/queries/integration.ts",
  "src/server/queries/library.ts",
  "src/server/queries/notifications.ts",
  "src/server/queries/palette.ts",
  "src/server/queries/people.ts",
  "src/server/queries/personas.ts",
  "src/server/queries/platform.ts",
  "src/server/queries/review.ts",
  "src/server/queries/submit-summary.ts",
  "src/server/queries/template-access.ts",
  "src/server/queries/threads.ts",
  "src/server/queries/usage.ts",
  "src/server/queries/workspace.ts",
  "src/server/render/log.ts",
  "src/server/render/render-template.ts",
  "src/server/sunset-sweep.ts",
  "src/server/templates/create.ts",
  "src/server/version-rows.ts",
];

// The BFF files that still read the clock (N1), still decide with can() (N2), and still import the backend's own
// machinery (H4): the packages that own them (plan.md) clear them, and delete their lines. Integration empties all
// three, with SEAM_NOT_YET.
/** A ratchet's block: its rule as a warning for the files still listed, and nothing once the list is empty. */
const ratchet = (files, rules) => (files.length > 0 ? [{ files, rules }] : []);
const CLOCK_NOT_YET = [
  "src/components/activity/activity-content.tsx",
  "src/components/library/library-view.tsx",
  "src/components/review-queue/review-queue-view.tsx",
  "src/components/review/review-screen.tsx",
  "src/components/settings/team/bodies.tsx",
  "src/components/usage/template-usage.tsx",
  "src/components/usage/usage-dashboard.tsx",
  "src/components/workspace/content/workspace-content.tsx",
  "src/components/workspace/workspace-header.tsx",
  "src/server/access-sweep.ts",
  "src/server/actions/demo.ts",
  "src/server/actions/kit.ts",
  "src/server/actions/persona.ts",
  "src/server/api/http.ts",
  "src/server/drafts/save-draft.ts",
  "src/server/import/create.ts",
  "src/server/queries/access.ts",
  "src/server/queries/audit.ts",
  "src/server/queries/clock.ts",
  "src/server/queries/dynamic.ts",
  "src/server/queries/integration.ts",
  "src/server/queries/library.ts",
  "src/server/queries/notifications.ts",
  "src/server/queries/platform.ts",
  "src/server/queries/review.ts",
  "src/server/queries/submit-summary.ts",
  "src/server/queries/usage.ts",
  "src/server/queries/workspace.ts",
  "src/server/render/render-template.ts",
  "src/server/sunset-sweep.ts",
];
const DECIDES_NOT_YET = [
  "src/components/library/library-view.tsx",
  "src/server/actions/access.ts",
  "src/server/actions/comments.ts",
  "src/server/actions/create-template.ts",
  "src/server/actions/kit.ts",
  "src/server/actions/platform.ts",
  "src/server/actions/review.ts",
  "src/server/actions/templates.ts",
  "src/server/drafts/apply-patch.ts",
  "src/server/import/create.ts",
  "src/server/queries/access.ts",
  "src/server/queries/audit.ts",
  "src/server/queries/base-version.ts",
  "src/server/queries/compare.ts",
  "src/server/queries/copilot.ts",
  "src/server/queries/import.ts",
  "src/server/queries/integration.ts",
  "src/server/queries/palette.ts",
  "src/server/queries/platform.ts",
  "src/server/queries/require-can.ts",
  "src/server/queries/review.ts",
  "src/server/queries/submit-summary.ts",
  "src/server/queries/template-access.ts",
  "src/server/queries/usage.ts",
  "src/server/queries/workspace.ts",
  "src/server/render/render-template.ts",
];
const INTERNALS_NOT_YET = [
  "src/server/actions/demo.ts",
  "src/server/starters/alerts.ts",
  "src/server/starters/blank.ts",
  "src/server/starters/card-offer-terms.ts",
  "src/server/starters/fee-schedule.ts",
  "src/server/starters/index.ts",
  "src/server/starters/rate-change-notice.ts",
];

// The editor's public modules: the table under "Public API" in src/editor/README.md. Code outside src/editor
// imports these and nothing else, so the editor can change what is behind them. A module is public when the
// README lists it, and the README lists it when it is a sensible part of the API: keep the two the same.
const EDITOR_PUBLIC_MODULES = [
  "components/document-editor",
  "components/editor-root",
  "components/inline-variable-field",
  "components/static-document",
  "components/variable-chip",
  "components/variables-panel",
  "extensions/list-markers",
  "lib/platform",
  "model/characters",
  "model/contract",
  "model/document-check",
  "model/links",
  "model/list-markers",
  "model/normalize",
  "model/sample-sets",
  "model/section-title",
  "model/table-grid",
  "model/types",
  "model/usage",
  "model/variables",
  "paste/chips",
  "paste/markdown",
  "paste/normalize-html",
  "schema",
  "state/variable-store",
  "styles.css",
  "testing/editor",
  "types",
];
const editorInternals = {
  regex: `^@/editor/(?!(?:${EDITOR_PUBLIC_MODULES.map((module) => module.replaceAll(".", "\\.")).join("|")})$)`,
  message:
    "Outside src/editor, import only the editor's public modules (src/editor/README.md, Public API; there is no @/editor barrel). To make a module public, add it to the README's table and to EDITOR_PUBLIC_MODULES in eslint.config.mjs.",
};
// @/editor/schema is public for three names; its other exports are for the editor's own modules.
const editorSchemaNames = {
  name: "@/editor/schema",
  allowImportNames: [
    "baseExtensions",
    "BaseExtensionOptions",
    "ensureBlockIds",
  ],
  message:
    "From @/editor/schema, code outside src/editor uses baseExtensions, BaseExtensionOptions and ensureBlockIds only (src/editor/README.md).",
};

// The database client, for e2e: only e2e/helpers/state/db.ts may import it.
const e2eDatabaseMessage =
  "e2e touches the database only through e2e/helpers/state (decision 0068): add a named function there, and import it from e2e/helpers/state.";
const noE2eDatabase = {
  group: [
    "@libsql/*",
    "drizzle-orm",
    "drizzle-orm/*",
    "better-sqlite3",
    "node:sqlite",
    "@/server/db",
    "@/server/db/*",
  ],
  message: e2eDatabaseMessage,
};
const noStateInternals = {
  group: ["**/helpers/state/*", "./state/*"],
  message:
    "Import from e2e/helpers/state (its index); the modules behind it are internal to the helper.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // ── Architecture boundaries (implementation plan §5) ──────────
  {
    // Every file outside the editor holds to its public API. Flat config keeps one set of no-restricted-imports
    // options per file, so this block covers the files no block below does, and each block below lists
    // editorInternals (and editorSchemaNames) again.
    files: ["**/*.{ts,tsx,js,jsx,mjs,mts}"],
    ignores: ["src/editor/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [editorSchemaNames], patterns: [editorInternals] },
      ],
    },
  },
  {
    // The editor is a portable production module: React, TipTap, shadcn ui, lucide, motion, zustand only.
    files: ["src/editor/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*"],
              message: "The editor must stay framework-agnostic (no next/*).",
            },
            {
              group: [
                "@/server",
                "@/server/*",
                "@/domain",
                "@/domain/*",
                "@/app/*",
                "@/simulator/*",
              ],
              message:
                "The editor may not import app code. Pass data in via props.",
            },
            {
              regex: "^@/components/(?!ui(/|$))",
              message:
                "The editor may only use shadcn primitives from @/components/ui.",
            },
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
            {
              group: [
                "react",
                "react/*",
                "next",
                "next/*",
                "drizzle-orm",
                "drizzle-orm/*",
                "@/server/*",
                "@/components/*",
                "@/app/*",
                "@/simulator/*",
              ],
              message: "domain/ is pure TypeScript.",
            },
            {
              regex: "^@/editor(?!/model(/|$))",
              message: "domain/ may only use the editor's pure model.",
            },
            editorInternals,
          ],
        },
      ],
    },
  },
  {
    // UCOMP never reads the consumer simulator's tables.
    // (editor/ and domain/ already forbid @/server and @/simulator above; flat config would override them here.)
    files: [
      "src/app/(product)/**/*",
      "src/app/api/**/*",
      "src/components/**/*",
    ],
    ignores: ["src/components/device/**/*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [editorSchemaNames],
          patterns: [noSimulatorData, editorInternals],
        },
      ],
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
            {
              group: [
                "@/domain",
                "@/domain/*",
                "@/server",
                "@/server/*",
                "@/editor",
                "@/editor/*",
                "@/app/*",
              ],
              message:
                "The phone kit takes resolved strings as props: no Stencil internals (Coral uses it too).",
            },
            {
              regex: "^@/components/(?!(ui|primitives|motion|device)(/|$))",
              message:
                "The phone kit may use only @/components/ui, primitives and motion.",
            },
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
      "no-restricted-imports": [
        "error",
        {
          paths: [noEditorBarrel, editorSchemaNames],
          patterns: [noSimulatorData, noComponents, editorInternals],
        },
      ],
    },
  },
  {
    // The seed and the reset write the simulator's tables, so the simulator rule doesn't apply to them.
    files: ["src/server/seed/**/*", "src/server/reset.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [noEditorBarrel, editorSchemaNames],
          patterns: [noComponents, editorInternals],
        },
      ],
    },
  },
  // ── The backend seam (src/server/services/README.md, decision 0072) ──────────
  { plugins: { seam: seamPlugin } },
  // A separate rule from the core no-restricted-imports above (typescript-eslint's, which can let type imports
  // through), so the blocks there keep their own options. Flat config keeps one set of options per rule per file:
  // each block below lists every seam pattern that applies to its files.
  {
    // Only the local implementation, the database module and the seed talk to the database, and only
    // services/index.ts (with /api/v1, the seed, the reset and tests) reaches an implementation: everything else
    // goes through services(). Row types from the schema may be imported as types (the fake keeps its rows in
    // that shape).
    files: ["src/**/*.{ts,tsx}"],
    ignores: SEAM_EXEMPT,
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [noDatabase, noImplementations] },
      ],
    },
  },
  {
    // The interfaces themselves carry facts, never the BFF's worded view models or its modules.
    files: ["src/server/services/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [noDatabase, noImplementations, noViewModels] },
      ],
    },
  },
  {
    // /api/v1 is the backend's own API (the Java API serves it after the port): its handlers call the local
    // implementation directly, but still not the database.
    files: ["src/app/api/v1/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [noDatabase] },
      ],
    },
  },
  {
    // The ratchet: the files still on the database or an implementation, waiting for their package to move them
    // behind the seam (plan P1–P5). The same rule, as a warning; a package that clears a file deletes its line,
    // and from then on the rule is an error there.
    files: SEAM_NOT_YET,
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "warn",
        { patterns: [noDatabase, noImplementations] },
      ],
    },
  },
  {
    // Only the backend reads the clock. Exempt like the rules above (the local implementation, /api/v1, the
    // reset, the seed, test support and tests are the backend's own); CLOCK_NOT_YET is the ratchet.
    files: ["src/**/*.{ts,tsx}"],
    ignores: SEAM_EXEMPT,
    rules: { "seam/no-clock": ["error", { patterns: [noClock] }] },
  },
  ...ratchet(CLOCK_NOT_YET, {
    "seam/no-clock": ["warn", { patterns: [noClock] }],
  }),
  {
    // Only the domain and the implementations decide; `refuse.ts` is the implementations' shared command helper.
    // DECIDES_NOT_YET is the ratchet.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/domain/**",
      "src/server/services/local/**",
      "src/server/services/fake/**",
      "src/server/services/refuse.ts",
      "src/simulator/**",
      "**/*.test.{ts,tsx}",
    ],
    rules: { "seam/no-decisions": ["error", noDecisions] },
  },
  ...ratchet(DECIDES_NOT_YET, {
    "seam/no-decisions": ["warn", noDecisions],
  }),
  {
    // The reset, the seed and the test support are the backend's and the tests'. The fake and the contract suite
    // are test support too. INTERNALS_NOT_YET is the ratchet.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      ...SEAM_EXEMPT,
      "src/server/services/fake/**",
      "src/server/services/contract/**",
    ],
    rules: {
      "seam/no-backend-internals": [
        "error",
        { patterns: [noBackendInternals] },
      ],
    },
  },
  ...ratchet(INTERNALS_NOT_YET, {
    "seam/no-backend-internals": ["warn", { patterns: [noBackendInternals] }],
  }),
  {
    // The published /api/v1 wire contract: self-contained types both UCOMP and the simulator compile against.
    files: ["src/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: ".*",
              message: "src/contracts is self-contained: no imports.",
            },
          ],
        },
      ],
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
        {
          patterns: [
            {
              regex: "^@/(server(?!/db/schema/sim$)|domain|editor)(/|$)",
              message:
                "The simulator reaches UCOMP only through /api/v1 (it may use its own sim schema).",
            },
          ],
        },
      ],
    },
  },

  {
    // e2e reads and changes Stencil's data through e2e/helpers/state and nowhere else (decision 0068): that
    // folder is SQL today and a test endpoint or JDBC when Java owns the data. A spec that needs a fact it can't
    // get there adds a named function to the helper; it doesn't open the database.
    files: ["e2e/**/*.{ts,mts,js,mjs}"],
    ignores: ["e2e/helpers/state/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [editorSchemaNames],
          patterns: [editorInternals, noE2eDatabase, noStateInternals],
        },
      ],
    },
  },
  {
    // Inside the helper, only db.ts opens the database; the other modules read and write through it. They hold
    // to the editor's public API like every other e2e file: this block replaces the one above for these files.
    files: ["e2e/helpers/state/**/*.ts"],
    ignores: ["e2e/helpers/state/db.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [editorSchemaNames],
          patterns: [editorInternals, noE2eDatabase],
        },
      ],
    },
  },

  // .agents/ holds vendored agent skills and .claude/ holds local agent worktrees: neither is this app's code.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "data/**",
    "playwright-report/**",
    "test-results/**",
    ".agents/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
