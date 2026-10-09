# `src/domain`: the business rules, as pure TypeScript

The product's rules live here: the template lifecycle, review and the approval chain, permissions, team access,
platform settings, the consumer contract, the render rules, import, and the sentences people read about all of
them. Nothing here touches the database, the framework, or the clock. Server actions, queries, and route handlers
call these functions and write what they return; client components call them too, to word things and to
recompute lines as a person types. Most rules are here, but not all of them yet: see
[Rules that live outside `src/domain`](#rules-that-live-outside-srcdomain).

## Rules

- **Lint-enforced** ([eslint.config.mjs](../../eslint.config.mjs), `files: ["src/domain/**/*.ts"]`): no `react`,
  `next`, `drizzle-orm`, `@/server/*`, `@/components/*`, `@/app/*`, or `@/simulator/*`. From the editor, only its
  pure model (`@/editor/model/*`) may be imported; `@/editor/schema` and everything else under `@/editor` fail lint.
  The variable list's diff, the breaking-change rule, and value validation and formatting live in that model
  ([contract.ts](../editor/model/contract.ts), [variables.ts](../editor/model/variables.ts)) so the editor can flag
  changes live; [contract.ts](contract.ts) and [types.ts](types.ts) re-export them. The model also holds a
  document's save normalization and limits ([normalize.ts](../editor/model/normalize.ts),
  [document-check.ts](../editor/model/document-check.ts)), which the editor, autosave, import, and render share.
  The other direction is banned too: `src/editor` and `src/simulator` may not import `@/domain`.
- **Convention, not linted.** No clock: never call `Date.now()` or `new Date()` without an argument. The caller
  passes `now`, the demo clock, which only [server/clock.ts](../server/clock.ts) reads. No randomness and no id
  generation: callers assign ids, or pass a generator (`conformToSections(body, sections, newId)`). Production
  files import only each other, `@/editor/model/*`, and the wire types in `@/contracts/api-v1`. `@/lib`,
  `@/hooks`, `zod`, and `node:*` are not banned, but no production file here uses them (two tests use `zod` and
  `node:fs`).
- **This code runs in the browser.** Client components import it (for example
  [sunset-dialog.tsx](../components/versions/sunset-dialog.tsx) recomputes `consequences` as the date changes).
  No Node APIs, no `server-only`, no heavy dependencies.
- **Wording is behavior.** Refusal sentences (`REFUSALS`, `REASONS`, `ACCESS_REFUSALS`, `PLATFORM_REFUSALS`,
  `IMPORT_REFUSALS`) are shown as is, and the UI compares some of them:
  [decision-model.ts](../components/review/decision-model.ts) hides the decision buttons when the reason is
  `REASONS.generic`, and [version-actions.tsx](../components/versions/version-actions.tsx) checks
  `REASONS.ownRevoke`. Search for a constant's uses before you reword it.
- Domain inputs use `Date`; read models that cross into client components use ISO strings.
- Messages and notice payloads never contain a submitted variable value.

## Layout

| Area | Path | What it holds |
| --- | --- | --- |
| Vocabulary | [types.ts](types.ts) | `VersionState`, `Channel`, roles, `Viewer`, the permission `Action` list, `DraftPatch`. Re-exports the editor model's `Variable` and `ContractChange`. |
| | [status.ts](status.ts) | Label, tone, and icon for each version state. |
| | [review-types.ts](review-types.ts), [access-types.ts](access-types.ts), [golive-types.ts](golive-types.ts), [import-types.ts](import-types.ts), [render/types.ts](render/types.ts) | Each area's contract: inputs, effects, limits, read models. `golive-types.ts` re-exports `@/contracts/api-v1` and type-checks the render types against it (`_DriftChecks`). |
| Lifecycle | [lifecycle.ts](lifecycle.ts) | Every version transition: `createDraft`, `planDraftStart`, `editActive`, `submit`, `requestChanges`, `approve`, `setSunset`, and the two-person revoke. |
| Review | [approval-chain.ts](approval-chain.ts) | Stage order, whose stage it is (`canActOnStage`), who a stage notifies, the stepper. |
| | [redline.ts](redline.ts) | The diff between two versions' documents, for the review screen. |
| Access and audit | [permissions.ts](permissions.ts) | `can`, `assertCan`, `REASONS`, and the team switcher's spaces. |
| | [access.ts](access.ts) | Access requests, members, recertification, inactivity, and the clock-driven `sweepAccess`. |
| | [platform-config.ts](platform-config.ts) | Teams, required sections, channel rules, approval chains. |
| | [audit.ts](audit.ts), [activity.ts](activity.ts) | One sentence per audit event, the Audit page's filters and CSV, notification fallbacks. |
| Contract and consequences | [contract.ts](contract.ts) | One sentence per contract change: "v2 adds required `annual_fee` (Currency)." |
| | [consequences.ts](consequences.ts) | Who an approve, sunset, or revoke affects, from render usage. |
| Consumer API and usage | [golive/](golive/) | `/api/v1` query parsing and errors (`api-errors.ts`), the paging cursors of search and notices and the search order (`cursor.ts`), published contract diffs (`contract-diff.ts`), the JSON Schema for `values` (`json-schema.ts`), notices as served (`notices.ts`), the integration panel's samples (`samples.ts`), and the Usage numbers (`usage.ts`). |
| Render rules | [render/](render/) | Which versions render (`version-rules.ts`), value checks (`validate.ts`), TipTap JSON to `RenderDoc` (`resolve.ts`), JSON numbers kept as their exact source text (`json-number-text.ts`), and the exact error sentences (`errors.ts`). Specified in [docs/render-spec.md](../../docs/render-spec.md). [render/index.ts](render/index.ts) is the only barrel here. |
| Import and Copilot | [import.ts](import.ts), [copilot.ts](copilot.ts) | What an imported file becomes as a draft; the prompt an author copies into Copilot. |
| Dates | [dates.ts](dates.ts) | The one way to write a date or time: always UTC; short forms add the year only outside the demo clock's year. |

