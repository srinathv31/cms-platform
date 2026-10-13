# 0066. The audit log is the system of record; render events are kept for a window and rolled up

Status: Accepted
Date: 2026-10-12

## Context

`render_log` holds one row per render attempt, never a value (`src/server/db/schema/ucomp.ts`): about 31,000 rows in
90 demo days for one consumer, and a bank's monthly statement run would be millions. The product reads it for Usage
(`src/server/queries/usage.ts`: 30- and 60-day windows, a 13-week trend, an 18-week heatmap), for each version's last
render with no lower bound (`src/server/queries/versions.ts`, `review-shared.ts`), for the integration panel's latest
consumer (`integration.ts`), and for the notice audience, the consumers with a render in the 90 days before the event
(`recentConsumers` in `src/server/services/local/effects.ts`, [0032](0032-consumers-are-told-when-a-sunset-passes.md)).

`audit_events` feeds the Audit page, its CSV export and the Activity tab, and two business rules read it: the sunset
sweep writes its row once by checking whether a `version.sunset_passed` row exists (`src/server/sunset-sweep.ts`,
[0026](0026-a-passed-sunset-is-recorded-by-a-sweep.md)), and autosave recovers a lost response from the `draft.edited`
row's `rev` ([B5](../handoff-review.md#b5--medium-autosave-conflict-recovery-reads-the-audit-log)). Autosave also
updates that row in place, merging every save of an editing session (`server/drafts/apply-patch.ts` then; `src/server/services/local/drafts.ts` now). A regulated
audit trail is usually kept for years and must not change.

## Decision

- **The audit log stays relational, append-only and the system of record**, and is also forwarded to the log
  platform or SIEM (security information and event management).
- **No business rule reads the audit log** once ported: the sweep's "once" is a `versions.sunset_recorded_at` column;
  the edit session and `rev` live on the version row (B5's fix); `draft.edited` stops updating in place (one row per
  save, or an edit-session table with one audit row when the session ends).
- **Render events are kept raw for a bounded window** (about 13 months) **plus a daily rollup**,
  `render_daily(template_id, version_id, consumer_id, channel, platform, day, renders, failures, last_at)`, which
  serves Usage, the last render and the 90-day notice audience. Raw events also go to the log platform for operations.

## Alternatives considered

- **Everything relational, partitioned by month.** Workable, but the unbounded last-render reads still scan every
  partition, and the log platform still needs a copy for operations.
- **Everything on the log platform** (Log Analytics, Dynatrace), screens querying it. The sweep and autosave would
  break, and the audit screen would depend on an operations tool's retention.

## Consequences

- **Node now (wave 2, lane F):** the two audit reads (the sweep's check, autosave's recovery) sit behind named
  service methods, so the Java implementation can answer them from columns. Nothing else changes in the prototype.
- **Java side:** the append-only audit table, the forwarding, `sunset_recorded_at`, the session columns, the raw
  window with its retention job, and `render_daily`.
- The behavior of 0026 and 0032 is unchanged (one audit row and one notice per passed sunset, the 90-day audience);
  only how "once" and the audience are found moves.
- Retention periods, immutability (write once, read many) and forwarding are set by the enterprise's records and
  observability standards, in the handoff package.
