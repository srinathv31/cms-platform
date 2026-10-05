# Parallel tracks for Phases 5–7

The remaining work runs as three tracks in separate git worktrees, then one integration pass. **One lead session runs all of it** (single-lead mode): it creates the worktrees, runs Tracks A and B at the same time through subagents, starts Track C when one of them finishes, then integrates in the main checkout. Nobody clicks anything. Read `docs/handoff-phases-5-7.md` first: it holds the context, the decisions and the way of working. This file says how the tracks split the work and share one laptop.

Worktrees sit BESIDE the repo, never inside it (Turbopack picks its root by looking for lockfiles upward, so a nested project confuses it). `$P` = `/Users/srinathvenkatesh/Documents/CodeProjects/prototypes/cms-platform`, and the main checkout is `$P/cms-platform`.

| Track | Scope | Worktree | Branch | Dev port (config) | Gate port | Starts |
|---|---|---|---|---|---|---|
| A | Phase 5, going live | `$P/ucomp-golive` | `track/golive` | 3001 (`ucomp-dev-a`) | 3101 | now |
| B | Phase 6, access and admin | `$P/ucomp-access` | `track/access` | 3002 (`ucomp-dev-b`) | 3102 | now |
| C | Phase 7a (import, Copilot, ⌘K) + carried rough edges | `$P/ucomp-import` | `track/import` | 3003 (`ucomp-dev-c`) | 3103 | when A or B finishes |
| I | Integration + Phase 7b (UX pass, full demo script, final review) | `$P/cms-platform` (main checkout) | `prototype` | 3000 (`ucomp-dev`) | 3100 | when A, B and C are done |

Every track branches from `prototype` as it is when the track starts.

## Setting up a track (the lead does this)
From the main checkout:
```bash
git worktree add ../ucomp-golive -b track/golive prototype   # B: ../ucomp-access track/access · C: ../ucomp-import track/import
cd ../ucomp-golive && npm install && npm run db:reset           # its own node_modules and its own ./data/ucomp.db
```
Then start its dev server with `preview_start` and the track's config (`ucomp-dev-a`, `-b` or `-c`). These configs live in the main checkout's `.claude/launch.json` and `cd` into the worktree, so the lead starts every server from its main session. Write the track's `docs/phase-N-brief.md` and contract types INSIDE the worktree, then fan out.

## Briefing subagents for a track
Every subagent brief names its track's worktree as its root:
- All file paths are absolute under that worktree, e.g. `$P/ucomp-golive/src/...`.
- Every Bash command starts with `cd $P/ucomp-golive && …`. The subagent's own working directory is the main checkout, so it must never edit, test or build there, or in another track's worktree.
- `docs/agent-brief.md`, `docs/ui-checklist.md` and the Next docs (`node_modules/next/dist/docs/`) are read from that worktree.
- Give the track's dev URL (`http://localhost:3001`) and its gate port.
- Name the track in the brief's first line ("Track A, worktree $P/ucomp-golive"), so reports are easy to route.

## Progress log (survives context compaction)
The lead keeps `docs/tracks/progress.md` in the MAIN checkout. It is updated at every milestone: wave launched, slice done, decision made, track green or committed. Each entry is one line: what's done and what's running, per track. After a compaction, re-read it and `git -C <worktree> log --oneline -5` for each track before doing anything else. Commit it with the integration.

## Shared laptop: resource rules (16 GB, and Sri is writing in Safari)
- **At most 5 subagents running at once in total, and at most 3 per track.**
- **One dev server per track,** on its own port.
- **Heavy steps take the lock.** These are `npx next build`, a full `npx playwright test`, and `npx vitest run` on the whole suite. Wrap each one:
  ```bash
  until mkdir /tmp/ucomp-heavy.lock 2>/dev/null; do sleep 20; done; <command>; rmdir /tmp/ucomp-heavy.lock
  ```
  If the lock directory is older than 30 minutes (`find /tmp/ucomp-heavy.lock -mmin +30`), it's stale: remove it. Targeted vitest and single-spec Playwright runs don't need the lock.