## Vocabulary

| Term | Meaning here | Where |
| --- | --- | --- |
| Template | A document consumers render, with a stable id like `UC-4F7K2Q`. Belongs to one team and one content type. | `templates` in [ucomp.ts](../server/db/schema/ucomp.ts) |
| Version | One snapshot of a template: body (TipTap JSON), variables, channels, email fields, sample sets. `number` is null while it is a draft; `submit` sets it to the highest number + 1, and it never changes. | `VersionSnapshot`, `DraftFields` |
| Version states | `draft`, `in_review`, `changes_requested`, `active`, `superseded`, `revoked` (`VERSION_STATES`). The database allows one open draft and one Active version per template. | [types.ts](types.ts), [status.ts](status.ts) |
| Sunset | A date on a Superseded version. From then on, consumer renders fail with `version_sunset`. Once it has passed it is final: nothing moves or clears it. Not a state. | `setSunset`, `sunsetPassed`, `checkVersion` |
| Revoke pending | An Active or Superseded version whose `revoke` record has no `confirmedAt`. Not a state: it renders until a different approver confirms. | `revokePending` |
| Content type | Platform configuration a template follows: required sections, allowed channels, approval chain. | [platform-config.ts](platform-config.ts) |
| Required section | `{ key, title }`: a heading with `attrs.requiredKey` that the editor protects. Shapes new templates only; `submit` doesn't check sections. | `conformToSections` |
| Variable | `{ key, label, type, required, sample }`, shown as a chip. Keys are snake_case and unique per template. | `Variable` |
| Consumer contract | A version's variable list: what a consumer sends to render it. | [contract.ts](contract.ts), [golive/json-schema.ts](golive/json-schema.ts) |
| Breaking change | A change that breaks consumers of the Active version: a required variable added, a variable removed, a key renamed, a type changed, an optional one made required. `submit` stores the diff as `contractChanges`. | `diffVariables`, `isBreaking` |
| Consumer | A registered system (`consumers` table; the simulator plays `coral`) that calls `/api/v1` with `X-Consumer-Id` and pins a version number. It receives notices: `new_version`, `sunset_scheduled`, `revoked`. | [golive/](golive/) |
| Channel | `pdf`, `web`, or `email`. The content type allows it; the version turns it on. New templates start with `DEFAULT_CHANNELS` (`pdf`, `web`). | `CHANNELS` |
| Approval chain | Ordered `ApprovalStage`s per content type, stored as configuration. A stage's rule names a team role or one user. A version's `currentStage` indexes it. | [approval-chain.ts](approval-chain.ts) |
| Viewer, persona | `Viewer` is who is acting, built per request from the `ucomp_persona` cookie ([viewer.ts](../server/viewer.ts)). Personas are seeded people ([people.ts](../server/seed/people.ts)). | `Viewer` |
| Roles | Team roles `viewer`, `author`, `approver`, `team_admin`, held through a membership that is `active`, `suspended`, or `lapsed`. Platform roles `platform_admin` and `auditor` (read-only everywhere). | [types.ts](types.ts) |
| `can()` | The one permission check: role grants, then guards (maker-checker, two-person revoke, your own access request, your own access). | [permissions.ts](permissions.ts) |
| Effects | Side records a rule asks for: audit events, notifications, and consumer notices (`LifecycleEffect`), or audit events and notifications (`AccessEffect`). | [review-types.ts](review-types.ts), [access-types.ts](access-types.ts) |

The lifecycle, as [lifecycle.ts](lifecycle.ts) implements it:

