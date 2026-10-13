# 0061. Documents stay JSON; references and fixed records become rows and columns

Status: Accepted
Date: 2026-10-12

## Context

The schema has sixteen JSON columns, all `text` typed only in TypeScript (`src/server/db/schema/ucomp.ts`), none
queried with JSON functions ([M-9 of the October 12 review](../quality-review-2026-10-12.md); the
[data model report](../quality-review-2026-10-12/reports/data-model.md) maps every one). Seven are shaped like
relations. A version row today, abridged:

```json
{
  "writers": ["maya", "priya"],
  "stages": [
    { "id": "st_…", "name": "Legal" },
    { "id": "st_…", "name": "Compliance" }
  ],
  "revoke": {
    "reason": "Wrong intro APR.",
    "startedBy": "alex",
    "startedAt": "2027-01-04T15:00:00.000Z",
    "confirmedBy": "jordan",
    "confirmedAt": "2027-01-04T16:10:00.000Z"
  }
}
```

`writers` is the maker-checker fact ([0007](0007-maker-checker-covers-every-writer.md)); `stages` is the chain frozen
at submit ([0015](0015-a-version-keeps-the-stages-it-was-submitted-with.md)); the revoke record holds two user ids
and its dates as ISO strings while the row's other dates are integers. User ids inside JSON escape every foreign key,
so an approver rule can name a user who has left, and nothing in the database stops the starter of a revoke from
confirming it. Once JPA entities exist, moving a field out of JSON is a migration with a backfill.

## Decision

| Column                                                                            | Becomes                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `versions.body`, `channel_fields`, `variables`, `sample_sets`, `contract_changes` | JSON: documents and the contract snapshot frozen at submit                                                                                                                             |
| `content_types.required_sections`                                                 | JSON                                                                                                                                                                                   |
| `audit_events.details`, `consumer_notices.payload`                                | JSON, one shape per kind ([0064](0064-payloads-are-facts-with-one-shape-per-event.md))                                                                                                 |
| `versions.writers`                                                                | Table `version_writers(version_id, user_id)`, both foreign keys                                                                                                                        |
| `versions.stages`                                                                 | Table `version_stages(version_id, position, stage_id, name)`                                                                                                                           |
| `versions.revoke`                                                                 | Columns `revoke_reason`, `revoke_started_by`, `revoke_started_at`, `revoke_confirmed_by`, `revoke_confirmed_at`; user foreign keys; `CHECK (revoke_confirmed_by <> revoke_started_by)` |
| `approval_stages.approver_rule`                                                   | Columns `rule_kind`, `rule_role`, `rule_user_id` (foreign key) with a CHECK that the kind's column is set                                                                              |
| `approvals.sample_sets_seen`                                                      | A table or JSON, the Java team's choice (low stakes)                                                                                                                                   |
| `versions.channels`, `content_types.allowed_channels`                             | JSON with a CHECK on the values, or a child table                                                                                                                                      |
| `settings.value`                                                                  | Split ([0062](0062-invariants-hold-in-the-database-not-in-one-writer.md))                                                                                                              |

`versions` stays one row per round ([0033](0033-a-resubmission-is-the-next-round-of-the-same-version.md)); this
narrows it by about six columns and doesn't split rounds.

## Alternatives considered

- **Everything JSON** (`NVARCHAR(MAX)` with `ISJSON`, Hibernate's JSON type). The fastest port, opaque to SQL and to
  foreign keys.
- **Normalize everything**, variables and sample sets too. The contract snapshot is a document that never changes
  after submit; tables would add joins and no rule.

## Consequences

- **Node now:** nothing. Schema changes wait for the Java side, and lane F's service interfaces hide the storage
  shape, so the local Drizzle implementation keeps its JSON.
- **Java side:** the tables and columns above in Flyway; every user id under a foreign key, which
  [0054](0054-users-are-better-auth-users-linked-to-entra-by-oid.md)'s ids rely on; "what did Maya write" and "which
  versions wait on stage X" become indexed queries. Whether JSON columns use Azure SQL's native `json` type or
  `NVARCHAR(MAX)` with `ISJSON` is the DBA's standard.
