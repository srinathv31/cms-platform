import type { ApiNotice } from "@/domain/golive-types";
import { noticeView } from "@/domain/golive/notices";
import type { ConsumerNoticeRow, FakeState } from "./state";

// The one `/api/v1` read the contract suite observes commands through: a consumer's notices, in the order they
// were committed (decision 0006), as `listNotices` (src/server/services/local/consumer-api.ts) serves them. `/api/v1`
// is the backend's own API, not a service interface; the Java API serves it, and its contract run reads it there.

/** A consumer's notices, oldest first in commit order, as the notices API words them. */
export function fakeConsumerNotices(
  state: FakeState,
  consumerId: string,
  templateId?: string,
): ApiNotice[] {
  return state.consumerNotices
    .filter(
      (n) =>
        n.consumerId === consumerId &&
        (templateId === undefined || n.templateId === templateId),
    )
    .sort((a, b) => a.seq - b.seq)
    .map((n) => noticeView(withActiveVersion(state, n)));
}

/**
 * Seeded revoke notices don't say which version was Active when they were written (live ones do): filled in
 * from the versions' own dates, as `withActiveVersion` does for the database.
 */
function withActiveVersion(
  state: FakeState,
  row: ConsumerNoticeRow,
): ConsumerNoticeRow {
  if (row.kind !== "revoked" || Object.hasOwn(row.payload, "activeVersion"))
    return row;
  const at = row.createdAt.getTime();
  const active = state.versions.find(
    (v) =>
      v.templateId === row.templateId &&
      v.id !== row.versionId &&
      v.number !== null &&
      v.activatedAt !== null &&
      v.activatedAt.getTime() <= at &&
      (v.supersededAt === null || v.supersededAt.getTime() > at),
  );
  return {
    ...row,
    payload: { ...row.payload, activeVersion: active?.number ?? null },
  };
}
