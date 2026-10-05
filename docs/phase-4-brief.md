# Phase 4 brief: lifecycle and review

Read this instead of the long plans. They're the source if this is silent: `docs/UCOMP-Implementation-Plan.md` §9 "Phase 4", and the build plan's "Template lifecycle", "Review and approval" and "Demo script" scenarios 3 and 6.

**Gate:** scenarios 3 and 6 end to end (`e2e/scenario-03.spec.ts`, `e2e/scenario-06.spec.ts`), domain tests for every lifecycle row, and visual QA of the queue, the review screen, the redline and the dialogs.

**Contracts:** `src/domain/review-types.ts` (written by the lead) holds the effects, chain, comments, redline, consequences and read-model types. Don't change it. If it's wrong, make the smallest additive change and say so first in your report.

## What exists (Phases 1–3)
- **Lifecycle.**
  - `src/domain/lifecycle.ts`: `createDraft`, `editActive`, `submit` (minimal: no note, no notifications).
  - `src/server/actions/templates.ts`: `submitDraft` and `writeEffects`.
  - Permissions: `can(viewer, action, resource)` in `src/domain/permissions.ts`. The reasons are `REASONS.ownVersion` ("You submitted this version.") and `REASONS.ownRevoke` ("You started this revoke. Another approver must confirm it.").
- **Schema.** `approvals`, `comment_threads` (block_id, quote, status), `comments` (kind comment | change_request), `consumer_notices`, `audit_events`, `notifications`. No migration is expected.
- **Workspace.** `src/components/workspace/*` (Rail layout).
  - Placeholder pages: `src/app/(product)/[team]/review/page.tsx`, `…/templates/[templateId]/versions/page.tsx`, `…/activity/page.tsx`.
  - Preview components to reuse: `src/components/preview/*` (channel control, sample-set switcher, outputs, `use-preview-render`).
- **Render.** `POST /api/v1/templates/{id}/render` with `preview:true` renders any version number.
- **Editor.** `DocumentEditor` already accepts `threads`, `onRequestComment` and `renderThread` (not drawn yet). Public API is additive only (`src/editor/README.md`).
- **Seed.**
  - Coral "Cash Back" v3 is In review (by Maya, breaking change).
  - "Annual Fee Waiver" v1 has Changes requested, plus a draft with threads.
  - "Balance Transfer Intro" v1 is Superseded with a sunset in 21 days and still rendered by Coral; v2 is Active (scenario 6).
  - "Holiday Points" v1 is Revoked.
  - Approver: Jordan. Alex is an approver too (check `src/server/seed/teams.ts`).

## Owners and signatures

**D1 domain (Opus).** Owns `src/domain/{lifecycle,approval-chain,contract,consequences,activity}.ts` and their tests. Pure; it takes `now`.
```ts
// lifecycle.ts — keep the existing exports; LifecycleEffect now comes from review-types
submit(input & { note?: string })                    // + submitNote; + notification review_requested to team approvers except the submitter
requestChanges({ version: ReviewVersion, actorId, actorName, reason, now, templateName })
  → Ok<{ changes: { state: "changes_requested" }; approval: ApprovalRecord; newDraft: DraftFields; reasonComment: { blockId: typeof DOCUMENT_THREAD; body: string; kind: "change_request" }; effects }> | Refused
approve({ version: ReviewVersion, chain: ApprovalStage[], actorId, actorName, now, active: { id, number } | null, sunsetPrevious: Date | null, sampleSetsSeen: string[], templateName })
  → Ok<{ changes; approval: ApprovalRecord; previous?: { id; changes: { state: "superseded"; supersededAt; sunsetAt?; sunsetSetBy? } }; wentLive: boolean; effects }> | Refused
setSunset({ version, actorId, now, sunsetAt: Date, activeNumber, templateName })      → Ok<{ changes: { sunsetAt; sunsetSetBy }; effects }> | Refused
startRevoke({ version, actorId, actorName, reason, now, templateName })                → Ok<{ changes: { revoke } }> | Refused
confirmRevoke({ version, actorId, actorName, now, activeNumber, templateName })        → Ok<{ changes: { state: "revoked"; revoke } }> | Refused
cancelRevoke({ version, actorId, now })                                                → Ok<{ changes: { revoke: null } }> | Refused
// Ok<T> = { ok: true } & T; Refused = { ok: false; reason: string }. ReviewVersion and ApprovalRecord are defined and exported by D1.
// approval-chain.ts
stepperState(chain: ApprovalStage[], decisions: { stagePosition; decision; by: Person; at: string }[], version: { state; currentStage }): StepView[]
canActOnStage(viewer: Viewer, stage: ApprovalStage, teamId: string): PermissionResult   // maker-checker stays in can("version.decide")
// contract.ts
describeChanges(changes: ContractChange[], versionNumber: number): string[]   // "v2 adds required `annual_fee` (Currency)."
// consequences.ts
consequences(action: ConsequenceAction, usage: ConsumerUsage[], now: Date): string[]
// "v2 becomes Active. v1 becomes Superseded; Coral keeps rendering v1 until it relinks." / "Coral still renders v1 (last render today). It will keep working until March 1, 2027."
// activity.ts
describeActivity(e: { action: string; details: Record<string, unknown>; versionNumber: number | null }, actor: Person | null): string
```

**D2 redline (Opus).** Owns `src/domain/redline.ts` and its test: `diffDocuments(base: JSONContent | null, next: JSONContent): RedlineDoc`, `changesOnly(doc: RedlineDoc): RedlineBlock[]`.