- **E2E port settings:**
  - against your dev server: `E2E_PORT=<your dev port>`, after a curl 200;
  - the gate: `E2E_GATE_PORT=<your gate port> npx playwright test`. Playwright resets YOUR db and runs `next start` on your gate port.
- Never run pkill or start servers by hand, and never touch another worktree's files or ports.
- **Gate media** (`npm run gate:media`) runs once, at integration. Tracks don't record.

## Ownership map (who may edit shared hotspots)
Anything not listed is owned by the track whose scope needs it. When two tracks need the same file, the owner does the edit and the other asks for it in its report. The integrator resolves anything left.

| Area | A (go live) | B (access) | C (import) |
|---|---|---|---|
| `src/server/db/schema/sim.ts` | owns | | |
| `src/server/db/schema/ucomp.ts` | additive columns only, if unavoidable | owns | no changes |
| Migrations | may generate in its branch | may generate in its branch | none |
| `src/server/seed/` | `sim.ts`, `history.ts` | `people.ts`, `teams.ts`, `platform.ts`, `activity.ts` | `content.ts`, starters |
| `src/domain/permissions.ts` (+ test) | read only | owns | read only |
| `src/domain/types.ts`, `review-types.ts` | additive | additive | additive |
| `src/components/app-shell/` | the Usage nav item only | owns (sidebar cards, notifications popover, nav, profile menu) | `command-palette.tsx` only |
| `src/components/demo/` | owns (simulator entry) | | |
| `src/components/settings/`, `@modal/(.)settings`, `settings/` routes | | owns | |
| `src/components/workspace/workspace-share.tsx` (integration panel), `…/templates/[templateId]/usage/` | owns | | |
| `src/components/library/` (New template, gallery, Import entry) | | | owns |
| `src/editor/` (perf work and paste paths; additive public API) | | | owns |
| `src/server/render/channels/pdf*.ts(x)` | | | owns (keep-with-next fix) |
| `src/components/review/`, `src/components/redline/` | | | owns (Changes-only markers) |
| `playwright.config.ts`, `package.json` scripts | no changes | no changes | no changes |
| `package.json` dependencies | `npm install` allowed | allowed | allowed |
| `e2e/helpers/`, `e2e/media/` | additive only | additive only | additive only |
| Gate specs | `scenario-04`, `05`, and the scenario-06 update | `scenario-07`, `08` | `scenario-09`, `10` |
| Decisions log | `docs/decisions/track-a.md` | `track-b.md` | `track-c.md` |

