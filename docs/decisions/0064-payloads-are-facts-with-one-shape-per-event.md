# 0064. Audit and notice payloads are facts, with one shape per event

Status: Accepted
Date: 2026-10-12

## Context

`audit_events.details` and `consumer_notices.payload` are `Record<string, unknown>`
([D10](../handoff-review.md#d10--medium-audit-and-notice-payloads-are-untyped)). One of 32 audit actions has a
declared shape (`AuditDetailsByAction` in `src/domain/review-types.ts`: `version.sunset_passed`). The seed writes
other spellings than the runtime: three aliases in `src/domain/audit.ts` (`version.revoke_confirmed` for
`version.revoked`, and two more), and seeded notices carry `replacedByVersionNumber` where live ones carry
`activeVersion` (`NoticeRow` in `src/domain/golive-types.ts`), so `noticeView` reads both defensively. Access and
platform effects are a second vocabulary with a second writer (`src/server/services/local/access-effects.ts`; M-11 of the
[October 12 review](../quality-review-2026-10-12.md)).

These columns become the Java side's event DTOs or JSON columns. Today their shape is whatever the writer put there.
The owner's call in `to-do.md` stands: DTOs and typed payloads are generated from the enterprise API design, not
hand-written in the prototype.

## Decision

- **Each audit action and each notice kind has one declared shape**, and the seed writes it exactly as the runtime
  does: one spelling per event, no aliases.
- **Payloads hold facts only**: ids, numbers, instants, and names as they were at the time; never a sentence
  ([0055](0055-notifications-store-facts-and-are-worded-on-read.md) removes `contractLines` and `summary`).
- **The catalogue goes in the handoff package**: for every audit action and notice kind, its fields, their types and
  which are names as they were, read from the effect builders.
- **The types are generated later**, from the enterprise API design.

## Alternatives considered

- **Type them now as discriminated unions in TypeScript.** Hand-written types the API design would replace.
- **Columns per kind.** An event's facts grow over time; a table per kind turns each addition into a migration.

## Consequences

- **Node now (wave 2, lane K):** the seed writes the runtime spellings, and `noticeView` and `canonicalAction` stop
  needing the aliases. The catalogue is written with the handoff package (wave 4).
- **Java side:** the event DTOs, or JSON columns validated against them, from the catalogue.
