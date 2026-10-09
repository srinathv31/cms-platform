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
- **A refusal is a code and a sentence.** Every refusal is an entry in a table (`REASONS`, `REFUSALS`,
  `STAGE_REFUSALS`, `COMMENT_REFUSALS`, `ACCESS_REFUSALS`, `PLATFORM_REFUSALS`, `REQUEST_REFUSALS`) built with
  `refusal(code, sentence)` from [refusals.ts](refusals.ts). The code is a snake_case identifier no other entry has;
  it is what code branches on and what a ported backend returns. The sentence is shown as is and can be reworded
  freely: nothing compares it ([decision 0025](../../docs/decisions/0025-refusals-carry-stable-codes.md)).
  `IMPORT_REFUSALS` keeps its own codes, its keys.
- Domain inputs use `Date`; read models that cross into client components use ISO strings.
- Messages and notice payloads never contain a submitted variable value.

## Layout

| Area | Path | What it holds |
| --- | --- | --- |
| Vocabulary | [types.ts](types.ts) | `VersionState`, `Channel`, roles, `Viewer`, the permission `Action` list, `DraftPatch`. Re-exports the editor model's `Variable` and `ContractChange`. |
| | [status.ts](status.ts) | Label, tone, and icon for each version state. |
| | [review-types.ts](review-types.ts), [access-types.ts](access-types.ts), [golive-types.ts](golive-types.ts), [import-types.ts](import-types.ts), [render/types.ts](render/types.ts) | Each area's contract: inputs, effects, limits, read models. `golive-types.ts` re-exports `@/contracts/api-v1` and type-checks the render types against it (`_DriftChecks`). |
| Lifecycle | [lifecycle.ts](lifecycle.ts) | Every version transition: `createDraft`, `planDraftStart`, `editLatest`, `submit`, `requestChanges`, `approve`, `setSunset`, and the two-person revoke. Also `contractBaseline`, the version a draft's contract is compared with; `sunsetPassed`, the one test of a passed sunset; and `sweepSunsets`, its audit record. |
| Review | [approval-chain.ts](approval-chain.ts) | Stage order, the stages a version records at submit and goes through (`recordStages`, `ownStages`, `stageOf`), the default chain (`DEFAULT_CHAIN`, stage id `default`), who approved a stage of this round (`approvedThisRound`), whose stage it is (`canActOnStage`), who a stage notifies, the stepper. |
| | [redline.ts](redline.ts) | The diff between two versions' documents, and their rename (`nameChange`), for the review screen and Compare. |
| | [comments.ts](comments.ts) | Review comments: which versions take them (`takesComments`), who may start a thread (`canComment`) and act on one (`canActOnThread`), the text's limits, and `addComment`, `reply`, `resolveThread`, `reopenThread` with who is notified ([decision 0010](../../docs/decisions/0010-comments-are-answered-where-they-show.md)). |
| Refusals | [refusals.ts](refusals.ts) | `Refusal`, `Refused` (`{ ok: false, code, reason }`), `refusal()` to build a table entry, `refuse()`, `RefusalCode` (every table's codes), and `REQUEST_REFUSALS`: what the server refuses before a rule runs (input, a record that's gone, a compare-and-set that missed). |
| Access and audit | [permissions.ts](permissions.ts) | `can`, `assertCan`, `REASONS`, and the team switcher's spaces. |
| | [access.ts](access.ts) | Access requests, members, recertification, inactivity, and the clock-driven `sweepAccess`. Also what the Team settings sections say: each strip's line (`memberConsequences`, `requestConsequences`, `startRecertConsequence`), a review's footnote and settled rows (`recertFootnote`, `recertItemOutcome`), and the checks the forms run live (`describeRoleChange`, `validateDecisionNote`). |
| | [platform-config.ts](platform-config.ts) | Teams, required sections, channel rules, approval chains (`validateChain`: what makes a chain one somebody can approve), the business time zone. Each Platform screen's live check is the function its transition refuses with: `validateNewTeam`, `describeSectionsChange`, `channelRuleRefusal`, `removeStageRefusal`, `describeZoneChange`. |
| | [audit.ts](audit.ts), [activity.ts](activity.ts) | One sentence per audit event, the Audit page's filters and CSV, notification fallbacks. |
| Contract and consequences | [contract.ts](contract.ts) | One sentence per contract change: "v2 adds required `annual_fee` (Currency)." `isContractChange` reads a stored change back with every field of its kind. |
| | [consequences.ts](consequences.ts) | Who an approve, sunset, or revoke affects, from render usage. |
| Consumer API and usage | [golive/](golive/) | `/api/v1` query parsing and errors (`api-errors.ts`), the paging cursors of search and notices and the search order (`cursor.ts`), published contract diffs (`contract-diff.ts`), the JSON Schema for `values` (`json-schema.ts`), notices as served (`notices.ts`), the integration panel's samples (`samples.ts`), and the Usage numbers (`usage.ts`). |
| Render rules | [render/](render/) | Which versions render (`version-rules.ts`), value checks (`validate.ts`), TipTap JSON to `RenderDoc` (`resolve.ts`), JSON numbers kept as their exact source text (`json-number-text.ts`), and the exact error sentences (`errors.ts`). Specified in [docs/render-spec.md](../../docs/render-spec.md). [render/index.ts](render/index.ts) is the only barrel here. |
| Import and Copilot | [import.ts](import.ts), [copilot.ts](copilot.ts) | What an imported file becomes as a draft; the prompt an author copies into Copilot. |
| ⌘K palette | [palette.ts](palette.ts) | The palette's one matching rule (`rankByQuery`: every word, name first), and which templates a space lists for a search (`paletteTemplates`: Recent and a first page at rest, the best matches while searching). The server searches with it; the browser ranks the palette's own rows with it ([decision 0024](../../docs/decisions/0024-the-palette-searches-on-the-server.md)). Its types are in [import-types.ts](import-types.ts). |
| Dates, numbers, words | [dates.ts](dates.ts) | The one way to write a date or time (always UTC; short forms add the year only outside the demo clock's year; a calendar day `YYYY-MM-DD` formats as itself), to count days (`daysBetween`, calendar days; `utcDay`, `addDays`, `isCalendarDay`, `DAY_MS`), and to say how long ago (`formatAgo`). See [Days and "how long ago"](#days-and-how-long-ago). |
| | [numbers.ts](numbers.ts), [plural.ts](plural.ts) | Counts as people read them (`formatCount` "1,204", `compactCount` "1.2k"); a count with its noun (`plural` "3 versions", `pluralWord`, `pluralName` "Policies"). A variable's value is not formatted here: it prints as sent (`formatValue` in [variables.ts](../editor/model/variables.ts)). |
| | [business-zone.ts](business-zone.ts) | The business time zone and what a sunset date means in it: `sunsetInstant`, `sunsetDay`, `todayIn`, `daysUntilSunset`, the zones on offer (`BUSINESS_ZONES`, `DEFAULT_BUSINESS_ZONE`). Only `Intl`. See [The sunset rule](#the-sunset-rule). |

## Vocabulary

| Term | Meaning here | Where |
| --- | --- | --- |
| Template | A document consumers render, with a stable id like `UC-4F7K2Q`. Belongs to one team and one content type. | `templates` in [ucomp.ts](../server/db/schema/ucomp.ts) |
| Version | One snapshot of a template: body (TipTap JSON), variables, channels, email fields, sample sets. `number` is null while it is a draft; `submit` sets it to the highest number + 1, and it never changes. | `VersionSnapshot`, `DraftFields` |
| Version states | `draft`, `in_review`, `changes_requested`, `active`, `superseded`, `revoked` (`VERSION_STATES`). The database allows one open draft and one Active version per template. | [types.ts](types.ts), [status.ts](status.ts) |
| Sunset | A date on a Superseded version. It ends at 00:00 on that day in the business time zone, and from then on consumer renders fail with `version_sunset`. Once it has passed it is final: nothing moves or clears it, and the clock-driven sweep records it (`version.sunset_passed`). Not a state. | `setSunset`, `sunsetPassed`, `sweepSunsets`, `checkVersion` |
| Revoke pending | An Active or Superseded version whose `revoke` record has no `confirmedAt`. Not a state: it renders until a different approver confirms. | `revokePending` |
| Content type | Platform configuration a template follows: required sections, allowed channels, approval chain. | [platform-config.ts](platform-config.ts) |
| Required section | `{ key, title }`: a heading with `attrs.requiredKey` that the editor protects. Shapes new templates only; `submit` doesn't check sections. | `conformToSections` |
| Variable | `{ id?, key, label, type, required, sample }`, shown as a chip. Keys are snake_case and unique per template. `id` keeps a variable the same variable across key renames and versions; without one, the key is its identity ([decision 0022](../../docs/decisions/0022-a-variable-keeps-its-identity-across-renames.md)). | `Variable`, `identityOf` |
| Consumer contract | A version's variable list: what a consumer sends to render it. | [contract.ts](contract.ts), [golive/json-schema.ts](golive/json-schema.ts) |
| Contract baseline | The version a draft's variable list is compared with: the newest one that still renders. The Active version; with none (it was revoked), the highest-numbered Superseded version whose sunset hasn't passed; null when nothing renders, as for a first version ([decision 0007](../../docs/decisions/0009-correct-a-revoked-version-from-its-content.md)). | `contractBaseline` |
| Breaking change | A change that breaks consumers of the baseline: a required variable added, a variable removed, a key renamed, a type changed, an optional one made required. `submit` stores the diff as `contractChanges`. A renamed key is one `key_renamed` change (`from`, `to`), paired by the variable's id; `ContractChange` is a union, one member per kind. | `diffVariables`, `isBreaking` |
| Consumer | A registered system (`consumers` table; the simulator plays `coral`) that calls `/api/v1` with `X-Consumer-Id` and pins a version number. It receives notices: `new_version`, `sunset_scheduled`, `revoked`. | [golive/](golive/) |
| Channel | `pdf`, `web`, or `email`. The content type allows it; the version turns it on. New templates start with `DEFAULT_CHANNELS` (`pdf`, `web`). | `CHANNELS` |
| Approval chain | Ordered `ApprovalStage`s per content type, stored as configuration, each with a stable id. A stage's rule names a team role or one user. | [approval-chain.ts](approval-chain.ts) |
| A version's stages | The chain's stage ids and names, recorded on the version at submit (`VersionStage[]`). It goes through those whatever the chain becomes; each stage's rule is read from the chain by id when the version reaches it. `currentStage` is a position in them. A stage an in-review version still needs can't be removed ([decision 0015](../../docs/decisions/0015-a-version-keeps-the-stages-it-was-submitted-with.md)). | `recordStages`, `stageOf`, `versionsNeeding` |
| Viewer, persona | `Viewer` is who is acting, built per request from the `ucomp_persona` cookie ([viewer.ts](../server/viewer.ts)). Personas are seeded people ([people.ts](../server/seed/people.ts)). | `Viewer` |
| Roles | Team roles `viewer`, `author`, `approver`, `team_admin`, held through a membership that is `active`, `suspended`, or `lapsed`. Platform roles `platform_admin` and `auditor` (read-only everywhere). | [types.ts](types.ts) |
| `can()` | The one permission check: role grants, then guards (maker-checker, two-person revoke, your own access request, your own access). | [permissions.ts](permissions.ts) |
| Writers | Everyone who wrote a version: whoever started its draft, everyone whose autosave landed, the submitter, and for a draft a change request opened, the writers of the version sent back. A draft that Edit starts (from the Active or Revoked version) starts afresh. Maker-checker bars all of them from deciding it, and a team-role stage doesn't ask them to review it ([decision 0007](../../docs/decisions/0007-maker-checker-covers-every-writer.md)). | `DraftFields.writers`, `withWriter`, `makerCheckerRefusal`, `stageRecipients` |
| Effects | Side records a rule asks for: audit events, notifications, and consumer notices (`LifecycleEffect`), or audit events and notifications (`AccessEffect`). | [review-types.ts](review-types.ts), [access-types.ts](access-types.ts) |

The lifecycle, as [lifecycle.ts](lifecycle.ts) implements it:

```text
createDraft | editLatest (latest Active or Revoked) | requestChanges   → draft
draft        submit                                       → in_review (numbered, its stages recorded)
in_review    approve, earlier of its stages               → in_review, currentStage + 1
in_review    approve, last of its stages                  → active; the previous active, if any → superseded
in_review    requestChanges                               → changes_requested, plus a new draft
superseded   setSunset, until the sunset has passed       → superseded with sunsetAt
superseded   the clock passes sunsetAt                    → superseded; renders stop (sweepSunsets records it)
active | superseded   startRevoke, then confirmRevoke     → revoked   (cancelRevoke withdraws)
```

The template's name is a version field like the body (`name` on `VersionSnapshot` and `DraftFields`): a new draft
copies it, the author renames the draft, and it freezes at submit, so a rename reaches customers only when its
version goes live ([decision 0016](../../docs/decisions/0016-the-name-is-versioned.md)). `nameChange` in
[redline.ts](redline.ts) is the rename the review, the submit dialog and Compare show.

## How it works

**Transitions take facts and return values.** A transition gets everything as input: the rows it reads, the
actor, ids, and `now`. It returns either a refusal, `{ ok: false, code, reason }`, whose `code` is stable and whose
`reason` is the sentence the person reads, or what to write plus `effects`. Lifecycle transitions return `changes`, plus `approval`,
`newDraft`, `reasonComment`, or `previous` when there is more than one row to write. Access and platform functions
name their rows instead (`request`, `membership`, `recert`, `requiredSections`). Nothing is written here. The
server writes it all in one transaction with `inTransaction` from [server/effects.ts](../server/effects.ts), which
retries `SQLITE_BUSY`.
`writeEffects` (same file) writes `LifecycleEffect`s and decides who receives them; `writeAccessEffects` and
`applyMembershipChange` in [server/access-effects.ts](../server/access-effects.ts) do the same for access. The
caller in `approveVersion` ([actions/review.ts](../server/actions/review.ts)), shortened:

```ts
const at = await now();                                 // the demo clock, read once
const result = await transact(async (tx) => {           // inTransaction; a refusal becomes { ok: false, code, reason }
  const version = await loadVersion(tx, found, number); // re-read inside the transaction
  const outcome = approve({ version, chain, actorId: viewer.userId, now: at, /* … */ });
  if (!outcome.ok) refuse(outcome);                     // the domain's refusal; nothing is written
  await updateVersion(tx, version, { state: outcome.changes.state, /* … */ }, at, REFUSALS.notInReview);
  await writeEffects(tx, outcome.effects, effectContext(viewer, found, version.id, at));
  return { ok: true, wentLive: outcome.wentLive, number: version.number! };
});
```

**Permissions are a separate check.** Server actions call `assertCan` before the transition and turn a
`PermissionError` into a returned refusal. Transitions repeat only the guards they can see in their facts
(`approve` and `requestChanges` ask `makerCheckerRefusal`, as the `version.decide` guard does, and refuse the
submitter with `REASONS.ownVersion` and any other writer with `REASONS.wroteVersion`). Whether a stage is yours is `canActOnStage`, not
`can`. Read models carry `PermissionResult`s for the UI, such as `ReviewScreenData.can`.

**Three result shapes, by audience.** People get `{ ok: false, code, reason }`. Consumer API callers get
`{ ok: false, error }`, where `error` has a code that maps to a status (`RENDER_ERROR_STATUS`, `API_ERROR_STATUS`).
Bugs and drift throw: `LifecycleError` (a numbered state with no number), `ResolveError` (a node the renderer
doesn't know).

## The sunset rule

A sunset date is a calendar day (`YYYY-MM-DD`). It ends at 00:00 on that day in the platform's business time
zone: `settings.business_zone`, chosen in Settings > Platform > Time zone from the US zones and UTC, and
`America/New_York` until someone changes it ([decision 0017](../../docs/decisions/0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md)).
Every other date stays UTC. In [business-zone.ts](business-zone.ts):

- `sunsetInstant(day, zone)` is the instant stored in `versions.sunset_at`: "2027-03-01" in New York is
  `2027-03-01T05:00:00.000Z`. When the zone's clocks skip midnight, the day starts at the first instant after the
  gap; when they show it twice, at the earlier one. In Java: `LocalDate.parse(day).atStartOfDay(zone).toInstant()`.
- `sunsetDay(instant, zone)` is the day people read (the badge, the timeline, the 410 message). In Java:
  `instant.atZone(zone).toLocalDate()`.
- "After today" (`isAfterToday` in [lifecycle.ts](lifecycle.ts)) compares the day with `todayIn(now, zone)`, so at
  23:30 Eastern the next day is still a valid date. The picker's today is the same day (`SunsetCalendar` in
  [review-types.ts](review-types.ts)).
- Passed is an instant comparison, `sunsetPassed` in [lifecycle.ts](lifecycle.ts), and the only one: the render
  rule, the consumer API, the Versions and Usage screens, the count of pending sunsets and the sweep all ask it.
- `sweepSunsets` records each passed sunset once, as the system: a `version.sunset_passed` audit row dated at the
  sunset, naming its day in the zone at the sweep (`SunsetPassedDetails`). A version revoked before its sunset isn't
  recorded: its renders had already stopped. No consumer notice and no notification: both went out when the sunset
  was set ([decision 0026](../../docs/decisions/0026-a-passed-sunset-is-recorded-by-a-sweep.md)).
- Changing the zone moves no sunset already set. Audit rows and notices record the day picked and the zone
  (`sunsetDay`, `zone`); `recordedSunsetDay` reads them, and reads a record from before the rule as the UTC date
  of its `sunsetAt`, which is what it meant then.

`setSunset` and `approve` take the day and the zone and return the instant, so the rule has one home.

## Days and "how long ago"

"Today", "yesterday" and "3 days ago" count calendar days, never 24-hour periods, and the days are UTC days: the
days every date on screen shows ([decision 0028](../../docs/decisions/0028-today-and-yesterday-are-utc-calendar-days.md)).
A render at 23:00 is "yesterday" at 01:00 on every screen. In [dates.ts](dates.ts):

- `daysBetween(from, to)` is the only day count. An instant counts as its UTC day; a `YYYY-MM-DD` day as itself, so
  a sunset counts in the business time zone by passing that zone's days (`daysUntilSunset`).
- `formatAgo(value, now, options)` is the only "how long ago": "just now", "12 minutes ago", "3 hours ago" earlier
  today, then "yesterday", "4 days ago", and from 30 days "2 months ago". `precision: "day"` reads "today" for all
  of today and keeps counting days ("95 days ago"); `dateFrom` switches to the date; `capitalize` is for a label
  that stands alone ("Yesterday").
- `DAY_MS` is for elapsed windows and deadlines ("the last 30 days", "suspended after 120 days"), never for which
  day something happened.

## Rules that live outside `src/domain`

Read these before you assume a rule is missing. When you change one, move it here instead of copying it.

| Rule | Where it lives today |
| --- | --- |
| Re-notifying the people a stage names when its rule changes | `saveApprovalChain` in [actions/platform.ts](../server/actions/platform.ts) |
| The combined decide check (`decideCheck`) | [queries/review-shared.ts](../server/queries/review-shared.ts) |
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
| Add a lifecycle transition | `startRevoke` or `setSunset` in [lifecycle.ts](lifecycle.ts) | Returns `Outcome<…>`; refusals in `REFUSALS`; tests in [lifecycle.test.ts](lifecycle.test.ts). |
| Add a refusal | `REFUSALS` in [lifecycle.ts](lifecycle.ts) | `refusal("summary_stale", "This draft changed after this summary was made.")` in its area's table, with a code no other entry has ([refusals.test.ts](refusals.test.ts) checks); `refusal("last_admin", (team: string) => …)` when the sentence names something. Return it with `refuse(…)`. |
| Add an access or settings rule | `requestAccess` in [access.ts](access.ts) | Limits live in [access-types.ts](access-types.ts), so the form ([request-access.tsx](../components/access/request-access.tsx)) and the server share them. |
| Validate a settings form live with the server's own rule | `validateChain` in [platform-config.ts](platform-config.ts) | Takes the facts (people's access, the actor, the saved chain) and returns each problem with the stage and field it's about. The read model carries the facts; [approval-chains.tsx](../components/settings/platform/approval-chains.tsx) shows each problem at its field and disables Save with the first; `saveApprovalChain` refuses with the first. |
| Say what a settings action does before it's confirmed | `memberConsequences` in [access.ts](access.ts) | The read model returns the lines as `consequences` beside `can`, dated with the demo clock by the function that sets the date (`inactivity`, `recertDueAt`); the screen only renders them ([decision 0018](../../docs/decisions/0018-settings-screens-render-decisions.md)). A line that depends on what's being typed is a pure function the screen calls, like `describeSectionsChange` in [platform-config.ts](platform-config.ts). |
| Apply deadlines from the clock | `sweepAccess` in [access.ts](access.ts), `sweepSunsets` in [lifecycle.ts](lifecycle.ts) | Idempotent: each reads what's already done (a membership's status, `passedRecorded`), so running it again writes nothing. Effects carry the instant each deadline passed. |
| Add a permission | `Action` in [types.ts](types.ts), `TEAM_GRANTS` and `GUARDS` in [permissions.ts](permissions.ts) | Add the case to [permissions.test.ts](permissions.test.ts). |
| Word something for people | `describeChange` in [contract.ts](contract.ts) | Each case's sentence is shown in the doc comment. |
| Return a consumer API error | [render/errors.ts](render/errors.ts) | One builder per message; never echo a value. |

## Don't copy

- **Throwing for an expected outcome.** `editLatest` throws `LifecycleError` for a version that isn't Active or
  Revoked, and the `startDraft` and `createTemplate` actions throw `Error`. Return `Outcome<T>` with a sentence
  instead; throw only for bugs.
- **A third `Ok` / `Refused`.** `Refused` is [refusals.ts](refusals.ts)'s, which [lifecycle.ts](lifecycle.ts) and
  [access-types.ts](access-types.ts) re-export; `Ok` is declared in both. Import them.
- **Local copies of small helpers.** "a, b and c" joins: `andList` in `copilot.ts` and `import.ts`, `listKeys` in
  `lifecycle.ts`; use `joinWithAnd` from [render/errors.ts](render/errors.ts).
- **`STATUS_META.renders`** in [status.ts](status.ts). Nothing reads it; the render rule is `checkVersion` in
  [render/version-rules.ts](render/version-rules.ts).
- **The template name limit in `import.ts`** (`MAX_NAME_LENGTH = 120`) repeats the one in
  [drafts/parse-patch.ts](../server/drafts/parse-patch.ts).

## Testing

- Every rule file has a colocated `*.test.ts` (30 files). `status.ts`, the types files, and `render/index.ts`
  have none.
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
