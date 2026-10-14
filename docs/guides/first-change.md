# Your first change: add a field end to end

This walks one small change through every layer a real change crosses: a team gets an optional **contact email**. An
admin types it in Create team, the Teams list shows it, and the database keeps it. Nothing here ships; it is the
route to follow, with the real files and commands, so that the next change you make is not a search.

Read [architecture.md](../architecture.md) first for the layers and [nextjs-primer.md](nextjs-primer.md) if the App
Router is new to you. The backend seam is described in [src/server/services](../../src/server/services/README.md): the
BFF (actions, read models, screens) asks a service interface, and an implementation behind it holds the data. Today
there are two implementations of every interface, the local one over SQLite and an in-memory fake, and one contract
suite runs against both ([decision 0068](../decisions/0068-the-bff-is-tested-against-a-fake-and-one-contract-suite.md)).
A field added to one and not the other fails there.

The team's `description` is the model to copy. It already travels the whole route, so
`grep -rn description src/server src/domain/platform-config src/components/settings/platform` is a starting list (it also finds unrelated uses of the word).

## Before you start

```bash
npm ci
npm run db:reset      # drops and reseeds data/ucomp.db; skip it in a working copy that holds a demo you want
npm test              # a green baseline
npm run dev           # Settings > Platform > Teams, as Riley (Platform Admin)
```

Let the compiler lead. Change the type first, run `npm run typecheck`, and fix what it names, in the order below.

## 1. The rule, in `src/domain`

A business rule goes in the domain, never in an action or a component. Whether an address is acceptable is one.

- [limits.ts](../../src/domain/platform-config/limits.ts) holds the limits: add `TEAM_CONTACT_EMAIL_MAX = 120`
  beside `TEAM_DESCRIPTION_MAX`.
- [refusals.ts](../../src/domain/platform-config/refusals.ts) holds the sentences, each with a stable code that no
  other refusal has (`refusals.test.ts` checks it). The code is the contract the backend keeps; the sentence is copy:

  ```ts
  contactEmail: refusal(
    "team_contact_email_invalid",
    `Enter an email address of at most ${TEAM_CONTACT_EMAIL_MAX} characters, or leave it empty.`,
  ),
  ```

- [teams.ts](../../src/domain/platform-config/teams.ts) holds `validateNewTeam`, which the Create team form runs as
  the admin types and `createTeam` refuses with. Tidy the input (`trim()`), refuse in a fixed order, and return the
  tidied value beside the problem. `createTeam` takes the new input and puts `contactEmail: string | null` on the
  `team` it returns. A rule takes facts and `now`, writes nothing, and returns a refusal or what to write.
- Test it in [teams.test.ts](../../src/domain/platform-config/teams.test.ts): the tidied value, the refusal, the empty
  case. Domain tests need no database.

## 2. The column and its migration

Add the column to `teams` in [schema/ucomp.ts](../../src/server/db/schema/ucomp.ts), nullable so existing rows need no
backfill, with a doc comment:

```ts
/** Who to write to about the team's content: an address, or null when none was given. */
contactEmail: text("contact_email"),
```

Then `npm run db:generate -- --name team_contact_email`. drizzle-kit writes the next `NNNN_team_contact_email.sql` and a
snapshot under `src/server/db/migrations/meta/`. Read the SQL (it should be one `ALTER TABLE`), and apply it with
`npm run db:migrate`. Nothing migrates at app start; tests migrate their temporary databases from the same folder.

## 3. The service interface

