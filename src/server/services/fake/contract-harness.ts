import { beforeAll, beforeEach } from "vitest";
import type { ContractHarness } from "../contract/harness";
import type { Services } from "../types";
import { fakeServices } from "./index";
import { viewerOf } from "./rows";
import {
  cloneState,
  seededState,
  type FakeState,
  type SeededState,
} from "./state";

// The fake as the contract suite runs it (src/server/services/README.md, "The contract suite"). Test support,
// not a test file: a fresh copy of the seed for every test, built in memory once per file.

/** Call it inside the `describe` that runs the cases, so its hooks belong to that block. */
export function fakeContractHarness(opts: { base: Date }): ContractHarness {
  let seeded: SeededState | undefined;
  let state: FakeState | undefined;
  let services: Services | undefined;
  const templates: Record<string, string> = {};

  beforeAll(() => {
    seeded = seededState(opts.base);
    Object.assign(templates, seeded.templates);
  });
  beforeEach(() => {
    state = cloneState(seeded!.state);
    services = fakeServices(state);
  });

  const iso = (date: Date) => date.toISOString();
  /** Oldest first, rows of one instant in the order they were written (as the database's rowid orders them). */
  const byTime = <R>(rows: R[], at: (row: R) => Date) =>
    rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => at(a.row).getTime() - at(b.row).getTime() || a.i - b.i)
      .map(({ row }) => row);

  return {
    name: "fake",
    templates,
    services: () => services!,
    async as(userId, at) {
      const viewer = viewerOf(state!, userId);
      if (!viewer) throw new Error(`No seeded user ${userId}.`);
      return {
        viewer,
        now: at,
        correlationId: "req_contract",
        credential: { kind: "in_process" },
      };
    },
    probe: {
      async auditEvents({ versionId }) {
        return byTime(
          state!.auditEvents.filter((e) => e.versionId === versionId),
          (e) => e.at,
        ).map((e) => ({
          action: e.action,
          at: iso(e.at),
          actorId: e.actorId,
          teamId: e.teamId,
          templateId: e.templateId,
          versionId: e.versionId,
          details: e.details,
        }));
      },
      async consumerNotices({ templateId }) {
        return state!.consumerNotices
          .filter((n) => n.templateId === templateId)
          .sort((a, b) => a.seq - b.seq)
          .map((n) => ({
            seq: n.seq,
            consumerId: n.consumerId,
            templateId: n.templateId,
            versionId: n.versionId,
            kind: n.kind,
            payload: n.payload,
            createdAt: iso(n.createdAt),
          }));
      },
      async notifications({ userId }) {
        return byTime(
          state!.notifications.filter((n) => n.userId === userId),
          (n) => n.createdAt,
        ).map((n) => ({
          userId: n.userId,
          kind: n.kind,
          title: n.title,
          href: n.href,
          createdAt: iso(n.createdAt),
        }));
      },
    },
  };
}
