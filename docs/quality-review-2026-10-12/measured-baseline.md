# Measured baseline, main @ 0cca665, 2026-10-12

## History
- 273 commits, 87 merges (PRs #2–#75), 2026-10-03 → 2026-10-11 (nine days). One author. One open draft PR (#4, Next 16.4 upgrade, parked).

## Size (ts/tsx/css, incl. tests, excluding generated shadcn ui/)
| Folder | files | lines | test files |
| --- | --- | --- | --- |
| src/app | 73 | 4,533 | 14 |
| src/components | 419 | 50,286 | 106 |
| src/editor | 124 | 21,247 | 47 |
| src/domain | 151 | 28,796 | 63 |
| src/server | 168 | 35,658 | 45 |
| src/contracts | 1 | 447 | 0 |
| src/simulator | 37 | 5,068 | 7 |
| src/hooks, lib, styles | 10 | 993 | 3 |
| e2e | 70 | 19,060 | 50 |
| scripts | 7 | 467 | 0 |
| shadcn ui/ (generated) | 30 | 3,299 | |
- Non-test, non-ui source: 643 files, 83,076 lines. Median 86 lines; p90 294; 63 files > 300; 33 files > 400.
- Docs: 74 Markdown files (57 outside archive), 50 decision records, 14 READMEs under src/.
- 14 SQL migrations. 21 CMS tables + sim tables.

## Static health
- `"use client"`: 167 files; `"use server"`: 10 files; `server-only`: 59 files.
- `as Route` casts: 29. `eslint-disable`: 4. `@ts-ignore/@ts-expect-error`: 0. `any`: 0. TODO/FIXME: 0.
- `dangerouslySetInnerHTML`: 1 (import preview; server-allowlisted HTML).
- `text-[Npx]` arbitrary utilities: 343 (H6 open).
- Comment lines: 12.0% of source lines.
- Dependencies: 38 runtime, 15 dev. node_modules 892 MB. Node 24.21 on this machine; no engines pin.

## Checks (this machine, Mac mini)
| Check | Result | Time |
| --- | --- | --- |
| typecheck | FAIL first run (stale `.next/dev/types/validator.ts` from Oct 7 lists deleted `(dev)/design/*` pages); PASS after removing `.next/dev/types` | 7 s |
| lint | pass | 9 s |
| test | 285 files, 5,283 passed, 1 skipped | 18.5 s |
| docs:check | 74 files, 1,428 links, 753 paths, all good | 1 s |
| build | FAIL first run (same stale file); PASS after | 17 s (warm turbopack) |
| e2e | 379 passed, 0 failed, 0 flaky, 4 workers, under heavy concurrent load (9 agents + a second server) | 3.0 min |

## Backlog (docs/handoff-review.md)
- 111 findings: 13 Open, 8 Partly fixed, 86 Fixed, 4 Deferred. Table matches the Status lines (counted).
- All 27 "Found while fixing" N-items are Fixed.
- Open: S5, S10, D10, A4, A8, A9, B3, B4, B5, T4, T8, T9, H6. Partly: D11, R3, A3, A5, B1, B2, G4, H5. Deferred: S1, S2, S4, A7.