[services/platform.ts](../../src/server/services/platform.ts) says what each method promises, its input, its answer,
and its refusals in order. Add `contactEmail: string` to `createTeam`'s input, `team_contact_email_invalid` to the
refusal list in its comment (in the domain's order), and `contactEmail: string | null` to `PlatformTeamFacts`. What
crosses the seam is facts: no English but a refusal's reason.

## 4. Both implementations

- Local: [local/platform.ts](../../src/server/services/local/platform.ts) passes `input.contactEmail` to the domain's
  `createTeam` and inserts `outcome.team`; [local/platform-reads.ts](../../src/server/services/local/platform-reads.ts)
  adds `contactEmail: t.contactEmail` to the facts `teams()` answers. Everything else in `runCommand` (the permission,
  the clock, the transaction) is unchanged. Inside a transaction, read and write through `tx`.
- Fake: [fake/platform.ts](../../src/server/services/fake/platform.ts) makes the first change only, over its arrays
  (`createTeam` passes the field to the domain, which puts it on the row). The fake serves a read only where a
  contract case must observe a command with it, and `platform.teams` isn't one (it answers `notInFake`), so it needs
  nothing for the Teams list. If you wrote an `if` in both files, it belongs in the domain.

## 5. The seed

[seed/teams.ts](../../src/server/seed/teams.ts) builds the demo's team rows, and the fake loads the same rows from
the seed's fixture. Add `contactEmail` to the `TEAMS` entries, and to the `ctx.sink.teams.push` call; give one team
none, so the screen shows both cases. `npm run db:reset` (or the Demo pill's Reset) loads it into the dev database.

## 6. The contract cases

The suite fixes the behavior, in two files. [contract/platform.ts](../../src/server/services/contract/platform.ts)
holds the commands: add the new refusal to the case "refuses with the codes the interface lists, in its order, and
creates nothing". [contract/platform.test.ts](../../src/server/services/contract/platform.test.ts) runs it twice, on
the fake and on the local implementation. The reads live in [contract/settings.ts](../../src/server/services/contract/settings.ts),
which runs on the local implementation only: extend its `platform.teams` case with the seeded team that has an
address and the one that has none.

## 7. The BFF: action and read model

- [actions/platform.ts](../../src/server/actions/platform.ts): `CreateTeamInput` is the zod schema, and the function's
  input type lists the same fields. Add `contactEmail: z.string().max(500)`: a loose bound only, because the domain
  owns the real limit. The `serverAction` kit does the rest (context, parse, `services().platform.createTeam`,
  refresh). Test the parse and the refresh in [actions/platform.test.ts](../../src/server/actions/platform.test.ts),
  which runs against the fake.
- [queries/access-models.ts](../../src/server/queries/access-models.ts) holds the screens' types: add the field to
  `TeamRow` and to `PlatformActions.createTeam`. `teamsSection` in
  [queries/platform.ts](../../src/server/queries/platform.ts) spreads each team's facts, so it needs no change; a read
  model decides nothing, it words and lays out.

## 8. The screen

[settings/platform/teams.tsx](../../src/components/settings/platform/teams.tsx) is a client component. In
`CreateTeam`, add state for the field, pass it to `validateNewTeam` so the live check sees it, pass the tidied
`check.contactEmail` to `createTeam`, and render an `Input` beside Description. In the row, show the address under the
description when there is one. The UI rules in [AGENTS.md](../../AGENTS.md) apply: tokens only, no hint text, one
primary button, and an unavailable control shown disabled with its reason. The form shows the domain's sentence, so
it never compares one. Check the screen against the [UI checklist](../reference/ui-checklist.md), and extend
[settings-decided.test.tsx](../../src/components/settings/settings-decided.test.tsx) if the form's behavior changed.

## 9. The docs

Docs change in the same change as the code. Add the row to the `teams` table in
[reference/data-model.md](../reference/data-model.md), and a line to the Teams entry in the
[platform-config README](../../src/domain/platform-config/README.md). A choice someone might question later (why
optional, why this limit) gets a record in [decisions/](../decisions/README.md).

## 10. Check it

```bash
npm run typecheck && npm run lint && npm test
npm run docs:check && npm run format:check   # npm run format fixes the second
npm run build                                # you changed a screen a server component reads
```

`npm run e2e` is the slow check: it needs `npm run build` first and runs against its own databases, never the demo's
([e2e/README.md](../../e2e/README.md)). No spec covers Create team, so you don't need it here. For a change to a screen
a spec does cover, run that spec alone: `E2E_WORKERS=1 npx playwright test e2e/<spec>.spec.ts`.

## What the route taught

- A change starts at a rule in `src/domain` and ends at a pixel. The layers in between only pass facts along.
- The compiler and the contract suite find what you forgot: the types name every consumer, and the suite fails on an
  implementation that drifted.
- Where a change is only a field, almost nothing is new code. Copy the nearest existing field's route.
- Some rules are enforced by lint ([AGENTS.md](../../AGENTS.md)): the database only behind a
  service, the clock only in the backend, a decision only in the domain. When lint stops you, move the code, don't
  suppress the rule.
