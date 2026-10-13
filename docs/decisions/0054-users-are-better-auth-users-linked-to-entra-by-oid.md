# 0054. Users are Better Auth's users, linked to Entra ID by `oid`, in the one database

Status: Accepted
Date: 2026-10-12

## Context

`users.id` is a readable handle (`maya`, `src/server/db/schema/ucomp.ts`), and the persona cookie holds it
(`getViewer` in `src/server/viewer.ts`). Nothing derives a user id from a name, but user ids also sit inside JSON
with no foreign key: `versions.writers`, `versions.revoke`, `approval_stages.approver_rule` and audit `details`.

Real sign-in is planned as Better Auth in the Next.js BFF with Entra ID
([S2](../handoff-review.md#s2--high-identity-fails-open-to-the-default-persona)). After it, a
person's stable identifier in Entra is the object id, the `oid` claim (a GUID per tenant). If `users.id` had to become
the `oid` later, every foreign key and every JSON array of user ids would be re-keyed.

## Decision

- **Better Auth owns sign-in and sessions**, in the BFF.
- **`users.id` is Better Auth's generated id**, an opaque string; demo personas keep their literal ids (`maya`). No
  code derives an id from a name, an email or a UPN.
- **The link to Entra is Better Auth's `account` row** (provider `microsoft`). `users.entra_oid` holds the id token's
  `oid` claim, filled through the provider's `mapProfileToUser`, with a filtered unique index (unique over the rows
  `WHERE entra_oid IS NOT NULL`, so personas without one don't collide).
- **Better Auth's tables live in the same MSSQL database as the Java API** (Better Auth's Kysely MSSQL adapter), and
  there is one users table for both sides.
- **User ids leave JSON** where they are references, so foreign keys cover them
  ([0061](0061-documents-stay-json-and-references-become-rows.md)).
- **Open, for the sign-in work:** how Better Auth's `user` and `account` tables map onto the app's `users` table, and
  whether Better Auth's Microsoft account id is `sub` (per app) or `oid` (per tenant).

## Alternatives considered

- **`users.id` is the `oid`.** Ties every key to one tenant and one identity provider, and Better Auth generates its
  own ids anyway.
- **Readable handles from the email or UPN.** A UPN changes with a name or a domain.
- **A separate sign-in database with its own user table.** Two user tables to keep in step, joined by id across
  databases.

## Consequences

- **Node now:** nothing. User ids are already opaque strings to the code; the audit filter's person pattern
  (`src/domain/audit.ts`) accepts a generated id.
- **Java side:** the `users` table carries `entra_oid` and Better Auth's columns; the Java API reads users from the
  same table the BFF signs people in against. How the BFF tells Java who is calling is decided with the sign-in work
  ([0070](0070-rules-and-permission-checks-sit-behind-the-service-interfaces.md)).
- People named on an approval stage before their first sign-in need a row first (a Graph lookup or provisioning);
  the sign-in work decides how.
