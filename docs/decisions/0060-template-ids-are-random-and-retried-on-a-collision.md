# 0060. Template ids are random and retried on a collision; a readable id would be its own column

Status: Accepted
Date: 2026-10-12

## Context

`newTemplateId()` draws `UC-` plus six Crockford base32 characters from `crypto.getRandomValues`
(`src/server/ids.ts`), about 1.07 billion values. `freshTemplateId` (`src/server/templates/create.ts`) reads up to four
times to dodge a collision before the caller inserts: safe only because SQLite has one writer, and not even then for
import, which runs the check outside its transaction. Collisions follow the birthday bound: about a 5% chance of one by
10,000 templates. On MSSQL two concurrent creates can both pass the read, and the primary key then refuses one with a 500.

The id is the consumer's key (`/api/v1` paths, notices, the JSON Schema `$id`) and is printed on every customer PDF
(the footer label and `/Subject`, [render spec](../render-spec.md) §10). Its `UC-` prefix is left from the product's
old name ([0023](0023-the-email-preview-sends-from-stencil.md)). Every other id is a prefix plus ten random
characters (about 10^15 values), never checked: at 60 million `render_log` rows (a year of monthly statements for five
million customers) about 1.6 duplicates are expected, and a duplicate key fails the render after its work is done.

## Decision

- **`templates.id` stays the random `UC-` id and the primary key.** It is immutable and already every foreign key.
- **Insert optimistically; on a unique violation of `templates.id`, retry the whole transaction with a new id**, at
  most three times. A key violation makes a Spring transaction rollback-only, so the unit is retried, not the statement.
- **A readable id, if the product owner defines one, is a separate column with its own unique index**: never the
  primary key, and never the `/api/v1` `templateId` unless the product owner wants consumers to use it. Whether
  customer PDFs print it is a render spec change with golden updates. No column is reserved now: its uniqueness
  (global or per team) depends on its format.
- **Append-only, high-volume tables cluster on an ever-increasing `seq BIGINT IDENTITY`** (`render_log`,
  `audit_events`, `notifications`, `consumer_notices`); a string id they keep is a nonclustered unique key.
- **`templateId` is published as an opaque string**: a maximum length and examples, no pattern.
- **Open, for the product owner:** what makes an id readable, and whether the `UC-` prefix stays.

## Alternatives considered

- **Read, then insert** (today). Not safe with more than one writer.
- **A `SEQUENCE` in the same alphabet.** No collisions, but sequential ids can be enumerated and reveal volume; a
  scrambling permutation fixes that with more moving parts.
- **An opaque integer key plus the business id.** Every foreign key becomes the integer, and the API maps it back;
  worth it only if DBA standards demand integer clustered keys.

## Consequences

- **Node now:** optional; lane F may replace the `freshTemplateId` loop with the retry. Lane J's brief publishes
  `templateId` as opaque.
- **Java side:** a retry around the create service; the identity `seq` columns, which also order rows that share an
  instant ([0063](0063-instants-are-utc-datetime2-ordered-by-at-and-seq.md)).
- The readable id and the prefix are product owner questions in `to-do.md`.