```text
createDraft | editActive (from Active) | requestChanges   → draft
draft        submit                                       → in_review (numbered)
in_review    approve, earlier stage                       → in_review, currentStage + 1
in_review    approve, last stage                          → active; the previous active → superseded
in_review    requestChanges                               → changes_requested, plus a new draft
superseded   setSunset, until the sunset has passed       → superseded with sunsetAt
active | superseded   startRevoke, then confirmRevoke     → revoked   (cancelRevoke withdraws)
```

## How it works

**Transitions take facts and return values.** A transition gets everything as input: the rows it reads, the
actor, ids, and `now`. It returns either a refusal, `{ ok: false, reason }`, whose `reason` is the sentence the
person reads, or what to write plus `effects`. Lifecycle transitions return `changes`, plus `approval`,
`newDraft`, `reasonComment`, or `previous` when there is more than one row to write. Access and platform functions
name their rows instead (`request`, `membership`, `recert`, `requiredSections`). Nothing is written here. The
server writes it all in one transaction with `inTransaction` from [server/effects.ts](../server/effects.ts), which
retries `SQLITE_BUSY`.
`writeEffects` (same file) writes `LifecycleEffect`s and decides who receives them; `writeAccessEffects` and
`applyMembershipChange` in [server/access-effects.ts](../server/access-effects.ts) do the same for access. The
caller in `approveVersion` ([actions/review.ts](../server/actions/review.ts)), shortened:

```ts
const at = await now();                                 // the demo clock, read once
const result = await transact(async (tx) => {           // inTransaction; a Refusal becomes { ok: false, reason }
  const version = await loadVersion(tx, found, number); // re-read inside the transaction
  const outcome = approve({ version, chain, actorId: viewer.userId, now: at, /* … */ });
  if (!outcome.ok) refuse(outcome.reason);              // the domain's sentence; nothing is written
  await updateVersion(tx, version, { state: outcome.changes.state, /* … */ }, at, REFUSALS.notInReview);
  await writeEffects(tx, outcome.effects, effectContext(viewer, found, version.id, at));
  return { ok: true, wentLive: outcome.wentLive, number: version.number! };
});
```

**Permissions are a separate check.** Server actions call `assertCan` before the transition and turn a
`PermissionError` into a returned refusal. Transitions repeat only the guards they can see in their facts
(`approve` refuses the submitter with `REASONS.ownVersion`). Whether a stage is yours is `canActOnStage`, not
`can`. Read models carry `PermissionResult`s for the UI, such as `ReviewScreenData.can`.

