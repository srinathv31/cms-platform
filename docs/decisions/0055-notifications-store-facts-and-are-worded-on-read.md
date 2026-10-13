# 0055. Notifications store facts and a link, and are worded when read

Status: Accepted
Date: 2026-10-12

## Context

About two dozen builders in twelve domain modules word a notification's title when the event happens
(`src/domain/lifecycle/submit.ts`, `approve.ts`, `revoke.ts`, `sunset.ts`, `src/domain/comments.ts`,
`src/domain/access/members.ts`, `requests.ts`, `recertification.ts`, `sweep.ts`, among them), and `writeEffects`
(`src/server/effects.ts`) stores that sentence with an href built from Next.js routes:

```json
{
  "kind": "review_requested",
  "user_id": "jordan",
  "team_id": "coral-offers",
  "title": "Maya Chen submitted Spring Travel Rewards — Terms v1, round 2 for review.",
  "href": "/coral-offers/review/UC-4F7K2Q/1?round=2"
}
```

With stored sentences, whoever writes the row owns the copy: after the port, Java would re-implement every builder,
and a copy change would be a backend release. Stored hrefs are worse: Java would have to know the app's routes, and a
route or slug change breaks old rows ([A9](../handoff-review.md#a9--low-notifications-store-app-urls)). The rest of
the app already stores facts: audit rows are worded on read (`describeAuditEvent`), and so are consumer notices
(`noticeView` in `src/domain/golive/notices.ts`). Two exceptions store English anyway: notice payloads carry
`contractLines`, which nothing reads, and `platform.config_changed` audit rows carry a `summary`
(`configChanged` in `src/domain/platform-config/effects.ts`).

## Decision

- **A notification row holds its `kind`, typed `facts` and a `link` descriptor.** Facts carry names as they were at
  the time (`actorName`, `templateName`, `number`, `round`), so a notification keeps the name it was written with
  ([0016](0016-the-name-is-versioned.md)). The link is the existing `NotificationLink` or `AccessLink`. `body` is kept
  only for a person's own words: a submit note, a change request's reason.
- **The BFF words it and builds the href when it reads it**: one domain function, `describeNotification(kind, facts)`,
  beside today's `notificationFallback`, and the href from the link and the viewer's space. The domain still words
  it ([0018](0018-settings-screens-render-decisions.md)), at read time.
- **No English is stored in a payload:** `contractLines` leaves consumer notice payloads, and `summary` leaves
  `platform.config_changed` audit rows (they store the fields that changed).
- **`/api/v1`'s English is worded on read too, and is informational:** `ApiNotice.message` and
  `ApiContractChange.text`. Consumers branch on `kind` and `code`. Render errors' sentences stay pinned by the render
  spec and the golden files.

## Alternatives considered

- **Keep stored sentences and hrefs.** Java ports every builder and the route shapes; A9 stays open.
- **Store both facts and a rendered title.** Two sources of truth, worth it only to keep old rows readable, and there
  are no real rows yet.

## Consequences

- **Node now (wave 2, lane F):** the notification effect type, `writeEffects`, `access-effects.ts`, the bell's read
  model and the seed; the wording moves from the transitions into one table, agreed in lane F's design step since it
  touches `src/domain`. No migration of data: the demo database is reseeded. This closes A9.
- **Java side:** stores and returns `kind`, `facts` and `link`. No English, no routes.
- A notification can be reworded, or translated, without touching a row.
