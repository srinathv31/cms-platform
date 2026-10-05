# Track B report: Phase 6, access and admin

Branch `track/access`, worktree `../ucomp-access`. Decisions: `docs/decisions/track-b.md`. Brief: `docs/phase-6-brief.md`.

## What was built
- **Access domain** (`src/domain/access.ts`, pure, takes `now`): request/decide access (never your own; denial needs a note), member role changes (nobody changes their own access; every team keeps a Team Admin), inactivity (flag at 90 days, auto-suspend at 120, Keep/Reinstate restart the clock), recertification (Team Admins excluded; lapse exactly at the deadline; early close), and `sweepAccess` (backdated, idempotent, last-active-Team-Admin protected). The sweep runs on Advance clock, persona switch, and before every access action.
- **Server**: `server/access-sweep.ts`, `access-effects.ts` (audit + notifications), `actions/access.ts`, `actions/platform.ts`, `actions/notifications.ts`, `queries/access.ts`, `queries/platform.ts`, `queries/audit.ts`, the CSV route `[team]/audit/export`.
- **Platform config** (`domain/platform-config.ts`): teams, content-type required sections (new templates conform), channel rules with consequences, approval chains with Now/After change descriptions.
- **Two-stage approval**: stage reviewers named on a stage can act across teams (through their own space); nobody approves two stages; a retargeted waiting stage notifies the new reviewer; outside reviewers can preview.
- **UI**: Settings modal Team group (Members, Access requests, Recertification, Inactivity) and Platform group (Teams, Content types, Channel rules, Approval chains), variant A rows with consequence strips; Request access page; notifications bell (unread dot, mark read, all kinds); sidebar cards (Access request pending, Recertification due, Your request is waiting); Audit page (filter bar + chips, presets, CSV export).
- **Specs**: `scenario-07`, `scenario-08`, `phase-6-two-stage` (2 tests), helpers in `e2e/helpers/access.ts`.

## Checks at commit
- `tsc` clean; `eslint src e2e` 0 errors (1 pre-existing warning in `e2e/qa/contact-sheet.mjs`).
- `vitest`: 107 files, 1,944 tests passed.
- `next build`: passes. It prints one Node `ExperimentalWarning: localStorage is not available…` during static generation; the same localStorage read exists on `prototype` (`sidebar-card.tsx`), so it's most likely Node 26 runtime noise. To confirm against a `prototype` build at integration.
- Gate `E2E_GATE_PORT=3102 npx playwright test`: 115/115 passed on a fresh build of the committed code.
- QA (Sonnet, checklist): 4 must + 8 should found; all fixed and re-verified with axe by the fix agent. The one deferral: review-queue count contrast (Phase 4 file, `src/components/review-queue`), left for the 7b UX pass.

## Schema and migration
- `memberships`: `status_reason`, `inactivity_flagged_at`, `inactivity_kept_at`.
- `access_requests`: indexes on (team_id, status) and (user_id).
- Migration `0002_phase6_access.sql` (+ snapshot, journal). It will collide with Track A's `0002_phase5_golive`; regenerate at integration.
- `types.ts`: `MembershipStatusReason`; `access-types.ts` is new.

## Seed changes
- Dana Park is the 9th persona (Coral Offers Viewer). `phase-1.spec.ts` expects 9 personas.
- Devon seeded as flagged 5 days ago. Recertification items exclude Team Admins (6 items).
- Seed notification kinds renamed to match the code (`version_active` → `version_live`, etc.).

## New dependencies
None.

## Files outside the ownership map
- `src/server/actions/review.ts`, `actions/comments.ts`, `queries/review.ts`, `queries/review-shared.ts`, `domain/lifecycle.ts`: two-stage wiring.
- `src/server/actions/templates.ts`: `createTemplate` conforms to the content type's sections and allowed channels.
- `src/server/effects.ts`: review links for out-of-team stage reviewers.
- `src/server/render/render-template.ts`: preview for out-of-team stage reviewers.
- `src/server/queries/format.ts` (`dayAgo`), `queries/notifications.ts`.
- `src/components/demo/demo-pill.tsx` (Track A owns it): Reset demo clears `ucomp:dismissed:*` keys. **Expect a conflict with Track A's demo-pill edit** (simulator link); keep both.
- `src/components/app-shell/sidebar-holes.tsx`, `app-frame.tsx` (sidebar landmark), `team-icon.tsx` (6 icons).
- `src/components/primitives/…`: none. `e2e/phase-1.spec.ts`, `e2e/navigation.spec.ts` (afterAll reset) adjusted.
- `src/app/(product)/[team]/settings/[section]/page.tsx`: `instant = false`.

## Known issues
- Reordering approval stages doesn't remap versions already waiting (deferred; see decisions).
- Platform Admins can't add a Team Admin to an existing team, so the "kept last Team Admin" alert only informs.
- Links rendered as `<Button render={<Link/>}>` get role "button" (sidebar card "Review", audit Export). Specs locate them by href.
- One transient 500 in `render.spec` "invalid_values" in an early gate run; it didn't recur.

## For the integrator
1. Resolve `demo-pill.tsx` with Track A (keep the simulator link and the dismissal clearing).
2. Drop both tracks' `0002_*` migrations and regenerate one (`phase5_7`).
3. `e2e/phase-1.spec.ts` card test now expects "Access request pending" for Alex (one card per space by priority).
4. Specs that run `db:reset` at the end (07, 08, two-stage, navigation) are what keeps the gate order-independent.