**Three result shapes, by audience.** People get `{ ok: false, reason }`. Consumer API callers get
`{ ok: false, error }`, where `error` has a code that maps to a status (`RENDER_ERROR_STATUS`, `API_ERROR_STATUS`).
Bugs and drift throw: `LifecycleError` (a numbered state with no number), `ResolveError` (a node the renderer
doesn't know).

## Rules that live outside `src/domain`

Read these before you assume a rule is missing. When you change one, move it here instead of copying it.

| Rule | Where it lives today |
| --- | --- |
| Comment policy: length (`COMMENT_MAX`), the block must exist on a frozen version, who is notified; effects built inline | [actions/comments.ts](../server/actions/comments.ts) |
| Which states take comments (`draft`, `in_review`); `addComment` doesn't check the version's state | `versionTakesComments` in [thread-state.ts](../components/comments/thread-state.ts) |
| Who may be named on a stage (not yourself, not an Auditor, needs an active team role); re-notifying when a stage's rule changes | `unableToApprove`, `saveApprovalChain` in [actions/platform.ts](../server/actions/platform.ts) |
| The default chain (`DEFAULT_CHAIN`), the combined decide check (`decideCheck`), and `waitingStage`, which reads an out-of-range stage as the last one where `stageAt` returns null | [queries/review-shared.ts](../server/queries/review-shared.ts) |
| A new template's channels (wanted and allowed, else the first allowed) | `conformToContentType` in [templates/create.ts](../server/templates/create.ts) |
| A version publishes a channel only if the content type still allows it | [queries/consumer-api.ts](../server/queries/consumer-api.ts), [queries/integration.ts](../server/queries/integration.ts), [render-template.ts](../server/render/render-template.ts) |
| Which states a consumer can see (`RELEASED`: active, superseded, revoked) | [queries/consumer-api.ts](../server/queries/consumer-api.ts) |
| Who gets notices: consumers with a non-preview render in the last `CONSUMER_NOTICE_WINDOW_DAYS` (90) | `writeEffects` in [server/effects.ts](../server/effects.ts) |
| An Auditor can't be granted a team role through an access request | [actions/access.ts](../server/actions/access.ts) |
| Autosave: draft state only, rev compare-and-set, allowed channels, name 1–120 characters | [drafts/apply-patch.ts](../server/drafts/apply-patch.ts), [drafts/parse-patch.ts](../server/drafts/parse-patch.ts) |
| Note and reason limits (2,000), copied in three places | [actions/review.ts](../server/actions/review.ts), [decision-model.ts](../components/review/decision-model.ts), [validation.ts](../components/versions/validation.ts) |
| One open draft and one Active version per template | unique indexes in [ucomp.ts](../server/db/schema/ucomp.ts) |

## Copy these

| When you need to… | Copy | Notes |
| --- | --- | --- |
| Add a lifecycle transition | `startRevoke` or `setSunset` in [lifecycle.ts](lifecycle.ts) | Returns `Outcome<…>`; sentences in `REFUSALS`; tests in [lifecycle.test.ts](lifecycle.test.ts). |
| Add an access or settings rule | `requestAccess` in [access.ts](access.ts) | Limits live in [access-types.ts](access-types.ts), so the form ([request-access.tsx](../components/access/request-access.tsx)) and the server share them. |
| Apply deadlines from the clock | `sweepAccess` in [access.ts](access.ts) | Idempotent at the same `now`; effects carry the instant each deadline passed. |
| Add a permission | `Action` in [types.ts](types.ts), `TEAM_GRANTS` and `GUARDS` in [permissions.ts](permissions.ts) | Add the case to [permissions.test.ts](permissions.test.ts). |
| Word something for people | `describeChange` in [contract.ts](contract.ts) | Each case's sentence is shown in the doc comment. |
| Return a consumer API error | [render/errors.ts](render/errors.ts) | One builder per message; never echo a value. |

## Don't copy

- **Throwing for an expected outcome.** `editActive` throws `LifecycleError` for a version that isn't Active, and
  the `startDraft` and `createTemplate` actions throw `Error`. Return `Outcome<T>` with a sentence instead; throw
  only for bugs.
- **A third `Ok` / `Refused`.** Identical pairs exist in [lifecycle.ts](lifecycle.ts) and
  [access-types.ts](access-types.ts). Import one of them.
- **Dates through `render/errors`.** `lifecycle.ts`, `access.ts`, `activity.ts`, `audit.ts`, `consequences.ts`,
  and `golive/notices.ts` import `formatLongDate` from the re-export in `render/errors.ts`. Import from
  [dates.ts](dates.ts).
- **Local copies of small helpers.** "a, b and c" joins: `andList` in `copilot.ts` and `import.ts`, `listKeys` in
  `lifecycle.ts`; use `joinWithAnd` from [render/errors.ts](render/errors.ts). Count-and-noun `plural` in
  `import.ts`, `audit.ts`, and `golive/notices.ts`. `DAY_MS` in `access.ts`, `audit.ts`, `consequences.ts`, and
  `golive/usage.ts`. Two `utcDay`s with different results (a number in `lifecycle.ts`, a `YYYY-MM-DD` string in
  `golive/usage.ts`). Relative time as `ago` in `consequences.ts` and again in
  [queries/format.ts](../server/queries/format.ts). Numbers and plurals have no shared helper yet.
- **`STATUS_META.renders`** in [status.ts](status.ts). Nothing reads it; the render rule is `checkVersion` in
  [render/version-rules.ts](render/version-rules.ts).
- **The template name limit in `import.ts`** (`MAX_NAME_LENGTH = 120`) repeats the one in
  [drafts/parse-patch.ts](../server/drafts/parse-patch.ts).

## Testing

- Every rule file has a colocated `*.test.ts` (22 files). `dates.ts`, `status.ts`, the types files, and
  `render/index.ts` have none.
  Run `npx vitest run src/domain`; it takes under a second in the `node` environment.
- Tests pin time by passing `now`, never with fake timers: `const NOW = new Date("2026-10-04T12:00:00.000Z")`
  ([lifecycle.test.ts](lifecycle.test.ts)), or offsets from a fixed base (`at(days)` and `ago(days)` in
  [access.test.ts](access.test.ts)).
- There are no shared fixtures. Each file builds its inputs inline, with the seed's ids and names (`maya`,
  `jordan`, `coral-offers`). [copilot.test.ts](copilot.test.ts) uses inline snapshots.
- Gotchas: [platform-config.test.ts](platform-config.test.ts) reads `src/app` and fails if a top-level route
  segment is missing from `RESERVED_SLUGS`. [golive/json-schema.test.ts](golive/json-schema.test.ts) checks
  schemas with zod's `fromJSONSchema`. [schema-check.test.ts](../server/render/schema-check.test.ts) fails when
  the editor schema gains a node or mark that `render/resolve.ts` doesn't handle.
- Tests of the write side (effects, transactions, actions) run against a temporary database next to the server
  code: [effects.test.ts](../server/effects.test.ts), [actions/review.test.ts](../server/actions/review.test.ts),
  helpers in [review-fixtures.ts](../server/testing/review-fixtures.ts).
