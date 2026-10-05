# Phase 6 brief: access and admin (Track B)

Read this instead of the long plans. They're the source if this is silent: `docs/UCOMP-Implementation-Plan.md` §9 "Phase 6" and §12 Q5, and the build plan's "Teams, access and administration" and "Demo script" scenarios 7 and 8. Worktree: `/Users/srinathvenkatesh/Documents/CodeProjects/prototypes/cms-platform/ucomp-access`, dev server http://localhost:3002, gate port 3102.

**Gate:** `e2e/scenario-07.spec.ts` and `e2e/scenario-08.spec.ts` end to end, plus `e2e/phase-6-two-stage.spec.ts` (Riley adds Dana Park's "Legal reviewer" stage; Jordan approves stage 1, Dana approves stage 2, the version goes Active). Domain tests for every access rule and clock boundary. Visual QA of the settings modal against `reference-images/Unknown-3.png`.

**Contracts** (written by the lead; don't change them; if one is wrong, make the smallest additive change and say so first in your report):
- `src/domain/access-types.ts`: rules constants, domain facts, changes, effects, every read model, action and query signature, the sidebar card model, `PlatformConfigDomain` and `AuditDomain` signatures.
- `src/domain/access.ts` (+ 73 tests): request/decide, members, inactivity, recertification and `sweepAccess`. Done; consume it.
- `src/domain/permissions.ts`: `REASONS.ownAccess`; `team.manageMembers` refuses `subjectUserId === viewer`; `stageApproverIds` lets the user a stage names decide and comment (needs `template.view` on the team; maker-checker still applies).
- `src/server/access-effects.ts` (+ tests): `writeAccessEffects(tx, effects, { now, actorId })`, `applyMembershipChange(tx, change)`, `accessHref(link)`, `resolveAccessRecipients`. Use with `inTransaction` from `src/server/effects.ts`.
- `src/components/settings/section-body.ts` + `team/index.tsx` + `platform/index.tsx`: each group's section bodies live in its own registry; `settings-panel.tsx` renders `<Body teamSlug>` inside the panel's Suspense.

## Rules (domain/access.ts, final)
- Request: Viewer/Author/Approver only, reason 1–500 chars, one pending per team; a role already held is refused; lapsed or suspended people may ask again. Effects: `access.requested` + `access_requested` to the team's Team Admins.
- Decide: never your own; pending only; deny needs a note (shown to the requester). Approve inserts a membership, adds the role to an active one, or reinstates a lapsed/suspended one with exactly that role and a fresh inactivity clock.
- Members: nobody changes their own access; a team keeps ≥1 active Team Admin; Remove deletes the membership.
- Inactivity: anchor = latest of last sign-in, date added, last Keep. Flagged at ≥90 days, auto-suspend at ≥120 days. Admin Suspend or Keep (Keep restarts the clock). Reinstate also restarts it.
- Recertification: covers active members minus Team Admins (seed: Jordan, Maya, Priya, Sam, Devon, Dana = "of 6"). Keep, or Remove (access ends at once). Open while `startsAt ≤ now < dueAt`; at `now ≥ dueAt` it's closed: unconfirmed active members lapse AT dueAt. All decided → closes early. "Start review" when none is open (due in 30 days).
- `sweepAccess({ now, memberships, recerts, teams, people })`: everything the clock crossed, backdated to the boundary (audit `at`, notification `createdAt`, `statusChangedAt`); earliest boundary per membership wins (tie → the review); idempotent; effects in time order.

## Seed (done, `npm run db:reset` verified)
- **Dana Park is the 9th persona** (Legal Reviewer, Coral Offers Viewer). Decision for Sri to overrule: a named-person stage needs someone to switch to; the build plan's stretch lists "A Legal reviewer persona". `e2e/phase-1.spec.ts` now expects 9 switcher items.
- Devon (95 days idle) has `inactivityFlaggedAt` = 5 days ago, an `access.flagged_inactive` audit row and a read `inactivity_flagged` notification for Alex. Auto-suspension lands 25 days after reset.
- Recert items exclude Team Admins. Notification kinds normalized to `AnyNotificationKind` (`access_requested`, `recert_due`, `sunset_scheduled`, `version_live`, `version_revoked`).
- Schema: `memberships.status_reason`, `inactivity_flagged_at`, `inactivity_kept_at`; indexes on `access_requests` (team_id,status) and (user_id). Migration `0002_phase6_access.sql`.

## Routes
- `/request-access` (Morgan; anyone whose memberships ended lands here via `requireSpace`).
- `/{team}/settings/{members|access-requests|recertification|inactivity|teams|content-types|channel-rules|approval-chains}` (modal + hard-nav fallback, both exist).
- `/{team}/audit` (`?team&person&action&from&to`) and `/{team}/audit/export` (CSV, same params).

## Gotchas
- Sweep entry points: `advanceClockAction` (after the offset changes) and `switchPersona` (sweep FIRST, then `users.lastActiveAt = now()`: a persona switch is the sign-in). Real-time drift between those is accepted.
- `getShell`: keep `SpaceNav.recert` (sidebar-body reads it) and add `card: SidebarCardModel | null`, plus `ShellData.homeCard` for a viewer with no space (Morgan's "my_request"). U3 switches the sidebar to `card`.
- Every access/platform mutation: `revalidatePath("/", "layout")` + `refresh()` (the switcher summaries and sidebar change).
- `can(viewer, "version.decide" | "review.comment", { …, stageApproverIds })` everywhere a version in review is decided, commented or queued (`queries/review.ts` waiting/badge, `queries/review-shared.ts`, `actions/review.ts`, `actions/comments.ts`). Ids = the current stage's `{kind:"user"}` rule, else `[]`.
- Content-type section edits only shape templates created afterwards (the editor protects headings by the document's `requiredKey`); check `createTemplate` and any submit-time section check before allowing removals.
- Turning a channel off makes the render route refuse it for Active templates too: the confirm must name how many Active versions use it.
- A Platform Admin's Platform bodies may get `teamSlug = "all"`. Team Admin sees the audit for their own team only; Auditor and Platform Admin get "All teams" plus a team filter.
- Audit times are stored on the demo clock: show with `stamp()`; CSV uses ISO. Never put variable values in details.
- Cache Components, Base UI `render`, typed routes (`as Route`), Playwright and shared-server rules: `docs/agent-brief.md`, `docs/phase-4-brief.md` → Gotchas.
- Never touch `src/app/(dev)/design/*` (taste mocks). UI slices follow the variant the lead names (`docs/decisions/track-b.md`).

## Slices (at most 3 at once; every brief adds agent-brief.md, ui-checklist.md for UI, this brief, access-types.ts)

**Wave 1: server (all Opus, parallel)**
- **S1 Access server.** Owns `src/server/access-sweep.ts` (+test: `runAccessSweep(): Promise<SweepResult>` reads facts, calls `sweepAccess`, applies in one transaction), `src/server/actions/access.ts` (+test, the `AccessActions` signatures), `src/server/queries/access.ts` (`getRequestAccessData`, the four Team sections, `getSidebarCards`), `src/server/queries/spaces.ts` (additive `card`, `homeCard`), `src/server/actions/demo.ts` (sweep in `advanceClockAction` only), `src/server/actions/persona.ts` (sweep + lastActiveAt). Accept: temp-DB tests (pattern: `src/server/effects.test.ts`) for request → approve → membership, deny note, self-refusals, recert keep/remove/early close, sweep idempotent across a 31-day advance (Devon suspended day 25, unconfirmed lapse at the deadline).
- **P1 Platform config + two-stage.** Owns `src/domain/platform-config.ts` (+test, `PlatformConfigDomain`), `src/server/actions/platform.ts` (+test), `src/server/queries/platform.ts`, the `stageApproverIds` wiring in `src/server/actions/{review,comments}.ts` and `src/server/queries/{review,review-shared}.ts` (+their tests), and in `src/domain/lifecycle.ts` (+test) one guard: nobody approves two stages of the same round ("You approved an earlier stage."). Accept: chain save keeps in-review versions on the same stage id; removing a stage someone waits on is refused; a DB test: Maya submits → Jordan approves stage 0 (stepper advances, Dana notified) → Dana approves stage 1 → Active; Dana's review badge counts it.
- **S3 Audit + notifications server.** Owns `src/domain/audit.ts` (+test, `AuditDomain`), `src/server/queries/audit.ts` (`getAuditPage`, permission `audit.view`), `src/app/(product)/[team]/audit/export/route.ts` (CSV, `Content-Disposition`), `src/server/actions/notifications.ts` (+test), `src/server/queries/notifications.ts` (add `getNotificationsData`; keep `getNotifications` until U3 switches). Accept: a sentence for every access/platform action and every lifecycle action (via `describeActivity`); filters by team/person/action/category/date (demo-clock days, inclusive); CSV round-trips commas, quotes and newlines.

**Wave 2: UI (all Sonnet, parallel; after wave 1 and the lead's mock picks)**
- **U1 Team settings.** Owns `src/components/settings/team/**`. Members (roles editor, remove, reinstate), Access requests (approve/deny with note; own request disabled with the reason), Recertification (Keep/Remove per member, "4 of 6 confirmed", due date, closed summary, Start review), Inactivity (flagged with days and auto-suspend date; Suspend/Keep; suspended list with Restore). Depends: S1.
- **U2 Platform settings.** Owns `src/components/settings/platform/**`. Teams (create team + first Team Admin), Content types (required sections), Channel rules (type × channel matrix with consequence confirm), Approval chains (ordered stages: add, rename, reorder, remove; rule = Approver role or a named person, e.g. Dana Park "Legal reviewer"). Depends: P1.
- **U3 Access shell.** Owns `src/app/(product)/request-access/page.tsx`, `src/components/access/**`, `src/components/app-shell/{notifications-popover,top-bar-hole,sidebar-card,sidebar-body,profile-menu}.tsx`. Request access (team cards with admin, role, reason, pending state replaces the form, denial note, ended-access line), the bell (unread dot, unread count, mark read on open-click, "Mark all as read", an icon per `AnyNotificationKind`), sidebar cards from `SidebarCardModel`, and the switcher with 9 personas. Depends: S1, S3.

**Wave 3**
- **U4 Audit page (Sonnet).** Owns `src/app/(product)/[team]/audit/page.tsx`, `src/components/audit/**`. Filters in the URL, table (when, who, team, template + version, action, details), CSV link, empty state as an action. Depends: S3.
- **E1 Gate specs (Sonnet).** Owns `e2e/scenario-07.spec.ts`, `e2e/scenario-08.spec.ts`, `e2e/phase-6-two-stage.spec.ts`, additive `e2e/helpers/access.ts`. 07: Priya edits Coral / View only in Deposits; Sam opens SHARE (sheet frame only in this track) and can't edit; Riley turns a channel off then back on, then opens a template read-only; Taylor in All teams sees those events in the Audit page with demo-clock times. 08: Morgan requests Author on Coral; Alex sees the card and the bell item, approves; Morgan lands on the Library; Alex keeps everyone but Sam; advance 31 days; Sam lands on /request-access with the lapsed line; Alex's Members shows Sam lapsed and Devon suspended. `shoot()` stills at each beat. Depends: U1–U4.
- **R1 Opus review.** Reviews `src/domain/access.ts`, `src/server/access-sweep.ts`, `src/domain/platform-config.ts` chain remap and the review wiring for clock and permission holes. Fixes only inside those files; reports the rest.

**Wave 4:** QA (Sonnet, report only, `docs/ui-checklist.md`, the settings modal vs Unknown-3.png at 1280 and 1440), then one fix agent (Sonnet) owning exactly the files QA names. Then the track's definition of done (`docs/tracks/README.md`).