**Migrations.** If A and B both generate one, they'll collide in `meta/_journal.json`. That's fine: at integration, the track migrations are dropped and regenerated once from the merged schema (there's no production data; `db:reset` rebuilds from scratch). Say in your report exactly what you changed in the schema.

## Track definition of done
- `npx tsc --noEmit`, `npx eslint src e2e`, `npx vitest run` (with the lock), `npx next build` (with the lock; no warnings), and `E2E_GATE_PORT=<yours> npx playwright test` (with the lock) all green.
- Your gate specs pass; existing specs stay green.
- A QA pass (Sonnet, against `docs/ui-checklist.md`) with no open should-fix items. Anything deferred goes in your decisions log with the reason.
- Stray outputs deleted.
- Commit on your branch, "Phase N: <name>" (no attribution lines). Never push, and never merge into `prototype` yourself.
- Post a one-line status, and write `docs/tracks/<a|b|c>-report.md` in the worktree, on its branch:
  - what you built;
  - schema and migration changes;
  - new dependencies;
  - files outside your ownership you had to touch;
  - known issues;
  - anything the integrator must do.
- Stop your dev server.

## Track A: Phase 5, going live
Scope: the handoff's Phase 5 section and the plan's §9 Phase 5. The gate is `scenario-04` and `scenario-05` end to end, plus `scenario-06` updated so that after the revoke, Coral's send in the simulator fails with the revoke message. Notes:
- Build the consumer API first, since the simulator depends on it:
  - `GET /api/v1/templates` (Active only, searchable);
  - `GET /api/v1/templates/{id}` (metadata + contract);
  - `GET /api/v1/consumers/{id}/notices`.
- The simulator reaches UCOMP only over `/api/v1` (ESLint enforces it), with its own palette and the dashed "Coral — simulated" banner. It's a full-page route with "← Back to UCOMP".
- The Usage dashboard follows `reference-images/Unknown.png`, with server-rendered SVG charts. Previews never count.
- The integration panel goes in `workspace-share.tsx`'s sheet.
- Taste calls (simulator look, dashboard composition): mock, pick, log in `docs/decisions/track-a.md`.

## Track B: Phase 6, access and admin
Scope: the handoff's Phase 6 section and the plan's §9 Phase 6. The gate is `scenario-07` and `scenario-08` end to end. Notes:
- `src/domain/access.ts` first, pure, taking `now`:
  - request and decide access (never your own);
  - recertification lapse at the deadline;
  - inactivity flag at 90 days and auto-suspend at 120.
  Opus writes it and reviews the clock-driven lapses.
- The settings modal follows `reference-images/Unknown-3.png`. Its frame exists in `src/components/settings/`.
- Approval chains: Riley adds Dana Park's "Legal reviewer" stage, then demo and e2e-test a TWO-stage approval. Phase 4's review screen already advances the stepper per stage; it was only unit-tested.
- Notifications UI: the popover exists in `app-shell/notifications-popover.tsx`; Phase 4 writes the rows. Add the unread dot, mark as read, and every event kind. Sidebar cards: "Recertification due" and "Access request pending".
- Taste calls (settings sections, audit filters): mock, pick, log in `docs/decisions/track-b.md`.

## Track C: Phase 7a + carried rough edges (start when A or B finishes)
Scope:
- Import .docx, .pdf and .txt, with "Compare with original". Use the editor's `normalizePastedHtml`, `chipsInJSON` and `ensureBlockIds`; `mammoth` (or similar) for docx; pdfjs-dist's legacy build for PDF text; uploads in `./data/uploads`.
- The Copilot prompt dialog. Pasting back turns `{{key}}` into chips via the existing paste path.
- Extend the existing ⌘K palette (`app-shell/command-palette.tsx`).
- The gate: `scenario-09` and `scenario-10`.

Also fix:
- **Typing latency.** Re-measure with `node e2e/perf/typing-latency.mjs`; Phase 4 left it at a 2.5ms median vs ~1.5ms in Phase 2. Profile `src/editor/extensions/review-threads.ts`, the block-rect observers and `format-bubble.tsx`. Check `git log` first in case Sri already ran this separately.
- **The PDF keep-with-next chain:** a heading plus its one-line intro shouldn't be stranded before a table that moves to the next page.
- **Redline "Changes only":** give a marker to threads on hidden unchanged blocks.

## Integration (the same lead, in the main checkout on `prototype`)
1. Merge `track/golive`, `track/access` and `track/import` into `prototype` one at a time. Resolve conflicts using each track's report.
   - Drop the track migrations and regenerate one from the merged schema with `npx drizzle-kit generate --name phase5_7`.
   - Run `npm install` for the merged lock file.
   - After each merge: `tsc`, `eslint`, `vitest`, then a targeted run of that track's specs.
2. Phase 7b:
   - the full UX pass;
   - one serial Playwright run of the whole demo script (scenarios 1–11) from a fresh reset, with zero console errors;
   - the principle checks on every route: one primary per canvas, statuses via StatusBadge only, no placeholder text except "Type / for blocks", axe clean, CLS 0;
   - `npm run gate:media`;
   - the contact sheet;
   - the walkthrough recording.
3. Merge the three decision logs into `docs/decisions.md`, write `docs/final-review.md`, and follow the handoff's "Final handoff to Sri" (reset the DB, stop the servers, send the media). Commit as "Phases 5–7: integration" (no attribution lines). Never push.
4. Remove each track's worktree after merging it (stop its dev server first): `git worktree remove ../ucomp-golive` (and the others). The branches stay in the repo.
