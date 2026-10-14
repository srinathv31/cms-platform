# `src/domain/platform-config`: what Platform settings can change

Platform configuration as pure rules: teams, a content type's required sections, its channel rules, its approval
chain, and the business time zone. Every function takes `now` (the demo clock) and returns what to write and what to
record (`effects`); [server/actions/platform.ts](../../server/actions/platform.ts) applies both in one
transaction. Each Platform screen's live check is the function its transition refuses with, so the screen and the
server give the same answer. The contract each of the five save functions satisfies, `PlatformConfigDomain`, is in
[access-types.ts](../access-types.ts).

One file per kind of setting, split by concern ([decision 0043](../../../docs/decisions/0043-split-files-by-concern-not-by-line-count.md)).
There is no barrel: import each export from the file that defines it. They follow the [domain
rules](../README.md#rules).

## Files

In reading order: the limits and the refusal table first, then each kind of setting.

| File                                     | Holds                                                                                                                                                                                | Exports                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [limits.ts](limits.ts)                   | The limits settings hold to, the facts a message content type and a team carry that other rules read, the icons a team may pick, and the slugs the app's own routes use.             | `TEAM_NAME_MAX`, `TEAM_DESCRIPTION_MAX`, `SECTION_TITLE_MAX`, `STAGE_NAME_MAX`, `DEFAULT_SMS_MAX_PARTS`, `MessageTypeRules`, `TeamSenders`, `TEAM_ICONS`, `RESERVED_SLUGS` |
| [refusals.ts](refusals.ts)               | `PLATFORM_REFUSALS`, the whole refusal table of Platform settings: every code with its sentence, in one place.                                                                       | `PLATFORM_REFUSALS`                                                                                                                                                        |
| [effects.ts](effects.ts)                 | The audit row every settings change writes (`platform.config_changed`: the area and its facts, names as they were, never a sentence), and the sentence the Audit page words from it. | `configChanged`, `describeConfigChange`                                                                                                                                    |
| [teams.ts](teams.ts)                     | A team's slug from its name, the Create team form's live check, and `createTeam` with its first Team Admin.                                                                          | `createTeam`, `slugify`, `validateNewTeam`, `newTeamConsequences`, `cannotBeFirstTeamAdmin`                                                                                |
| [sections.ts](sections.ts)               | A document content type's required sections: the editor's live line, the update, and the sections that shape a new template's starter.                                               | `updateRequiredSections`, `validateRequiredSections`, `describeSectionsChange`, `removeSectionRefusal`, `sectionsRefusal`, `sectionKey`, `conformToSections`               |
| [channels.ts](channels.ts)               | Channel rules: whether a switch may flip, what turning one off stops, and the change.                                                                                                | `setChannelRule`, `channelRuleRefusal`, `channelOffConsequences`                                                                                                           |
| [approval-chains.ts](approval-chains.ts) | Approval chains: what makes a chain one somebody can approve, the Now / After cards, and the save.                                                                                   | `saveApprovalChain`, `validateChain`, `removeStageRefusal`, `describeChainChange`, `cannotApprove`, `approverProblem`, `ruleLabel`                                         |
| [time-zone.ts](time-zone.ts)             | The business time zone and what changing it does to nothing already set.                                                                                                             | `setBusinessZone`, `describeZoneChange`, `zoneChangeConsequences`                                                                                                          |
| [contract.ts](contract.ts)               | The compile-time check that the five save functions satisfy `PlatformConfigDomain`.                                                                                                  | `platformConfig`                                                                                                                                                           |

Tests sit beside each file. [fixtures.ts](fixtures.ts) holds the few inputs more than one test file builds.

## Rules

- **Teams.** A team's slug comes from its name; it must be new (slug and name, case-insensitive) and not a route the
  app owns (`RESERVED_SLUGS`; [teams.test.ts](teams.test.ts) reads `src/app` and `public/`, so a new top-level route
  fails it until its name is reserved, [decision 0071](../../../docs/decisions/0071-team-urls-stay-at-the-root-with-reserved-words.md)).
  The team starts with one member,
  its first Team Admin, who is never an Auditor.
- **Required sections shape only templates created afterwards.** A document carries its sections as headings with a
  `requiredKey`, and the editor protects those, so an existing template keeps the sections it was made with.
  Removing a section is allowed: nothing at submit checks sections, so no existing draft becomes unsubmittable.
- **A channel turned off stops rendering at once,** Active versions included: the consequence names how many. At
  least one channel stays on.
- **A content type is one family,** documents (PDF, Web, Email) or messages (Push, SMS), never both; a channel from
  the other family can't be turned on. Its family is the family of the channels it allows, and since one always stays
  on, it never changes.
  [decision 0034](../../../docs/decisions/0034-message-channels-families-and-the-fields-registry.md)
- **A message content type** has an SMS footer (brand and opt-out, printed on every SMS) and a part budget that
  submit checks against the "long" sample set (`DEFAULT_SMS_MAX_PARTS` unless set). A team has the app name its push
  notifications show and the short code its SMS come from.
- **A chain must be one somebody can approve.** Every stage is the Approver role, or a person who can approve and
  isn't on another stage. Nobody names themselves. A version in review goes through the stages it recorded at submit,
  so an edit never moves it; a new rule on one of its stages reaches it. A stage some in-review version still needs
  can't be removed.
  [decision 0008](../../../docs/decisions/0008-a-chain-must-be-approvable.md),
  [0015](../../../docs/decisions/0015-a-version-keeps-the-stages-it-was-submitted-with.md)
- **The business time zone** is one of `BUSINESS_ZONES` ([business-zone.ts](../business-zone.ts)). Changing it moves
  no sunset already set: only dates picked afterwards end at 00:00 in the new zone.
  [decision 0017](../../../docs/decisions/0017-a-sunset-date-ends-at-midnight-in-the-business-time-zone.md)
- **Screens render decisions.** [decision 0018](../../../docs/decisions/0018-settings-screens-render-decisions.md)

## Copy these

| To…                                                      | Copy                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| Validate a settings form live with the server's own rule | `validateChain` in [approval-chains.ts](approval-chains.ts). |
| Word what a settings change does before it is confirmed  | `describeSectionsChange` in [sections.ts](sections.ts).      |
