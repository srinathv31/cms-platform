# 0069. Seed ids are literal, and the seed exports a fixture the Java side loads

Status: Accepted
Date: 2026-10-12

## Context

The seed is a declarative spec (`src/server/seed/templates/types.ts`) that `build.ts` turns into rows, with times as
"days before the reset". Every id comes from one shared random sequence (`createContext` in
`src/server/seed/context.ts`), so a row added early re-ids everything after it. Fourteen template ids are pinned
because e2e specs, golden files and screenshots name them (`src/server/seed/seed.test.ts`:
`"balance-transfer": "UC-D6KSGY"`, …), and four workarounds keep them still: keyed ids, alerts built last, the last
`ERRORS` entry, `pushPlatformOf` (M-13 of the [October 12 review](../quality-review-2026-10-12.md)). A Java fixture
that had to reproduce these ids would port the generator (`mulberry32`, `fnv1a`, the Crockford mapping) bit for bit.

## Decision

- **Templates and versions carry literal ids in the spec** (`SeedTemplate.id`, `SeedVersion.id`); everything else is
  drawn from per-template keyed sequences, so adding a row moves no other id.
- **The Node seed exports a language-neutral fixture** (JSON) with relative times (`daysAgo`), which a Java loader
  reads. One source for both sides: the demo data, the `seed-*` golden cases and the e2e specs stay in step.

## Alternatives considered

- **Java ports the generator.** Bit-for-bit reimplementation of three algorithms, and the four workarounds with them.
- **Java writes its own seed from the TypeScript spec by hand.** Two seeds that drift.

## Consequences

- **Node now (wave 2, lane K):** literal ids in the spec, keyed sequences for the rest, the "built last" ordering
  rules dropped, and the export. Lane K's files grow to include `src/server/seed/templates/types.ts`.
- **Java side:** a fixture loader per environment that turns `daysAgo` into instants at load time; test data stays
  out of the production migrations.
- Changing a pinned id is now an edit to one literal, visible in review.