**D3 server (Opus).** Owns:
- `src/server/effects.ts`: `writeEffects`, moved here.
- `src/server/actions/{review,comments}.ts`.
- `src/server/queries/{review,versions,activity,threads}.ts`.
- The `submitDraft` call site in `actions/templates.ts`.
- Additive fields on `queries/workspace.ts`: `threads: ThreadView[]`.

Every action: `assertCan` → domain transition → ONE transaction → `refresh()`. Each returns `ActionResult`.
```ts
submitVersion({ templateId, note? }) → ActionResult<{ number }>        // submitDraft stays as an alias
requestChanges({ templateId, versionNumber, reason }) → ActionResult
approveVersion({ templateId, versionNumber, sunsetPrevious?: string /*YYYY-MM-DD*/, sampleSetsSeen: string[] }) → ActionResult<{ wentLive: boolean; number: number }>
setSunset({ templateId, versionNumber, sunsetAt: string }) / startRevoke({ templateId, versionNumber, reason }) / confirmRevoke({ templateId, versionNumber }) / cancelRevoke({ templateId, versionNumber }) → ActionResult
addComment({ templateId, versionId, blockId, quote?, body }) → ActionResult<{ threadId }>; reply({ threadId, body }); resolveThread({ threadId }); reopenThread({ threadId })
getReviewQueue(spaceSlug) → ReviewQueue; getReviewBadgeCount(spaceSlug) → number
getReviewScreen(spaceSlug, templateId, versionNumber) → ReviewScreenData
getVersions(spaceSlug, templateId) → VersionsData; getActivity(spaceSlug, templateId) → ActivityItem[]
```

**UI (Sonnet).** Each agent owns its own folder.
- **U1:** submit dialog, review queue and sidebar badge.
- **U2:** redline renderer, Versions tab and Activity tab.
- **Review-screen agent (after Sri's pick):** review screen, comments UI and margin wiring.

**E1 editor (Opus).** Owns `src/editor/**` (additive): comment mechanics.

## Routes
- `/[team]/review`: the queue. Tabs: Waiting on me, Submitted by me, Recently decided.
- `/[team]/review/[templateId]/[version]`: the review screen.
- The Versions and Activity tabs live in the template workspace.
- After an approve that goes live, the go-live moment plays, then the template workspace shows the SHARE ring. Carry one-shot signals in a cookie like `src/components/workspace/just-created.ts`, never a URL param.

## Gotchas (from Phases 1–3)
- Cache Components: request data and the DB only inside `<Stream>`. A DB read before `cookies()`/`params` needs `await connection()`. Use `now()` from `@/server/clock`, never `new Date()`, in server components.
- Next keeps hidden routes mounted (`<Activity>`); effects re-run on show.
- Don't rewrite the URL after a server-action redirect.
- libSQL can throw SQLITE_BUSY on overlapping writes; see the retry in `src/server/drafts/apply-patch.ts`.
- Playwright:
  - human-paced clicks;
  - locators filtered to visible elements;
  - wait for the live editor (`pmViewDesc`) before typing;
  - stepped `mouse.move` for drag;
  - preview iframes need `test.use({ trace: "off" })`;
  - after Email is on, three `.ProseMirror` editors exist: use `documentEditor(page)`.
- The dev server and DB are shared: create your own templates for testing, and restore any seeded row you change.
- `E2E_PORT=3000` specs run against the running dev server only. Playwright never starts or resets anything on a port other than 3100 (`playwright.config.ts`). If the dev server answers 500 because someone is mid-edit, wait and retry; don't work around it.

## Wave 2 (Sri's picks, Oct 5)
- **Review screen: mock A, "document first"** (`src/app/(dev)/design/review/`, `?variant=a`). Port it for real.
- **Comments: mock A, "threads in the rail"** (`src/app/(dev)/design/comments/`, `?variant=a`), plus its review-frame screen.

**Comments components** (owner: the comments agent; the review-screen agent consumes them), in `src/components/comments/`:
```ts
// thread-list.tsx ("use client"): the list of threads (change request first, then document order, then orphaned; "Resolved (N)" collapsed)
export interface ThreadListProps {
  threads: ThreadView[];
  activeThreadId: string | null;
  onActivate: (threadId: string | null) => void;
  canComment: boolean;                         // reply, resolve, reopen, compose
  composer: { blockId: string; quote?: string } | null;  // a new-thread composer, shown at the top of the list
  onComposerClose: () => void;                 // posted or cancelled
  templateId: string;
  versionId: string;                           // where a new thread is created
  className?: string;
}
// gutter-markers.tsx ("use client"): comment markers in the document's right gutter, positioned from the editor handle
export interface GutterMarkersProps {
  editor: React.RefObject<DocumentEditorHandle | null>;
  threads: ThreadView[];                       // open, non-orphaned threads get markers (count per block)
  activeThreadId: string | null;
  onActivate: (threadId: string) => void;
  onRequestBlockComment?: (blockId: string) => void;   // keyboard or hover path for a block-level comment
}
// use-review-threads.ts: the client state both screens share
export function useReviewThreads(initial: ThreadView[]): {
  threads: ThreadView[]; activeThreadId: string | null; setActive(id: string | null): void;
  composer: { blockId: string; quote?: string } | null; openComposer(anchor: { blockId: string; quote?: string }): void; closeComposer(): void;
}
```
- Mutations go through `@/server/actions/comments` (`addComment`, `reply`, `resolveThread`, `reopenThread`), optimistically (`useOptimistic`), and `refresh()` reconciles.
- The editor side is E1's API (`src/editor/README.md` → Comments):
  - `threads` and `activeThreadId`;
  - `onThreadClick` and `onRequestComment`;
  - the handle's `focusThread`, `getThreadRect` and `subscribeBlockRects`.
- While the composer is open, pass a temporary open anchor so the selected quote stays highlighted.
